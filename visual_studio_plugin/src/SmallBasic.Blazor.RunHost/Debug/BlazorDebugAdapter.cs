using System.Text.Json.Nodes;
using System.Text;
using System.Threading.Channels;
using SmallBasic.Blazor.RunHost.Hosting;
using SmallBasic.Blazor.Shared;
using SmallBasic.Compiler;
using SmallBasic.Compiler.Runtime;
using SmallBasic.RunHost.Debug;
using SmallBasic.RunHost.Libraries;

namespace SmallBasic.Blazor.RunHost.Debug;

public sealed class BlazorDebugAdapter
{
    private const int ThreadId = 1;
    private readonly DapStream dap = new(Console.OpenStandardInput(), Console.OpenStandardOutput());
    private readonly BlazorRuntimeServer server;
    private readonly bool noOpen;
    private readonly Dictionary<string, int[]> breakpoints = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, DebugVariable[]> variableHandles = new();
    private BlazorHostSession? session;
    private SmallBasicCompilation? compilation;
    private BrowserMessage? snapshot;
    private string programPath = string.Empty;
    private int[] executableLines = Array.Empty<int>();
    private int nextSequence = 1;
    private int nextVariableHandle = 2;
    private bool waitingForInput;
    private bool disconnected;
    private bool configurationDone;
    private RuntimeLibrariesCollection? localLibraries;
    private SmallBasicEngine? localEngine;
    private bool stopOnEntry;
    private bool localLoopStarted;
    private bool localEndSent;
    private string activeControl = "continue";
    private int activeControlDepth;
    private int? activeControlLine;
    private bool pauseRequested;
    private TaskCompletionSource<bool> resumeSignal = NewSignal();
    private TaskCompletionSource<bool> inputSignal = NewSignal();

    public BlazorDebugAdapter(BlazorRuntimeServer server, bool noOpen)
    {
        this.server = server;
        this.noOpen = noOpen;
    }

    public async Task RunAsync()
    {
        while (!this.disconnected)
        {
            JsonObject? request;
            try
            {
                request = await this.dap.ReadMessageAsync();
            }
            catch
            {
                return;
            }

            if (request is null)
            {
                return;
            }

            if ((string?)request["type"] == "request")
            {
                await this.DispatchAsync(request);
            }
        }
    }

    private async Task DispatchAsync(JsonObject request)
    {
        int requestSequence = (int?)request["seq"] ?? 0;
        string command = (string?)request["command"] ?? string.Empty;
        JsonObject? arguments = request["arguments"] as JsonObject;

        switch (command)
        {
            case "initialize":
                this.SendResponse(requestSequence, command, new JsonObject
                {
                    ["supportsConfigurationDoneRequest"] = true,
                    ["supportsEvaluateForHovers"] = true,
                    ["supportsStepBack"] = false,
                    ["supportsRestartRequest"] = false,
                });
                this.SendEvent("initialized");
                break;
            case "launch":
                this.HandleLaunch(requestSequence, command, arguments);
                break;
            case "setBreakpoints":
                await this.HandleSetBreakpointsAsync(requestSequence, command, arguments);
                break;
            case "setExceptionBreakpoints":
            case "setFunctionBreakpoints":
                this.SendResponse(requestSequence, command, new JsonObject { ["breakpoints"] = new JsonArray() });
                break;
            case "configurationDone":
                this.configurationDone = true;
                this.SendResponse(requestSequence, command);
                this.StartRuntimeSession();
                break;
            case "threads":
                this.SendResponse(requestSequence, command, new JsonObject
                {
                    ["threads"] = new JsonArray(new JsonObject { ["id"] = ThreadId, ["name"] = "Browser WASM" }),
                });
                break;
            case "stackTrace":
                this.HandleStackTrace(requestSequence, command);
                break;
            case "scopes":
                this.HandleScopes(requestSequence, command, arguments);
                break;
            case "variables":
                this.HandleVariables(requestSequence, command, arguments);
                break;
            case "continue":
                this.SendResponse(requestSequence, command, new JsonObject { ["allThreadsContinued"] = true });
                await this.SendControlAsync("continue");
                break;
            case "next":
                this.SendResponse(requestSequence, command);
                await this.SendControlAsync("next");
                break;
            case "stepIn":
                this.SendResponse(requestSequence, command);
                await this.SendControlAsync("stepIn");
                break;
            case "stepOut":
                this.SendResponse(requestSequence, command);
                await this.SendControlAsync("stepOut");
                break;
            case "pause":
                this.SendResponse(requestSequence, command);
                await this.SendControlAsync("pause");
                break;
            case "evaluate":
                await this.HandleEvaluateAsync(requestSequence, command, arguments);
                break;
            case "disconnect":
            case "terminate":
                this.SendResponse(requestSequence, command);
                if (this.session is not null)
                {
                    await this.session.SendAsync(new HostMessage { Type = "stop" });
                }

                this.localEngine?.Terminate();
                this.localLibraries?.Dispose();

                this.disconnected = true;
                break;
            default:
                this.SendErrorResponse(requestSequence, command, $"Small Basic Blazor debugger does not support request '{command}'.");
                break;
        }
    }

