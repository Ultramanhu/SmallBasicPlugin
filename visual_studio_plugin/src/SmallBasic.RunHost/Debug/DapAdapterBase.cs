using System.IO;
using System.Text.Json.Nodes;
using SmallBasic.Compiler;
using SmallBasic.Compiler.Runtime;

namespace SmallBasic.RunHost.Debug;

/// <summary>
/// Shared plumbing of the two DAP adapters (<c>DebugAdapter</c> for the local
/// engine, <c>BlazorDebugAdapter</c> for the browser WASM sessions): the
/// message loop, the DAP send family, the resume/input signals and the
/// engine-loop state machine of the single-thread (ThreadId 1) adapters.
///
/// The engine semantics themselves - breakpoint tables, stop reasons, variable
/// snapshots - stay in the derived adapters; the base only fixes the protocol
/// framing and the loop skeleton.
/// </summary>
public abstract class DapAdapterBase
{
    protected const int ThreadId = 1;

    private readonly DapStream dap;
    private long nextSequence;
    private TaskCompletionSource<bool> resumeSignal = NewSignal();
    private TaskCompletionSource<bool> inputSignal = NewSignal();

    protected DapAdapterBase(DapStream dap)
    {
        this.dap = dap;
    }

    private static TaskCompletionSource<bool> NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>True when the peer (or the host) ended the session; both loops stop.</summary>
    protected virtual bool IsSessionDisconnected => false;

    /// <summary>DAP output category of program output; "stdout" lands in the terminal, "console" in the debug console.</summary>
    protected virtual string OutputCategory => "stdout";

    /// <summary>Description published on the `stopped` event raised for input waits.</summary>
    protected virtual string WaitingForInputDescription => "Waiting for input";

    /// <summary>Whether the engine should stop on entry; set by `launch`.</summary>
    protected bool stopOnEntry;

    /// <summary>True while a `TextWindow.Read`/`ReadNumber` is pending (fed through `evaluate`).</summary>
    protected bool waitingForInput;

    /// <summary>The control the program resumes under; see <see cref="ComputeStopReasonAsync"/>.</summary>
    protected string activeControl = "continue";

    protected int activeControlDepth;

    protected int? activeControlLine;

    protected bool pauseRequested;

    private bool endSent;

    /// <summary>Snapshot of the engine the derived adapter drives (live or captured).</summary>
    protected abstract DebuggerSnapshot? CurrentSnapshot { get; }

    /// <summary>Current source line of the driven engine (0 while no line is active).</summary>
    protected abstract int? CurrentEngineLine { get; }

    /// <summary>
    /// Whether execution should stop on `line`: a verified breakpoint, or a
    /// conditional breakpoint whose condition evaluates against the live
    /// program memory (failures fall through so the program keeps running).
    /// </summary>
    protected abstract Task<bool> ShouldStopAtLineAsync(int line);

    /// <summary>Releases the engine's libraries; called once, after the end events were sent.</summary>
    protected abstract void DisposeEngineResources();

    /// <summary>Handles one DAP request; failures are reported without ending the adapter.</summary>
    protected abstract Task DispatchRequestAsync(JsonObject request);

    /// <summary>Runs the DAP message loop until the stream closes or the session disconnects.</summary>
    protected async Task MessageLoopAsync()
    {
        while (!this.IsSessionDisconnected)
        {
            JsonObject? message;
            try
            {
                message = await this.dap.ReadMessageAsync().ConfigureAwait(false);
            }
            catch
            {
                return;
            }

            if (message is null)
            {
                return;
            }

            if ((string?)message["type"] == "request")
            {
                try
                {
                    await this.DispatchRequestAsync(message).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    // A failing handler must not tear the adapter down; report the
                    // failure so the host does not treat a silent exit as a crash.
                    int failedSeq = (int?)message["seq"] ?? 0;
                    string failedCommand = (string?)message["command"] ?? string.Empty;
                    this.SendErrorResponse(failedSeq, failedCommand, $"SmallBasic debugger failed to handle '{failedCommand}': {ex.Message}");
                }
            }
        }
    }

