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
public sealed class DebugAdapter : DapAdapterBase
{
    private const long GlobalsReference = 1;

    private readonly Dictionary<string, List<SessionBreakpoint>> breakpoints = new Dictionary<string, List<SessionBreakpoint>>(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<long, ArrayValue> arrayHandles = new Dictionary<long, ArrayValue>();
    private readonly Dictionary<long, IReadOnlyDictionary<string, BaseValue>> localHandles = new Dictionary<long, IReadOnlyDictionary<string, BaseValue>>();

    private SmallBasicEngine? engine;
    private SmallBasicCompilation? compilation;
    private RuntimeLibrariesCollection? libraries;
    private string programPath = string.Empty;
    private string programName = "program.sb";

    private bool configurationDone;
    private bool runLoopStarted;
#if GRAPHICS_HOST
    private bool usesGraphics;
#endif
    private long nextVariableHandle = GlobalsReference + 1;

    private DebugAdapter(DapStream dap)
        : base(dap)
    {
    }

    public static async Task RunAsync()
    {
        // stdin/stdout carry DAP frames, so the console streams are off-limits
        // for program I/O. TextWindow output is bridged to DAP output events and
        // input arrives through evaluate requests, exactly like the TS adapter.
        var adapter = new DebugAdapter(new DapStream(Console.OpenStandardInput(), Console.OpenStandardOutput()));
        await adapter.MessageLoopAsync().ConfigureAwait(false);
    }

    /// <summary>Program output goes to the debug console, where `evaluate` reads it back.</summary>
    protected override string OutputCategory => "console";

    protected override DebuggerSnapshot? CurrentSnapshot => this.engine?.GetSnapshot();

    protected override int? CurrentEngineLine => this.engine?.CurrentSourceLine;

    protected sealed override void OnBeforeStopped()
    {
        // Handles reference paused memory; a resume invalidates every handle
        // handed out since the previous stop.
        this.arrayHandles.Clear();
        this.localHandles.Clear();
        this.nextVariableHandle = GlobalsReference + 1;
    }

    protected override void DisposeEngineResources()
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

    private sealed class SessionBreakpoint
    {
        public int RequestedLine { get; set; }

        public int? ActualLine { get; set; }

        public bool Verified { get; set; }

        public string? Condition { get; set; }

        public CompiledExpression? CompiledCondition { get; set; }
    }

    protected override async Task DispatchRequestAsync(JsonObject request)
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
                    ["supportsEvaluateForHovers"] = true,
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
                this.HandleScopes(seq, command, arguments);
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
                this.activeControlLine = this.GetStepLine(stepOut: false);
                this.pauseRequested = false;
                this.SendResponse(seq, command);
                this.SignalResume();
                break;

            case "stepIn":
                this.activeControl = "stepIn";
                this.activeControlDepth = this.GetStackDepth();
                this.activeControlLine = this.GetStepLine(stepOut: false);
                this.pauseRequested = false;
                this.SendResponse(seq, command);
                this.SignalResume();
                break;

            case "stepOut":
                this.activeControl = "stepOut";
                this.activeControlDepth = this.GetStackDepth();
                this.activeControlLine = this.GetStepLine(stepOut: true);
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
                await this.HandleEvaluateAsync(seq, command, arguments).ConfigureAwait(false);
                break;

            case "terminate":
                this.SendResponse(seq, command);
                this.EndSession(0);
                break;

            case "disconnect":
                this.SendResponse(seq, command);
                // EndSession is guarded by endSent: after a natural program end
                // this only disposes nothing and sends nothing, avoiding the
                // duplicate terminated event. Mid-session it reports the end.
                this.EndSession(0);
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

        this.compilation = compilation;

#if !GRAPHICS_HOST
        if (compilation.Analysis.UsesGraphicsWindow)
        {
            this.SendErrorResponse(seq, command, "This C# debug host is text-only. Use the Windows C# host for GraphicsWindow/Shapes/Turtle programs.");
            return;
        }
#endif

#if GRAPHICS_HOST
        this.usesGraphics = compilation.Analysis.UsesGraphicsWindow;
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

        if (reference == GlobalsReference)
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
        else if (this.localHandles.TryGetValue(reference, out IReadOnlyDictionary<string, BaseValue>? locals))
        {
            foreach (KeyValuePair<string, BaseValue> pair in locals.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase))
            {
                variables.Add(this.CreateVariable(pair.Key, pair.Value));
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

    private void HandleScopes(int seq, string command, JsonObject? arguments)
    {
        int frameId = (int?)arguments?["frameId"] ?? 1;
        Frame? frame = this.GetFrame(frameId);
        long localsReference = frame is { } ? this.RegisterLocals(frame.Locals) : 0;
        this.SendResponse(seq, command, new JsonObject
        {
            ["scopes"] = new JsonArray(
                new JsonObject
                {
                    ["name"] = "Globals",
                    ["variablesReference"] = GlobalsReference,
                    ["expensive"] = false,
                },
                new JsonObject
                {
                    ["name"] = "Locals",
                    ["variablesReference"] = localsReference,
                    ["expensive"] = false,
                }),
        });
    }

    private async Task HandleEvaluateAsync(int seq, string command, JsonObject? arguments)
    {
        string expression = ((string?)arguments?["expression"] ?? string.Empty).Trim();

        if (this.waitingForInput && this.libraries is { } libraries && this.engine is { } engine)
        {
            libraries.TextWindow.SetPendingInput(expression);
            engine.InputReceived();
            this.waitingForInput = false;
            this.SendResponse(seq, command, new JsonObject { ["result"] = expression, ["variablesReference"] = 0 });
            this.CompleteInput();
            return;
        }

        if (this.engine is { } runningEngine && this.compilation is { } sourceCompilation && expression.Length > 0)
        {
            CompiledExpression? compiled = sourceCompilation.CompileExpression(expression);
            if (compiled is { })
            {
                int frameId = (int?)arguments?["frameId"] ?? 1;
                BaseValue? value = await runningEngine.EvaluateExpressionAsync(compiled, this.GetFrame(frameId)).ConfigureAwait(false);
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
        long handle = this.nextVariableHandle++;
        this.arrayHandles[handle] = array;
        return handle;
    }

    private long RegisterLocals(IReadOnlyDictionary<string, BaseValue> locals)
    {
        long handle = this.nextVariableHandle++;
        this.localHandles[handle] = locals;
        return handle;
    }

    private Frame? GetFrame(int frameId)
    {
        if (frameId < 1 || this.engine?.GetSnapshot() is not DebuggerSnapshot snapshot)
        {
            return null;
        }

        return snapshot.ExecutionStack.Reverse().ElementAtOrDefault(frameId - 1);
    }

    private void StartRunLoop()
    {
        if (this.engine is null || this.runLoopStarted)
        {
            return;
        }

        this.runLoopStarted = true;
        Task.Run(() => this.RunEngineLoopAsync(this.engine));
    }

#if GRAPHICS_HOST
    protected override bool CheckRunLoopEnded()
    {
        if (this.usesGraphics && GraphicsWindowLibrary.HasShutdown)
        {
            // The user closed the graphics window: end the session gracefully
            // instead of failing the next graphics call on a dead dispatcher.
            this.EndSession(0);
            return true;
        }

        return false;
    }
#endif

    // A line stops execution when it has a verified unconditional breakpoint, or
    // a conditional breakpoint whose condition evaluates to true. Conditions are
    // evaluated against the live program memory; failures simply fall through so
    // the program keeps running.
    protected override async Task<bool> ShouldStopAtLineAsync(int line)
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
}