    private void HandleLaunch(int requestSequence, string command, JsonObject? arguments)
    {
        string path = (string?)arguments?["program"] ?? string.Empty;
        this.stopOnEntry = (bool?)arguments?["stopOnEntry"] ?? false;
        if (path.Length == 0 || !File.Exists(path))
        {
            this.SendErrorResponse(requestSequence, command, $"SmallBasic source file not found: {path}");
            return;
        }

        this.programPath = Path.GetFullPath(path);
        string source;
        try
        {
            source = File.ReadAllText(this.programPath);
            this.compilation = new SmallBasicCompilation(source);
        }
        catch (Exception ex)
        {
            this.SendErrorResponse(requestSequence, command, $"Cannot read program file: {ex.Message}");
            return;
        }

        if (this.compilation.Diagnostics.Count > 0)
        {
            string diagnostics = string.Join("\n", this.compilation.Diagnostics.Take(10).Select(item => item.ToDisplayString()));
            this.SendErrorResponse(requestSequence, command, $"The program contains compilation errors:\n{diagnostics}");
            return;
        }

        this.executableLines = this.compilation.GetExecutableLines().OrderBy(line => line).ToArray();
        if (!this.compilation.Analysis.UsesGraphicsWindow)
        {
            this.localLibraries = new RuntimeLibrariesCollection(TextReader.Null, new AdapterTextWriter(this), enableGraphics: false);
            this.localEngine = new SmallBasicEngine(this.compilation, this.localLibraries) { Mode = ExecutionMode.NextLine };
        }
        else
        {
            this.session = this.server.CreateSession(
                this.programPath,
                source,
                debug: true,
                this.stopOnEntry,
                usesGraphics: true);
            string url = this.server.GetSessionUrl(this.session);
            // Machine-readable announcement for the Tauri desktop shell
            // (design doc 10, §18.4): the graphics window is created by the
            // shell, not by parsing human-readable output. stdout stays
            // DAP-only - this is a regular DAP custom event.
            this.SendEvent("smallbasic/blazorSession", new JsonObject
            {
                ["url"] = url,
                ["sessionId"] = this.session.Descriptor.Id,
                ["reason"] = "start"
            });
            try
            {
                if (!this.noOpen)
                {
                    BrowserLauncher.Open(url);
                }
                else
                {
                    this.SendOutput($"Small Basic Blazor graphics session: {url}\n");
                }
            }
            catch (Exception ex)
            {
                this.SendOutput($"Could not open the browser automatically: {ex.Message}\nOpen {url}\n");
            }

            _ = this.PumpBrowserMessagesAsync(this.session);
        }

        this.SendResponse(requestSequence, command);
        if (this.configurationDone)
        {
            this.StartRuntimeSession();
        }
    }

