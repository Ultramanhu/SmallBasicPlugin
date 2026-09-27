using System.Net.WebSockets;
using SmallBasic.Blazor.Shared;
using SmallBasic.Compiler;
using SmallBasic.Compiler.Runtime;

namespace SmallBasic.Blazor.Client.Runtime;

public sealed class BrowserEngineSession : IAsyncDisposable
{
    private readonly SessionDescriptor descriptor;
    private readonly RuntimeViewModel view;
    private readonly BrowserBridge bridge;
    private readonly BrowserLibraries libraries;
    private readonly SmallBasicCompilation compilation;
    private readonly SmallBasicEngine engine;
    private HashSet<int> breakpoints = new();
    private bool waitingForDebugInput;

    public BrowserEngineSession(SessionDescriptor descriptor, RuntimeViewModel view, BrowserBridge bridge)
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
            await this.bridge.SendAsync(new BrowserMessage { Type = "ready" });
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
            await this.bridge.SendAsync(new BrowserMessage { Type = "output", Text = ex + Environment.NewLine });
            await this.bridge.SendAsync(new BrowserMessage { Type = "terminated", ExitCode = 4 });
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
        while (true)
        {
            switch (this.engine.State)
            {
                case ExecutionState.Running:
                    await this.engine.Execute();
                    if (this.engine.State == ExecutionState.Running)
                    {
                        await Task.Delay(10);
                    }

                    break;
                case ExecutionState.BlockedOnStringInput:
                case ExecutionState.BlockedOnNumberInput:
                    bool number = this.engine.State == ExecutionState.BlockedOnNumberInput;
                    this.view.SetStatus(number ? "Waiting for a number" : "Waiting for input");
                    string input = await this.view.RequestInputAsync(number);
                    this.libraries.TextWindow.SetPendingInput(input);
                    this.engine.InputReceived();
                    this.view.SetStatus("Running");
                    break;
                case ExecutionState.Paused:
                    this.engine.Continue();
                    break;
                case ExecutionState.Terminated:
                    this.view.SetStatus("Completed");
                    await this.bridge.SendAsync(new BrowserMessage { Type = "terminated", ExitCode = 0 });
                    return;
            }
        }
    }

    private async Task RunDebugAsync()
    {
        HostMessage start;
        do
        {
            start = await this.bridge.ReadAsync();
            this.ApplyHostMessage(start);
        }
        while (start.Type != "start" && start.Type != "stop");

        if (start.Type == "stop")
        {
            this.engine.Terminate();
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
            this.ApplyHostMessage(command);
            if (command.Type == "stop")
            {
                this.engine.Terminate();
                break;
            }

            if (command.Type == "control")
            {
                await this.ExecuteControlAsync(command.Control ?? "continue", command.Depth);
            }
        }

        this.view.SetStatus("Completed");
        await this.bridge.SendAsync(new BrowserMessage { Type = "terminated", ExitCode = 0 });
    }

    private async Task ExecuteControlAsync(string control, int startingDepth)
    {
        this.view.SetStatus("Running under debugger");
        if (this.engine.State == ExecutionState.Paused)
        {
            this.engine.Continue();
        }

        while (true)
        {
            while (this.bridge.TryRead(out HostMessage? pending) && pending is not null)
            {
                this.ApplyHostMessage(pending);
                if (pending.Type == "stop")
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
                    int line = this.engine.CurrentSourceLine;
                    int depth = this.engine.GetSnapshot().ExecutionStack.Count;
                    bool shouldStop = this.breakpoints.Contains(line)
                        || control == "stepIn"
                        || (control == "next" && depth <= startingDepth)
                        || (control == "stepOut" && depth < startingDepth);
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
        await this.bridge.SendAsync(this.CreateSnapshotMessage("input", numberInput: number));

        while (true)
        {
            HostMessage command = await this.bridge.ReadAsync();
            this.ApplyHostMessage(command);
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

            if (command.Type == "stop")
            {
                this.engine.Terminate();
                this.waitingForDebugInput = false;
                return;
            }
        }
    }

    private void ApplyHostMessage(HostMessage message)
    {
        if (message.Breakpoints.Length > 0 || message.Type == "breakpoints" || message.Type == "start")
        {
            this.breakpoints = message.Breakpoints.ToHashSet();
        }
    }

    private async Task SendStoppedAsync(string reason, int? lineOverride = null)
    {
        this.view.SetStatus($"Paused: {reason}");
        await this.bridge.SendAsync(this.CreateSnapshotMessage("stopped", reason, lineOverride));
    }

    private BrowserMessage CreateSnapshotMessage(string type, string? reason = null, int? lineOverride = null, bool numberInput = false)
    {
        DebuggerSnapshot snapshot = this.engine.GetSnapshot();
        DebugFrame[] frames = snapshot.ExecutionStack.Reverse().Select(frame => new DebugFrame
        {
            Name = frame.Module.Name,
            Line = frame.CurrentSourceLine,
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

    private void ForwardOutput(string text) => _ = this.bridge.SendAsync(new BrowserMessage { Type = "output", Text = text });
}
