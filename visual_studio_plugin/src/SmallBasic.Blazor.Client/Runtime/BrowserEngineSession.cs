using SmallBasic.Blazor.Shared;
using SmallBasic.Compiler;
using SmallBasic.Compiler.Runtime;
using SmallBasic.RunHost;

namespace SmallBasic.Blazor.Client.Runtime;

public sealed class BrowserEngineSession : IAsyncDisposable
{
    private readonly SessionDescriptor descriptor;
    private readonly RuntimeViewModel view;
    private readonly IRunHostTransport bridge;
    private readonly BrowserLibraries libraries;
    private readonly SmallBasicCompilation compilation;
    private readonly SmallBasicEngine engine;
    private HashSet<int> breakpoints = new();
    private bool waitingForDebugInput;
    private bool terminationRequested;

    public BrowserEngineSession(SessionDescriptor descriptor, RuntimeViewModel view, IRunHostTransport bridge)
    {
        this.descriptor = descriptor;
        this.view = view;
        this.bridge = bridge;
        this.compilation = new SmallBasicCompilation(descriptor.Source);
        if (this.compilation.Diagnostics.Count > 0)
        {
            throw new InvalidOperationException(string.Join(Environment.NewLine, this.compilation.Diagnostics.Select(d => d.ToDisplayString())));
        }

        this.libraries = new BrowserLibraries(view);
        this.libraries.TextWindow.Output += this.ForwardOutput;
        this.engine = new SmallBasicEngine(this.compilation, this.libraries)
        {
            Mode = descriptor.Debug ? ExecutionMode.NextLine : ExecutionMode.RunToEnd,
        };
    }

    public GraphicsWindowLibrary GraphicsWindow => this.libraries.GraphicsWindow;

    /// <summary>
    /// Session identifier of the web debug protocol. Every message the session
    /// publishes carries it so the webview and the extension host can drop
    /// messages that belong to a previous run.
    /// </summary>
    public string SessionId => this.descriptor.Id;

    /// <summary>
    /// Whether the program touches GraphicsWindow/Shapes/Turtle. The runner uses
    /// this instead of the descriptor so that the web shell does not have to
    /// analyze the source before handing it over.
    /// </summary>
    public bool UsesGraphics => this.compilation.Analysis.UsesGraphicsWindow;

    /// <summary>Requests program termination; the run loop reports it when it observes the state change.</summary>
    public void Terminate()
    {
        this.terminationRequested = true;
        this.engine.Terminate();
    }

    /// <summary>
    /// Queues a host command (debug control, breakpoints, input) into the
    /// transport channel. Used by <c>WebRunHost.DispatchDebugCommand</c> for the
    /// webview channel; the CLI bridge writes into the channel itself.
    /// </summary>
    public void EnqueueCommand(HostMessage command) => this.bridge.EnqueueLocal(command);

    public void SubmitInput(string value)
    {
        if (this.descriptor.Debug && this.waitingForDebugInput)
        {
            this.bridge.EnqueueLocal(new HostMessage { Type = "input", Text = value });
        }
        else
        {
            this.view.SubmitInput(value);
        }
    }

    public async Task RunAsync()
    {
        try
        {
            this.view.SetStatus(this.descriptor.Debug ? "Debugger connected" : "Running");
            await this.SendAsync(new BrowserMessage { Type = "ready" });
            if (this.descriptor.Debug)
            {
                await this.RunDebugAsync();
            }
            else
            {
                await this.RunToEndAsync();
            }
        }
        catch (Exception ex)
        {
            this.view.AppendText($"{Environment.NewLine}{ex}{Environment.NewLine}");
            this.view.SetStatus("Failed");
            await this.SendAsync(new BrowserMessage { Type = "output", Text = ex + Environment.NewLine });
            await this.SendAsync(new BrowserMessage { Type = "terminated", ExitCode = 4 });
        }
    }

    public async ValueTask DisposeAsync()
    {
        this.libraries.TextWindow.Output -= this.ForwardOutput;
        this.libraries.Dispose();
        await this.bridge.DisposeAsync();
    }

    private async Task RunToEndAsync()
    {
        await EngineRunLoop.RunAsync(
            this.engine,
            number =>
            {
                this.view.SetStatus(number ? "Waiting for a number" : "Waiting for input");
                return this.view.RequestInputAsync(number);
            },
            line => this.libraries.TextWindow.SetPendingInput(line),
            inputReceived: () => this.view.SetStatus("Running"));

        // The web shell's Stop button terminates through the same path,
        // so it must not read as a normal completion.
        this.view.SetStatus(this.terminationRequested ? "Stopped" : "Completed");
        if (this.engine.LastError is { } lastError)
        {
            // Unhandled runtime error: mirror the unified message and fail.
            this.view.AppendText($"{Environment.NewLine}{lastError.ToDisplayString()}{Environment.NewLine}");
            await this.SendAsync(new BrowserMessage { Type = "output", Text = lastError.ToDisplayString() + Environment.NewLine });
            await this.SendAsync(new BrowserMessage { Type = "terminated", ExitCode = 4 });
            return;
        }

        await this.SendAsync(new BrowserMessage { Type = "terminated", ExitCode = 0 });
    }