    /// <summary>
    /// Runs the engine loop to termination: stops on entry/first-line
    /// breakpoints, reports pauses (computing the stop reason), waits for
    /// `evaluate` input while blocked and ends the session on termination.
    /// </summary>
    protected async Task RunEngineLoopAsync(SmallBasicEngine engine)
    {
        // The engine uses source line zero as its "no line yet" sentinel, so a
        // first line of zero never triggers a NextLine pause. Handle entry stops
        // and breakpoints sitting on the first instruction line explicitly.
        int firstLine = engine.GetSnapshot().ExecutionStack.Last().CurrentSourceLine;
        if (this.stopOnEntry)
        {
            this.OnStopping("entry", firstLine);
            this.SendStopped("entry");
            await this.WaitForResumeAsync().ConfigureAwait(false);
        }
        else if (this.activeControl == "continue" && await this.ShouldStopAtLineAsync(firstLine).ConfigureAwait(false))
        {
            this.OnStopping("breakpoint", firstLine);
            this.SendStopped("breakpoint");
            await this.WaitForResumeAsync().ConfigureAwait(false);
        }

        while (true)
        {
            if (this.CheckRunLoopEnded())
            {
                return;
            }

            try
            {
                await engine.Execute().ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                this.SendOutput($"\n[Runtime Error] {ex}\n");
                this.EndSession(1);
                return;
            }

            switch (engine.State)
            {
                case ExecutionState.Paused:
                {
                    string? reason = await this.ComputeStopReasonAsync().ConfigureAwait(false);
                    if (reason is null)
                    {
                        engine.Continue();
                    }
                    else
                    {
                        this.OnStopping(reason, null);
                        this.SendStopped(reason);
                        await this.WaitForResumeAsync().ConfigureAwait(false);
                        if (engine.State == ExecutionState.Paused)
                        {
                            engine.Continue();
                        }
                    }

                    break;
                }

                case ExecutionState.BlockedOnStringInput:
                case ExecutionState.BlockedOnNumberInput:
                {
                    bool numeric = engine.State == ExecutionState.BlockedOnNumberInput;
                    this.waitingForInput = true;
                    this.OnStopping("pause", null);
                    this.SendOutput(numeric
                        ? "\n[Input] Type a number in the Debug Console and press Enter.\n"
                        : "\n[Input] Type text in the Debug Console and press Enter.\n");
                    this.SendStopped("pause", this.WaitingForInputDescription);
                    await this.WaitForInputAsync().ConfigureAwait(false);
                    break;
                }

                case ExecutionState.Terminated:
                    this.EndSession(0);
                    return;

                case ExecutionState.Running:
                    await this.OnEngineRunningAsync().ConfigureAwait(false);
                    break;
            }
        }
    }

    /// <summary>Idle wait of a still-running engine slice (hot-loop guard).</summary>
    protected virtual Task OnEngineRunningAsync() => Task.CompletedTask;

    /// <summary>
    /// Per-iteration end check of the engine loop. Returning true ends the loop
    /// without further events (the override reports the end itself, e.g. when
    /// the graphics window was closed or the client disconnected).
    /// </summary>
    protected virtual bool CheckRunLoopEnded() => false;

    /// <summary>Invoked before every `stopped` event of the engine loop (snapshot capture hook).</summary>
    protected virtual void OnStopping(string reason, int? lineOverride)
    {
    }

    protected async Task<string?> ComputeStopReasonAsync()
    {
        if (this.pauseRequested)
        {
            this.pauseRequested = false;
            return "pause";
        }

        int depth = this.GetStackDepth();
        switch (this.activeControl)
        {
            case "stepIn":
                return "step";
            case "next":
                return depth <= this.activeControlDepth && this.CurrentEngineLine != this.activeControlLine ? "step" : null;
            case "stepOut":
                return depth < this.activeControlDepth && this.CurrentEngineLine != this.activeControlLine ? "step" : null;
            default:
                return this.CurrentEngineLine is { } line && await this.ShouldStopAtLineAsync(line).ConfigureAwait(false)
                    ? "breakpoint"
                    : null;
        }
    }

    protected int? GetStepLine(bool stepOut)
    {
        DebuggerSnapshot? snapshot = this.CurrentSnapshot;
        if (snapshot is null)
        {
            return null;
        }

        Frame? frame = snapshot.ExecutionStack.Reverse().ElementAtOrDefault(stepOut ? 1 : 0);
        return frame?.CurrentSourceLine;
    }