    private async Task HandleSetBreakpointsAsync(int requestSequence, string command, JsonObject? arguments)
    {
        string sourcePath = (string?)arguments?["source"]?["path"] ?? this.programPath;
        // The desktop bridge (doc 10, §18.3) - and any spec-conformant client -
        // sends setBreakpoints from the adapter's `initialized` event, i.e.
        // before `launch` has compiled the program. Resolve the executable-line
        // table from the source here so those breakpoints verify and bind
        // instead of silently degrading to "no executable statement".
        this.EnsureExecutableLines(sourcePath);

        var requested = new List<int>();
        if (arguments?["breakpoints"] is JsonArray entries)
        {
            requested.AddRange(entries.Select(entry => (int?)entry?["line"] ?? 0));
        }

        var response = new JsonArray();
        var actualLines = new List<int>();
        foreach (int requestedLine in requested)
        {
            int requestedZeroBased = Math.Max(0, requestedLine - 1);
            int? actual = this.executableLines.Cast<int?>().FirstOrDefault(line => line >= requestedZeroBased);
            bool verified = actual.HasValue && PathsEqual(sourcePath, this.programPath);
            if (verified)
            {
                actualLines.Add(actual!.Value);
            }

            response.Add(new JsonObject
            {
                ["verified"] = verified,
                ["line"] = verified ? actual!.Value + 1 : requestedLine,
                ["message"] = verified ? null : "No executable Small Basic statement was found at or after this line.",
            });
        }

        this.breakpoints[sourcePath] = actualLines.Distinct().ToArray();
        this.SendResponse(requestSequence, command, new JsonObject { ["breakpoints"] = response });
        if (this.session is not null)
        {
            await this.session.SendAsync(new HostMessage { Type = "breakpoints", Breakpoints = this.AllBreakpoints() });
        }
    }

    private void HandleStackTrace(int requestSequence, string command)
    {
        var frames = new JsonArray();
        DebugFrame[] sourceFrames = this.snapshot?.Frames ?? Array.Empty<DebugFrame>();
        if (sourceFrames.Length == 0 && this.snapshot is not null)
        {
            sourceFrames = new[] { new DebugFrame { Name = "Program", Line = this.snapshot.Line } };
        }

        for (int index = 0; index < sourceFrames.Length; index++)
        {
            DebugFrame frame = sourceFrames[index];
            frames.Add(new JsonObject
            {
                ["id"] = index + 1,
                ["name"] = frame.Name,
                ["line"] = frame.Line + 1,
                ["column"] = 1,
                ["source"] = new JsonObject { ["name"] = Path.GetFileName(this.programPath), ["path"] = this.programPath },
            });
        }

        this.SendResponse(requestSequence, command, new JsonObject { ["stackFrames"] = frames, ["totalFrames"] = frames.Count });
    }

    private void HandleVariables(int requestSequence, string command, JsonObject? arguments)
    {
        int reference = (int?)arguments?["variablesReference"] ?? 0;
        DebugVariable[] values = reference == 1
            ? this.snapshot?.Variables ?? Array.Empty<DebugVariable>()
            : this.variableHandles.GetValueOrDefault(reference, Array.Empty<DebugVariable>());
        var variables = new JsonArray();
        foreach (DebugVariable variable in values)
        {
            int childReference = 0;
            if (variable.Children.Length > 0)
            {
                childReference = this.nextVariableHandle++;
                this.variableHandles[childReference] = variable.Children;
            }

            variables.Add(new JsonObject
            {
                ["name"] = variable.Name,
                ["value"] = variable.Value,
                ["variablesReference"] = childReference,
            });
        }

        this.SendResponse(requestSequence, command, new JsonObject { ["variables"] = variables });
    }

    private void HandleScopes(int requestSequence, string command, JsonObject? arguments)
    {
        int frameId = (int?)arguments?["frameId"] ?? 1;
        DebugVariable[] locals = frameId > 0 && frameId <= (this.snapshot?.Frames.Length ?? 0)
            ? this.snapshot!.Frames[frameId - 1].Variables
            : Array.Empty<DebugVariable>();
        int localsReference = this.nextVariableHandle++;
        this.variableHandles[localsReference] = locals;
        this.SendResponse(requestSequence, command, new JsonObject
        {
            ["scopes"] = new JsonArray(
                new JsonObject { ["name"] = "Globals", ["variablesReference"] = 1, ["expensive"] = false },
                new JsonObject { ["name"] = "Locals", ["variablesReference"] = localsReference, ["expensive"] = false }),
        });
    }