    private async Task RunDebugAsync()
    {
        if (!await this.WaitForStartAsync())
        {
            return;
        }

        if (this.descriptor.StopOnEntry)
        {
            int firstLine = this.compilation.GetExecutableLines().DefaultIfEmpty(0).Min();
            await this.SendStoppedAsync("entry", firstLine);
        }
        else
        {
            await this.ExecuteControlAsync("continue", 0);
        }

        while (this.engine.State != ExecutionState.Terminated)
        {
            HostMessage command = await this.bridge.ReadAsync();
            if (await this.ApplyHostCommandAsync(command))
            {
                this.engine.Terminate();
                break;
            }

            if (command.Type == "control")
            {
                await this.ExecuteControlAsync(command.Control ?? "continue", command.Depth);
            }
        }

        this.view.SetStatus(this.terminationRequested ? "Stopped" : "Completed");
        if (this.engine.LastError is { } lastError)
        {
            await this.SendAsync(new BrowserMessage { Type = "output", Text = lastError.ToDisplayString() + Environment.NewLine });
            await this.SendAsync(new BrowserMessage { Type = "terminated", ExitCode = 1 });
            return;
        }

        await this.SendAsync(new BrowserMessage { Type = "terminated", ExitCode = 0 });
    }

    /// <summary>
    /// Applies breakpoint/control commands until the host sends <c>start</c>.
    /// Returns false when the session was stopped before it ever started (the
    /// caller reports <c>terminated</c> so the adapter cannot hang).
    /// </summary>
    private async Task<bool> WaitForStartAsync()
    {
        while (true)
        {
            HostMessage message = await this.bridge.ReadAsync();
            if (await this.ApplyHostCommandAsync(message))
            {
                this.engine.Terminate();
                this.view.SetStatus("Stopped");
                await this.SendAsync(new BrowserMessage { Type = "terminated", ExitCode = 0 });
                return false;
            }

            if (message.Type == "start")
            {
                return true;
            }
        }
    }

    private async Task ExecuteControlAsync(string control, int startingDepth)
    {
        Frame[] startingFrames = this.engine.GetSnapshot().ExecutionStack.Reverse().ToArray();
        int startingFrameIndex = control == "stepOut" ? 1 : 0;
        int? startingLine = startingFrames.ElementAtOrDefault(startingFrameIndex)?.CurrentSourceLine;
        this.view.SetStatus("Running under debugger");
        if (this.engine.State == ExecutionState.Paused)
        {
            this.engine.Continue();
        }

        while (true)
        {
            while (this.bridge.TryRead(out HostMessage? pending) && pending is not null)
            {
                if (await this.ApplyHostCommandAsync(pending))
                {
                    this.engine.Terminate();
                }
                else if (pending.Type == "control" && pending.Control == "pause")
                {
                    await this.SendStoppedAsync("pause");
                    return;
                }
            }

            switch (this.engine.State)
            {
                case ExecutionState.Running:
                    await this.engine.Execute();
                    if (this.engine.State == ExecutionState.Running)
                    {
                        await Task.Delay(10);
                    }

                    break;
                case ExecutionState.Paused:
                    // An unhandled runtime error pauses on the failure scene;
                    // report it and stop with reason "exception". Continuing
                    // terminates the session.
                    if (this.engine.PausedOnRuntimeError && this.engine.LastError is { } runtimeError)
                    {
                        await this.SendAsync(new BrowserMessage { Type = "output", Text = runtimeError.ToDisplayString() + Environment.NewLine });
                        await this.SendStoppedAsync("exception");
                        return;
                    }

                    int line = this.engine.CurrentSourceLine;
                    int depth = this.engine.GetSnapshot().ExecutionStack.Count;
                    bool shouldStop = this.breakpoints.Contains(line)
                        || control == "stepIn"
                        || (control == "next" && depth <= startingDepth && line != startingLine)
                        || (control == "stepOut" && depth < startingDepth && line != startingLine);
                    if (shouldStop)
                    {
                        string reason = this.breakpoints.Contains(line) ? "breakpoint" : "step";
                        await this.SendStoppedAsync(reason);
                        return;
                    }

                    this.engine.Continue();
                    break;
                case ExecutionState.BlockedOnStringInput:
                case ExecutionState.BlockedOnNumberInput:
                    await this.WaitForDebugInputAsync(this.engine.State == ExecutionState.BlockedOnNumberInput);
                    break;
                case ExecutionState.Terminated:
                    return;
            }
        }
    }

