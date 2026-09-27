namespace SmallBasic.RunHost.Debug;

using System.IO;
using System.Text.Json.Nodes;
using SmallBasic.Compiler;
using SmallBasic.Compiler.Runtime;
using SmallBasic.RunHost.Libraries;

/// <summary>
/// Debug Adapter Protocol server driving <see cref="SmallBasicEngine"/> in
/// <see cref="ExecutionMode.NextLine"/> mode. Semantics (breakpoint snapping,
/// stepIn/next/stepOut depth rules, variable expansion, input-through-evaluate)
/// mirror the TypeScript adapter in visual_studio_code_plugin/packages/smallbasic-vscode/src/debug/session.ts.
/// </summary>
public sealed class DebugAdapter
{
    private const int ThreadId = 1;

    private readonly DapStream dap;
    private readonly Dictionary<string, List<SessionBreakpoint>> breakpoints = new Dictionary<string, List<SessionBreakpoint>>(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<long, ArrayValue> arrayHandles = new Dictionary<long, ArrayValue>();

    private SmallBasicEngine? engine;
    private RuntimeLibrariesCollection? libraries;
    private string programPath = string.Empty;
    private string programName = "program.sb";

    private bool stopOnEntry;
    private bool configurationDone;
    private bool runLoopStarted;
    private bool pauseRequested;
    private bool endSent;
    private int waitingForInput; // 0 = not waiting, 1 = string, 2 = number

    private string activeControl = "continue";
    private int activeControlDepth;
    private long nextArrayHandle = 1;

    private TaskCompletionSource<bool> resumeSignal = NewSignal();
    private TaskCompletionSource<bool> inputSignal = NewSignal();

    private DebugAdapter(DapStream dap)
    {
        this.dap = dap;
    }

    public static async Task RunAsync()
    {
        // stdin/stdout carry DAP frames, so the console streams are off-limits
        // for program I/O. TextWindow output is bridged to DAP output events and
        // input arrives through evaluate requests, exactly like the TS adapter.
        var adapter = new DebugAdapter(new DapStream(Console.OpenStandardInput(), Console.OpenStandardOutput()));
        await adapter.MessageLoopAsync().ConfigureAwait(false);
    }

    private static TaskCompletionSource<bool> NewSignal() => new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

    private sealed class SessionBreakpoint
    {
        public int RequestedLine { get; set; }

        public int? ActualLine { get; set; }

        public bool Verified { get; set; }

        public string? Condition { get; set; }

        public CompiledExpression? CompiledCondition { get; set; }
    }

    private async Task MessageLoopAsync()
    {
        while (true)
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
                await this.DispatchRequestAsync(message).ConfigureAwait(false);
            }
        }
    }

    private async Task DispatchRequestAsync(JsonObject request)
    {
        int seq = (int?)request["seq"] ?? 0;
        string command = (string?)request["command"] ?? string.Empty;
        JsonObject? arguments = request["arguments"] as JsonObject;

        switch (command)
        {
            case "initialize":
                this.SendResponse(seq, command, new JsonObject
                {
                    ["supportsConfigurationDoneRequest"] = true,
                    ["supportsConditionalBreakpoints"] = true,
                    ["supportsEvaluateForHovers"] = false,
                    ["supportsStepBack"] = false,
                    ["supportsRestartRequest"] = false,
                });
                this.SendEvent("initialized");
                break;

            case "launch":
                this.HandleLaunch(seq, command, arguments);
                break;

            case "setBreakpoints":
                this.HandleSetBreakpoints(seq, command, arguments);
                break;

            case "configurationDone":
                this.configurationDone = true;
                this.SendResponse(seq, command);
                this.StartRunLoop();
                break;

            case "setExceptionBreakpoints":
            case "setFunctionBreakpoints":
                this.SendResponse(seq, command, new JsonObject { ["breakpoints"] = new JsonArray() });
                break;

            case "threads":
                this.SendResponse(seq, command, new JsonObject
                {
                    ["threads"] = new JsonArray(new JsonObject { ["id"] = ThreadId, ["name"] = "Main" }),
                });
                break;

            case "stackTrace":
                this.HandleStackTrace(seq, command);
                break;

            case "scopes":
                this.SendResponse(seq, command, new JsonObject
                {
                    ["scopes"] = new JsonArray(new JsonObject
                    {
                        ["name"] = "Globals",
                        ["variablesReference"] = 1,
                        ["expensive"] = false,
                    }),
                });
                break;

            case "variables":
                this.HandleVariables(seq, command, arguments);
                break;

            case "continue":
                this.activeControl = "continue";
                this.pauseRequested = false;
                this.SendResponse(seq, command, new JsonObject { ["allThreadsContinued"] = true });
                this.SignalResume();
                break;

            case "next":
                this.activeControl = "next";
                this.activeControlDepth = this.GetStackDepth();
                this.pauseRequested = false;
                this.SendResponse(seq, command);
                this.SignalResume();
                break;

            case "stepIn":
                this.activeControl = "stepIn";
                this.activeControlDepth = this.GetStackDepth();
                this.pauseRequested = false;
                this.SendResponse(seq, command);
                this.SignalResume();
                break;

            case "stepOut":
                this.activeControl = "stepOut";
                this.activeControlDepth = this.GetStackDepth();
                this.pauseRequested = false;
                this.SendResponse(seq, command);
                this.SignalResume();
                break;

            case "pause":
                this.pauseRequested = true;
                if (this.engine is { } engine && engine.State == ExecutionState.Running)
                {
                    engine.Pause();
                }

                this.SendResponse(seq, command);
                break;

            case "evaluate":
                this.HandleEvaluate(seq, command, arguments);
                break;

            case "disconnect":
                this.SendResponse(seq, command);
                this.DisposeLibraries();
                this.SendTerminated();
                Environment.Exit(0);
                break;

            default:
                this.SendErrorResponse(seq, command, $"SmallBasic debugger does not support request '{command}'.");
                break;
        }

        await Task.CompletedTask.ConfigureAwait(false);
    }

    private void HandleLaunch(int seq, string command, JsonObject? arguments)
    {
        string program = (string?)arguments?["program"] ?? string.Empty;
        this.stopOnEntry = (bool?)arguments?["stopOnEntry"] ?? false;

        if (program.Length == 0 || !File.Exists(program))
        {
            this.SendErrorResponse(seq, command, $"SmallBasic source file not found: {program}");
            return;
        }

        this.programPath = Path.GetFullPath(program);
        this.programName = Path.GetFileName(this.programPath);

        SmallBasicCompilation compilation;
        try
        {
            compilation = new SmallBasicCompilation(File.ReadAllText(this.programPath));
        }
        catch (Exception ex)
        {
            this.SendErrorResponse(seq, command, $"Cannot read program file: {ex.Message}");
            return;
        }

        if (compilation.Diagnostics.Count > 0)
        {
            string message = string.Join("\n", compilation.Diagnostics.Take(10).Select(diagnostic => diagnostic.ToDisplayString()));
            this.SendErrorResponse(seq, command, $"The program contains compilation errors:\n{message}");
            return;
        }

#if !GRAPHICS_HOST
        if (compilation.Analysis.UsesGraphicsWindow)
        {
            this.SendErrorResponse(seq, command, "This C# debug host is text-only. Use the Windows C# host for GraphicsWindow/Shapes/Turtle programs.");
            return;
        }
#endif

        this.libraries = new RuntimeLibrariesCollection(
            TextReader.Null,
            new DapTextWriter(this),
            enableGraphics: compilation.Analysis.UsesGraphicsWindow);
        this.engine = new SmallBasicEngine(compilation, this.libraries)
        {
            Mode = ExecutionMode.NextLine,
        };

        this.SendResponse(seq, command);

        if (this.configurationDone)
        {
            this.StartRunLoop();
        }
    }

    private void HandleSetBreakpoints(int seq, string command, JsonObject? arguments)
    {
        string? sourcePath = (string?)(arguments?["source"] as JsonObject)?["path"];
        var requestedLines = new List<int>();
        var requestedConditions = new List<string>();
        if (arguments?["breakpoints"] is JsonArray breakpointsArray)
        {
            foreach (JsonNode? node in breakpointsArray)
            {
                if ((int?)node?["line"] is int line)
                {
                    requestedLines.Add(line - 1);
                    requestedConditions.Add(((string?)node?["condition"] ?? string.Empty).Trim());
                }
            }
        }

        SmallBasicCompilation? sourceCompilation = null;
        if (!string.IsNullOrEmpty(sourcePath) && File.Exists(sourcePath))
        {
            try
            {
                sourceCompilation = new SmallBasicCompilation(File.ReadAllText(sourcePath));
            }
            catch
            {
                sourceCompilation = null;
            }
        }

        IReadOnlyCollection<int>? executableLines = sourceCompilation?.GetExecutableLines();

        var verified = new List<SessionBreakpoint>();
        for (int i = 0; i < requestedLines.Count; i++)
        {
            int requestedLine = requestedLines[i];
            string condition = requestedConditions[i];

            int? actualLine = executableLines?
                .Where(line => line >= requestedLine)
                .OrderBy(line => line)
                .Cast<int?>()
                .FirstOrDefault();

            var breakpoint = new SessionBreakpoint
            {
                RequestedLine = requestedLine,
                ActualLine = actualLine,
                Verified = actualLine.HasValue,
                Condition = condition,
            };

            if (breakpoint.Verified && condition.Length > 0)
            {
                // A condition that does not compile invalidates the breakpoint so
                // the client can surface the problem instead of silently ignoring it.
                breakpoint.CompiledCondition = sourceCompilation?.CompileExpression(condition);
                if (breakpoint.CompiledCondition is null)
                {
                    breakpoint.Verified = false;
                }
            }

            verified.Add(breakpoint);
        }

        if (!string.IsNullOrEmpty(sourcePath))
        {
            this.breakpoints[Path.GetFullPath(sourcePath)] = verified;
        }

        this.SendResponse(seq, command, new JsonObject
        {
            ["breakpoints"] = new JsonArray(verified.Select(breakpoint => (JsonNode)this.CreateBreakpointJson(breakpoint)).ToArray()),
        });
    }

    private JsonObject CreateBreakpointJson(SessionBreakpoint breakpoint)
    {
        var json = new JsonObject
        {
            ["verified"] = breakpoint.Verified,
            ["line"] = (breakpoint.ActualLine ?? breakpoint.RequestedLine) + 1,
        };

        if (!breakpoint.Verified && !string.IsNullOrEmpty(breakpoint.Condition))
        {
            json["message"] = $"Invalid condition: {breakpoint.Condition}";
        }

        return json;
    }

    private void HandleStackTrace(int seq, string command)
    {
        var frames = new JsonArray();
        DebuggerSnapshot? snapshot = this.engine?.GetSnapshot();
        if (snapshot is { })
        {
            int frameId = 0;
            foreach (Frame frame in snapshot.ExecutionStack.Reverse())
            {
                frameId += 1;
                frames.Add(new JsonObject
                {
                    ["id"] = frameId,
                    ["name"] = frame.Module.Name,
                    ["line"] = frame.CurrentSourceLine + 1,
                    ["column"] = 1,
                    ["source"] = new JsonObject
                    {
                        ["name"] = this.programName,
                        ["path"] = this.programPath,
                    },
                });
            }

            this.SendResponse(seq, command, new JsonObject
            {
                ["stackFrames"] = frames,
                ["totalFrames"] = frameId,
            });
            return;
        }

        this.SendResponse(seq, command, new JsonObject { ["stackFrames"] = new JsonArray(), ["totalFrames"] = 0 });
    }

    private void HandleVariables(int seq, string command, JsonObject? arguments)
    {
        long reference = (long?)(arguments?["variablesReference"]) ?? 0;
        var variables = new JsonArray();

        if (reference == 1)
        {
            DebuggerSnapshot? snapshot = this.engine?.GetSnapshot();
            if (snapshot is { })
            {
                foreach (KeyValuePair<string, BaseValue> pair in snapshot.Memory.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase))
                {
                    variables.Add(this.CreateVariable(pair.Key, pair.Value));
                }
            }
        }
        else if (this.arrayHandles.TryGetValue(reference, out ArrayValue? array))
        {
            foreach (KeyValuePair<string, BaseValue> pair in array.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase))
            {
                variables.Add(this.CreateVariable(pair.Key, pair.Value));
            }
        }

        this.SendResponse(seq, command, new JsonObject { ["variables"] = variables });
    }

    private void HandleEvaluate(int seq, string command, JsonObject? arguments)
    {
        string expression = ((string?)arguments?["expression"] ?? string.Empty).Trim();

        if (this.waitingForInput != 0 && this.libraries is { } libraries && this.engine is { } engine)
        {
            libraries.TextWindow.SetPendingInput(expression);
            engine.InputReceived();
            this.waitingForInput = 0;
            this.SendResponse(seq, command, new JsonObject { ["result"] = expression, ["variablesReference"] = 0 });
            this.inputSignal.TrySetResult(true);
            this.inputSignal = NewSignal();
            return;
        }

        if (this.engine is { } runningEngine && expression.Length > 0)
        {
            IReadOnlyDictionary<string, BaseValue> memory = runningEngine.GetSnapshot().Memory;
            if (!memory.TryGetValue(expression, out BaseValue? value))
            {
                value = memory.FirstOrDefault(pair => string.Equals(pair.Key, expression, StringComparison.OrdinalIgnoreCase)).Value;
            }

            if (value is { })
            {
                this.SendResponse(seq, command, new JsonObject
                {
                    ["result"] = value.ToDisplayString(),
                    ["variablesReference"] = value is ArrayValue array ? this.RegisterArray(array) : 0,
                });
                return;
            }
        }

        this.SendErrorResponse(seq, command, $"Cannot evaluate expression: {expression}");
    }

    private JsonObject CreateVariable(string name, BaseValue value)
    {
        return new JsonObject
        {
            ["name"] = name,
            ["value"] = value.ToDisplayString(),
            ["type"] = value.GetType().Name.Replace("Value", string.Empty),
            ["variablesReference"] = value is ArrayValue array ? this.RegisterArray(array) : 0,
        };
    }

    private long RegisterArray(ArrayValue array)
    {
        long handle = this.nextArrayHandle++;
        this.arrayHandles[handle] = array;
        return handle;
    }

    private void StartRunLoop()
    {
        if (this.engine is null || this.runLoopStarted)
        {
            return;
        }

        this.runLoopStarted = true;
        Task.Run(() => this.RunEngineLoopAsync());
    }

    private async Task RunEngineLoopAsync()
    {
        SmallBasicEngine engine = this.engine!;

        // The engine uses source line zero as its "no line yet" sentinel, so a
        // first line of zero never triggers a NextLine pause. Handle entry stops
        // and breakpoints sitting on the first instruction line explicitly.
        int firstLine = engine.GetSnapshot().ExecutionStack.Last().CurrentSourceLine;
        if (this.stopOnEntry)
        {
            this.SendStopped("entry");
            await this.WaitForResumeAsync().ConfigureAwait(false);
        }
        else if (this.activeControl == "continue" && await this.ShouldStopAtLineAsync(firstLine).ConfigureAwait(false))
        {
            this.SendStopped("breakpoint");
            await this.WaitForResumeAsync().ConfigureAwait(false);
        }

        while (true)
        {
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
                    this.waitingForInput = numeric ? 2 : 1;
                    this.SendOutput(numeric
                        ? "\n[Input] Type a number in the Debug Console and press Enter.\n"
                        : "\n[Input] Type text in the Debug Console and press Enter.\n");
                    this.SendStopped("pause", "Waiting for input");
                    await this.inputSignal.Task.ConfigureAwait(false);
                    break;
                }

                case ExecutionState.Terminated:
                    this.EndSession(0);
                    return;

                case ExecutionState.Running:
                    break;
            }
        }
    }

    private async Task<string?> ComputeStopReasonAsync()
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
                return depth <= this.activeControlDepth ? "step" : null;
            case "stepOut":
                return depth < this.activeControlDepth ? "step" : null;
            default:
                return this.engine is { } engine && await this.ShouldStopAtLineAsync(engine.CurrentSourceLine).ConfigureAwait(false)
                    ? "breakpoint"
                    : null;
        }
    }

    // A line stops execution when it has a verified unconditional breakpoint, or
    // a conditional breakpoint whose condition evaluates to true. Conditions are
    // evaluated against the live program memory; failures simply fall through so
    // the program keeps running.
    private async Task<bool> ShouldStopAtLineAsync(int line)
    {
        if (this.engine is null
            || !this.breakpoints.TryGetValue(this.programPath, out List<SessionBreakpoint>? fileBreakpoints))
        {
            return false;
        }

        foreach (SessionBreakpoint breakpoint in fileBreakpoints)
        {
            if (!breakpoint.Verified || breakpoint.ActualLine != line)
            {
                continue;
            }

            if (breakpoint.CompiledCondition is null)
            {
                return true;
            }

            bool? condition = await this.engine.EvaluateConditionAsync(breakpoint.CompiledCondition).ConfigureAwait(false);
            if (condition == true)
            {
                return true;
            }
        }

        return false;
    }

    private int GetStackDepth() => this.engine?.GetSnapshot().ExecutionStack.Count ?? 0;

    private async Task WaitForResumeAsync()
    {
        Task signal = this.resumeSignal.Task;
        await signal.ConfigureAwait(false);
    }

    private void SignalResume()
    {
        this.resumeSignal.TrySetResult(true);
        this.resumeSignal = NewSignal();
    }

    private void EndSession(int exitCode)
    {
        if (this.endSent)
        {
            return;
        }

        this.endSent = true;
        this.DisposeLibraries();
        this.SendEvent("exited", new JsonObject { ["exitCode"] = exitCode });
        this.SendTerminated();
    }

    private void DisposeLibraries()
    {
        try
        {
            this.libraries?.Dispose();
        }
        catch
        {
            // Session teardown must still report termination if a desktop
            // library fails while closing its UI resources.
        }

        this.libraries = null;
    }

    private void SendTerminated()
    {
        this.SendEvent("terminated");
    }

    private void SendStopped(string reason, string? description = null)
    {
        var body = new JsonObject
        {
            ["reason"] = reason,
            ["threadId"] = ThreadId,
            ["allThreadsStopped"] = true,
        };

        if (description is { })
        {
            body["description"] = description;
        }

        this.SendEvent("stopped", body);
    }

    private void SendOutput(string text)
    {
        this.SendEvent("output", new JsonObject
        {
            ["category"] = "console",
            ["output"] = text,
        });
    }

    private void SendEvent(string eventName, JsonObject? body = null)
    {
        var message = new JsonObject
        {
            ["seq"] = 0,
            ["type"] = "event",
            ["event"] = eventName,
        };

        if (body is { })
        {
            message["body"] = body;
        }

        this.TryWrite(message);
    }

    private void SendResponse(int requestSeq, string command, JsonObject? body = null)
    {
        var message = new JsonObject
        {
            ["seq"] = 0,
            ["type"] = "response",
            ["request_seq"] = requestSeq,
            ["command"] = command,
            ["success"] = true,
        };

        if (body is { })
        {
            message["body"] = body;
        }

        this.TryWrite(message);
    }

    private void SendErrorResponse(int requestSeq, string command, string messageText)
    {
        this.TryWrite(new JsonObject
        {
            ["seq"] = 0,
            ["type"] = "response",
            ["request_seq"] = requestSeq,
            ["command"] = command,
            ["success"] = false,
            ["message"] = messageText,
        });
    }

    private void TryWrite(JsonObject message)
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

    private sealed class DapTextWriter : TextWriter
    {
        private readonly DebugAdapter adapter;

        public DapTextWriter(DebugAdapter adapter)
        {
            this.adapter = adapter;
        }

        public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;

        public override void Write(string? value) => this.adapter.SendOutput(value ?? string.Empty);

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