    private async Task HandleEvaluateAsync(int requestSequence, string command, JsonObject? arguments)
    {
        string expression = (string?)arguments?["expression"] ?? string.Empty;
        if (this.waitingForInput && this.localEngine is not null && this.localLibraries is not null)
        {
            this.localLibraries.TextWindow.SetPendingInput(expression);
            this.localEngine.InputReceived();
            this.waitingForInput = false;
            this.SendResponse(requestSequence, command, new JsonObject { ["result"] = expression, ["variablesReference"] = 0 });
            this.inputSignal.TrySetResult(true);
            this.inputSignal = NewSignal();
            return;
        }

        if (this.waitingForInput && this.session is not null)
        {
            await this.session.SendAsync(new HostMessage { Type = "input", Text = expression });
            this.waitingForInput = false;
            this.SendResponse(requestSequence, command, new JsonObject { ["result"] = expression, ["variablesReference"] = 0 });
            return;
        }

        int frameId = (int?)arguments?["frameId"] ?? 1;
        IEnumerable<DebugVariable> visible = this.snapshot?.Variables ?? Array.Empty<DebugVariable>();
        if (frameId > 0 && frameId <= (this.snapshot?.Frames.Length ?? 0))
        {
            visible = this.snapshot!.Frames[frameId - 1].Variables.Concat(visible);
        }

        DebugVariable? value = visible.FirstOrDefault(variable => string.Equals(variable.Name, expression, StringComparison.OrdinalIgnoreCase));
        if (value is not null)
        {
            int reference = 0;
            if (value.Children.Length > 0)
            {
                reference = this.nextVariableHandle++;
                this.variableHandles[reference] = value.Children;
            }

            this.SendResponse(requestSequence, command, new JsonObject
            {
                ["result"] = value.Value,
                ["variablesReference"] = reference,
            });
            return;
        }

        this.SendErrorResponse(requestSequence, command, "Expression evaluation is only used to provide TextWindow input in this debugger.");
    }

    private void StartRuntimeSession()
    {
        if (this.localEngine is not null)
        {
            this.StartLocalLoop();
            return;
        }

        if (this.session is null)
        {
            return;
        }

        BlazorHostSession active = this.session;
        _ = Task.Run(async () =>
        {
            try
            {
                await active.WaitUntilReadyAsync();
                await active.SendAsync(new HostMessage { Type = "start", Breakpoints = this.AllBreakpoints() });
            }
            catch (Exception ex)
            {
                this.SendOutput($"Blazor debugger failed to start: {ex.Message}\n");
                this.SendEvent("terminated");
            }
        });
    }

    private async Task PumpBrowserMessagesAsync(BlazorHostSession active)
    {
        try
        {
            while (true)
            {
                BrowserMessage message = await active.ReadAsync();
                switch (message.Type)
                {
                    case "output":
                        this.SendOutput(message.Text ?? string.Empty);
                        break;
                    case "stopped":
                        this.SetSnapshot(message);
                        this.SendStopped(message.Reason ?? "pause");
                        break;
                    case "input":
                        this.SetSnapshot(message);
                        this.waitingForInput = true;
                        this.SendOutput(message.NumberInput
                            ? "TextWindow is waiting for a number. Enter it in the Debug Console.\n"
                            : "TextWindow is waiting for input. Enter it in the Debug Console.\n");
                        this.SendStopped("pause", "Waiting for TextWindow input");
                        break;
                    case "terminated":
                        this.SendEvent("exited", new JsonObject { ["exitCode"] = message.ExitCode });
                        this.SendEvent("terminated");
                        return;
                }
            }
        }
        catch (ChannelClosedException)
        {
            if (!this.disconnected)
            {
                this.SendEvent("terminated");
            }
        }
    }

    private void SetSnapshot(BrowserMessage message)
    {
        this.snapshot = message;
        this.variableHandles.Clear();
        this.nextVariableHandle = 2;
    }

    private async Task SendControlAsync(string control)
    {
        if (this.localEngine is not null)
        {
            this.activeControl = control;
            this.activeControlDepth = this.localEngine.GetSnapshot().ExecutionStack.Count;
            this.activeControlLine = this.GetLocalStepLine(control == "stepOut");
            if (control == "pause")
            {
                this.pauseRequested = true;
                if (this.localEngine.State == ExecutionState.Running)
                {
                    this.localEngine.Pause();
                }
            }
            else
            {
                this.pauseRequested = false;
                this.resumeSignal.TrySetResult(true);
                this.resumeSignal = NewSignal();
            }

            return;
        }

        if (this.session is not null)
        {
            await this.session.SendAsync(new HostMessage
            {
                Type = "control",
                Control = control,
                Depth = this.snapshot?.Frames.Length ?? 0,
                Breakpoints = this.AllBreakpoints(),
            });
        }
    }