    protected int GetStackDepth() => this.CurrentSnapshot?.ExecutionStack.Count ?? 0;

    protected async Task WaitForResumeAsync()
    {
        Task signal = this.resumeSignal.Task;
        await signal.ConfigureAwait(false);
    }

    protected void SignalResume()
    {
        this.resumeSignal.TrySetResult(true);
        this.resumeSignal = NewSignal();
    }

    protected async Task WaitForInputAsync()
    {
        Task signal = this.inputSignal.Task;
        await signal.ConfigureAwait(false);
    }

    /// <summary>Releases an input wait after the `evaluate` request fed the TextWindow.</summary>
    protected void CompleteInput()
    {
        this.inputSignal.TrySetResult(true);
        this.inputSignal = NewSignal();
    }

    protected void EndSession(int exitCode)
    {
        if (this.endSent)
        {
            return;
        }

        this.endSent = true;
        this.SendEvent("exited", new JsonObject { ["exitCode"] = exitCode });
        this.SendEvent("terminated");
        this.DisposeEngineResources();
    }

    protected void SendStopped(string reason, string? description = null)
    {
        this.OnBeforeStopped();
        var body = new JsonObject
        {
            ["reason"] = reason,
            ["threadId"] = ThreadId,
            ["allThreadsStopped"] = true,
        };

        if (description is not null)
        {
            body["description"] = description;
        }

        this.SendEvent("stopped", body);
    }

    /// <summary>Hook run before a `stopped` event leaves the adapter (handle invalidation).</summary>
    protected virtual void OnBeforeStopped()
    {
    }

    protected void SendOutput(string text)
    {
        this.SendEvent("output", new JsonObject
        {
            ["category"] = this.OutputCategory,
            ["output"] = text,
        });
    }

    protected void SendEvent(string eventName, JsonObject? body = null)
    {
        var message = new JsonObject
        {
            ["seq"] = Interlocked.Increment(ref this.nextSequence),
            ["type"] = "event",
            ["event"] = eventName,
        };

        if (body is not null)
        {
            message["body"] = body;
        }

        this.WriteDap(message);
    }

    protected void SendResponse(int requestSeq, string command, JsonObject? body = null)
    {
        var message = new JsonObject
        {
            ["seq"] = Interlocked.Increment(ref this.nextSequence),
            ["type"] = "response",
            ["request_seq"] = requestSeq,
            ["command"] = command,
            ["success"] = true,
        };

        if (body is not null)
        {
            message["body"] = body;
        }

        this.WriteDap(message);
    }

    protected void SendErrorResponse(int requestSeq, string command, string messageText)
    {
        this.WriteDap(new JsonObject
        {
            ["seq"] = Interlocked.Increment(ref this.nextSequence),
            ["type"] = "response",
            ["request_seq"] = requestSeq,
            ["command"] = command,
            ["success"] = false,
            ["message"] = messageText,
            ["body"] = new JsonObject
            {
                ["error"] = new JsonObject { ["format"] = messageText },
            },
        });
    }

    private void WriteDap(JsonObject message)
    {
        try
        {
            this.dap.WriteMessage(message);
        }
        catch
        {
            // The client went away; the session ends when stdin closes.
        }
    }

    /// <summary>TextWindow writer bridging library output into DAP output events.</summary>
    protected sealed class DapTextWriter : TextWriter
    {
        private readonly DapAdapterBase adapter;

        public DapTextWriter(DapAdapterBase adapter)
        {
            this.adapter = adapter;
        }

        public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;

        public override void Write(char value) => this.adapter.SendOutput(value.ToString());

        public override void Write(string? value)
        {
            if (value is not null)
            {
                this.adapter.SendOutput(value);
            }
        }

        public override void WriteLine(string? value) => this.adapter.SendOutput((value ?? string.Empty) + Environment.NewLine);

        public override Task WriteAsync(string? value)
        {
            this.Write(value);
            return Task.CompletedTask;
        }

        public override Task WriteLineAsync(string? value)
        {
            this.WriteLine(value);
            return Task.CompletedTask;
        }

        public override Task FlushAsync() => Task.CompletedTask;
    }
}