    private async Task WaitForDebugInputAsync(bool number)
    {
        this.waitingForDebugInput = true;
        this.view.SetStatus(number ? "Debugger is waiting for a number" : "Debugger is waiting for input");
        await this.SendAsync(this.CreateSnapshotMessage("input", numberInput: number));

        while (true)
        {
            HostMessage command = await this.bridge.ReadAsync();
            if (await this.ApplyHostCommandAsync(command))
            {
                this.waitingForDebugInput = false;
                return;
            }

            if (command.Type == "input")
            {
                string value = command.Text ?? string.Empty;
                this.view.SubmitInput(value);
                this.libraries.TextWindow.SetPendingInput(value);
                this.engine.InputReceived();
                this.waitingForDebugInput = false;
                this.view.SetStatus("Running under debugger");
                return;
            }
        }
    }

    /// <summary>
    /// Handles the commands that are valid in any state. Returns true when the
    /// caller must terminate the engine (Stop/terminate).
    /// </summary>
    private async Task<bool> ApplyHostCommandAsync(HostMessage message)
    {
        if (message.Type == "setBreakpoints")
        {
            // Web debug requests carry the raw (0-based) lines; the runtime is the
            // only side that knows the executable lines, so it snaps them here and
            // answers with the lines it actually accepted.
            int[] validated = this.ValidateBreakpoints(message.Breakpoints);
            this.breakpoints = validated.ToHashSet();
            await this.SendAsync(new BrowserMessage
            {
                Type = "breakpointsValidated",
                RequestId = message.RequestId,
                Breakpoints = validated,
            });
            return false;
        }

        if (message.Type == "stop")
        {
            this.terminationRequested = true;
            return true;
        }

        // The CLI bridge validates breakpoints in its adapter and sends the
        // already-snapped lines with "breakpoints", "start" and with every
        // "control" message; web commands carry no breakpoints on "control".
        if (message.Breakpoints.Length > 0 || message.Type == "breakpoints" || message.Type == "start")
        {
            this.breakpoints = message.Breakpoints.ToHashSet();
        }

        return false;
    }

    /// <summary>
    /// Snaps each requested line to the next executable line, dropping requests
    /// that fall past the end of the program (mirrors the JavaScript adapter's
    /// breakpoint verification).
    /// </summary>
    private int[] ValidateBreakpoints(IEnumerable<int> requested)
    {
        int[] executable = this.compilation.GetExecutableLines().OrderBy(line => line).ToArray();
        var validated = new SortedSet<int>();
        foreach (int line in requested)
        {
            int zeroBased = Math.Max(0, line);
            foreach (int candidate in executable)
            {
                if (candidate >= zeroBased)
                {
                    validated.Add(candidate);
                    break;
                }
            }
        }

        return validated.ToArray();
    }

    private async Task SendStoppedAsync(string reason, int? lineOverride = null)
    {
        this.view.SetStatus($"Paused: {reason}");
        await this.SendAsync(this.CreateSnapshotMessage("stopped", reason, lineOverride));
    }

    private BrowserMessage CreateSnapshotMessage(string type, string? reason = null, int? lineOverride = null, bool numberInput = false)
    {
        DebuggerSnapshot snapshot = this.engine.GetSnapshot();
        DebugFrame[] frames = snapshot.ExecutionStack.Reverse().Select(frame => new DebugFrame
        {
            Name = frame.Module.Name,
            Line = frame.CurrentSourceLine,
            Variables = frame.Locals.OrderBy(pair => pair.Key).Select(pair => ConvertVariable(pair.Key, pair.Value)).ToArray(),
        }).ToArray();
        DebugVariable[] variables = snapshot.Memory.OrderBy(pair => pair.Key).Select(pair => ConvertVariable(pair.Key, pair.Value)).ToArray();
        return new BrowserMessage
        {
            Type = type,
            Reason = reason,
            Line = lineOverride ?? snapshot.CurrentSourceLine,
            NumberInput = numberInput,
            Frames = frames,
            Variables = variables,
        };
    }

    private static DebugVariable ConvertVariable(string name, BaseValue value)
        => new()
        {
            Name = name,
            Value = value.ToDisplayString(),
            Children = value is ArrayValue array
                ? array.OrderBy(pair => pair.Key).Select(pair => ConvertVariable(pair.Key, pair.Value)).ToArray()
                : Array.Empty<DebugVariable>(),
        };

    private void ForwardOutput(string text) => _ = this.SendAsync(new BrowserMessage { Type = "output", Text = text });

    /// <summary>
    /// Stamps the web debug envelope (protocol version and session id) before the
    /// transport publishes the message. The CLI bridge ignores both fields.
    /// </summary>
    private Task SendAsync(BrowserMessage message)
    {
        if (message.ProtocolVersion == 0)
        {
            message.ProtocolVersion = DebugProtocol.Version;
        }

        message.SessionId ??= this.SessionId;
        return this.bridge.SendAsync(message);
    }
}