    private int[] AllBreakpoints() => this.breakpoints.Values.SelectMany(lines => lines).Distinct().ToArray();

    private static TaskCompletionSource<bool> NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private void StartLocalLoop()
    {
        if (this.localEngine is null || this.localLoopStarted)
        {
            return;
        }

        this.localLoopStarted = true;
        _ = Task.Run(this.RunLocalLoopAsync);
    }

    private async Task RunLocalLoopAsync()
    {
        SmallBasicEngine engine = this.localEngine!;
        int firstLine = engine.GetSnapshot().ExecutionStack.Last().CurrentSourceLine;
        if (this.stopOnEntry)
        {
            this.CaptureLocalSnapshot("entry", firstLine);
            this.SendStopped("entry");
            await this.WaitForLocalResumeAsync();
        }
        else if (this.IsBreakpointAtLine(firstLine))
        {
            this.CaptureLocalSnapshot("breakpoint", firstLine);
            this.SendStopped("breakpoint");
            await this.WaitForLocalResumeAsync();
        }

        while (!this.disconnected)
        {
            try
            {
                await engine.Execute();
            }
            catch (Exception ex)
            {
                this.SendOutput($"\n[Runtime Error] {ex}\n");
                this.EndLocalSession(1);
                return;
            }

            switch (engine.State)
            {
                case ExecutionState.Paused:
                {
                    string? reason = this.ComputeLocalStopReason();
                    if (reason is null)
                    {
                        engine.Continue();
                    }
                    else
                    {
                        this.CaptureLocalSnapshot(reason);
                        this.SendStopped(reason);
                        await this.WaitForLocalResumeAsync();
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
                    bool number = engine.State == ExecutionState.BlockedOnNumberInput;
                    this.waitingForInput = true;
                    this.CaptureLocalSnapshot("pause");
                    this.SendOutput(number
                        ? "\n[Input] Type a number in the Debug Console and press Enter.\n"
                        : "\n[Input] Type text in the Debug Console and press Enter.\n");
                    this.SendStopped("pause", "Waiting for TextWindow input");
                    await this.inputSignal.Task;
                    break;
                }
                case ExecutionState.Terminated:
                    this.EndLocalSession(0);
                    return;
                case ExecutionState.Running:
                    await Task.Delay(10);
                    break;
            }
        }
    }

    private string? ComputeLocalStopReason()
    {
        if (this.pauseRequested)
        {
            this.pauseRequested = false;
            return "pause";
        }

        int depth = this.localEngine?.GetSnapshot().ExecutionStack.Count ?? 0;
        return this.activeControl switch
        {
            "stepIn" => "step",
            "next" => depth <= this.activeControlDepth && this.localEngine?.CurrentSourceLine != this.activeControlLine ? "step" : null,
            "stepOut" => depth < this.activeControlDepth && this.localEngine?.CurrentSourceLine != this.activeControlLine ? "step" : null,
            _ => this.localEngine is not null && this.IsBreakpointAtLine(this.localEngine.CurrentSourceLine) ? "breakpoint" : null,
        };
    }

    private int? GetLocalStepLine(bool stepOut)
    {
        DebuggerSnapshot? snapshot = this.localEngine?.GetSnapshot();
        if (snapshot is null)
        {
            return null;
        }

        Frame? frame = snapshot.ExecutionStack.Reverse().ElementAtOrDefault(stepOut ? 1 : 0);
        return frame?.CurrentSourceLine;
    }

    private bool IsBreakpointAtLine(int line) => this.AllBreakpoints().Contains(line);

    private async Task WaitForLocalResumeAsync()
    {
        Task signal = this.resumeSignal.Task;
        await signal;
    }

    private void CaptureLocalSnapshot(string reason, int? lineOverride = null)
    {
        if (this.localEngine is null)
        {
            return;
        }

        DebuggerSnapshot current = this.localEngine.GetSnapshot();
        this.SetSnapshot(new BrowserMessage
        {
            Type = "stopped",
            Reason = reason,
            Line = lineOverride ?? current.CurrentSourceLine,
            Frames = current.ExecutionStack.Reverse().Select(frame => new DebugFrame
            {
                Name = frame.Module.Name,
                Line = frame.CurrentSourceLine,
                Variables = frame.Locals.OrderBy(pair => pair.Key).Select(pair => ConvertLocalVariable(pair.Key, pair.Value)).ToArray(),
            }).ToArray(),
            Variables = current.Memory.OrderBy(pair => pair.Key).Select(pair => ConvertLocalVariable(pair.Key, pair.Value)).ToArray(),
        });
    }

    private static DebugVariable ConvertLocalVariable(string name, BaseValue value)
        => new()
        {
            Name = name,
            Value = value.ToDisplayString(),
            Children = value is ArrayValue array
                ? array.OrderBy(pair => pair.Key).Select(pair => ConvertLocalVariable(pair.Key, pair.Value)).ToArray()
                : Array.Empty<DebugVariable>(),
        };

    private void EndLocalSession(int exitCode)
    {
        if (this.localEndSent)
        {
            return;
        }

        this.localEndSent = true;
        this.localLibraries?.Dispose();
        this.localLibraries = null;
        this.SendEvent("exited", new JsonObject { ["exitCode"] = exitCode });
        this.SendEvent("terminated");
    }

    private sealed class AdapterTextWriter : TextWriter
    {
        private readonly BlazorDebugAdapter adapter;

        public AdapterTextWriter(BlazorDebugAdapter adapter)
        {
            this.adapter = adapter;
        }

        public override Encoding Encoding => Encoding.UTF8;

        public override void Write(char value) => this.adapter.SendOutput(value.ToString());

        public override void Write(string? value)
        {
            if (value is not null)
            {
                this.adapter.SendOutput(value);
            }
        }

        public override Task WriteAsync(string? value)
        {
            this.Write(value);
            return Task.CompletedTask;
        }

        public override Task WriteLineAsync(string? value)
        {
            this.adapter.SendOutput((value ?? string.Empty) + Environment.NewLine);
            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// Loads the compilation for a source path when <c>launch</c> has not run
    /// yet, so breakpoints sent early can be validated (the desktop transport
    /// configures them from the adapter's <c>initialized</c> event).
    /// </summary>
    private void EnsureExecutableLines(string sourcePath)
    {
        if (this.executableLines.Length > 0 || sourcePath.Length == 0 || !File.Exists(sourcePath))
        {
            return;
        }

        try
        {
            var compilation = new SmallBasicCompilation(File.ReadAllText(sourcePath));
            if (compilation.Diagnostics.Count > 0)
            {
                return;
            }

            this.compilation = compilation;
            this.programPath = Path.GetFullPath(sourcePath);
            this.executableLines = compilation.GetExecutableLines().OrderBy(line => line).ToArray();
        }
        catch
        {
            // Breakpoints stay unverified; the launch request reports the error.
        }
    }

    private static bool PathsEqual(string left, string right)
    {
        if (left.Length == 0 || right.Length == 0)
        {
            return false;
        }

        return string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
    }

    private void SendStopped(string reason, string? description = null)
    {
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

    private void SendOutput(string text) => this.SendEvent("output", new JsonObject { ["category"] = "stdout", ["output"] = text });

    private void SendEvent(string eventName, JsonObject? body = null)
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

        this.dap.WriteMessage(message);
    }

    private void SendResponse(int requestSequence, string command, JsonObject? body = null)
    {
        var message = new JsonObject
        {
            ["seq"] = Interlocked.Increment(ref this.nextSequence),
            ["type"] = "response",
            ["request_seq"] = requestSequence,
            ["success"] = true,
            ["command"] = command,
        };
        if (body is not null)
        {
            message["body"] = body;
        }

        this.dap.WriteMessage(message);
    }

    private void SendErrorResponse(int requestSequence, string command, string messageText)
    {
        this.dap.WriteMessage(new JsonObject
        {
            ["seq"] = Interlocked.Increment(ref this.nextSequence),
            ["type"] = "response",
            ["request_seq"] = requestSequence,
            ["success"] = false,
            ["command"] = command,
            ["message"] = messageText,
            ["body"] = new JsonObject { ["error"] = new JsonObject { ["format"] = messageText } },
        });
    }
}
