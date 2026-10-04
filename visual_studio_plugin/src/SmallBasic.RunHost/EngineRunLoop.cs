using SmallBasic.Compiler;
using SmallBasic.Compiler.Runtime;

namespace SmallBasic.RunHost;

/// <summary>
/// The run-to-completion engine loop shared by the console RunHost, the Blazor
/// console runner and the browser session: it executes the engine until it
/// terminates, feeding TextWindow input requests through host-supplied
/// delegates, so the state machine exists exactly once.
/// </summary>
public static class EngineRunLoop
{
    /// <summary>
    /// Drives <paramref name="engine"/> (in <see cref="ExecutionMode.RunToEnd"/>
    /// mode) to termination.
    /// </summary>
    /// <param name="readInput">Reads one TextWindow line; the argument tells a
    /// numeric <c>ReadNumber</c> request. May return <c>null</c> for an empty line.</param>
    /// <param name="setPendingInput">Queues the line for the TextWindow library.</param>
    /// <param name="inputReceived">Invoked after the engine consumed the input (e.g. to reset a status).</param>
    /// <param name="runningDelayMs">Idle wait when the engine is still running
    /// between slices (event-only programs have no active frame here).</param>
    public static async Task RunAsync(
        SmallBasicEngine engine,
        Func<bool, Task<string?>> readInput,
        Action<string> setPendingInput,
        Action? inputReceived = null,
        int runningDelayMs = 10)
    {
        while (true)
        {
            switch (engine.State)
            {
                case ExecutionState.Running:
                    await engine.Execute().ConfigureAwait(false);
                    if (engine.State == ExecutionState.Running)
                    {
                        // Event-only programs have no active frame between input
                        // or timer callbacks. Avoid a hot polling loop while still
                        // giving queued events prompt interpreter-thread service.
                        await Task.Delay(runningDelayMs).ConfigureAwait(false);
                    }

                    break;
                case ExecutionState.BlockedOnStringInput:
                case ExecutionState.BlockedOnNumberInput:
                    string? line = await readInput(engine.State == ExecutionState.BlockedOnNumberInput).ConfigureAwait(false);
                    setPendingInput(line ?? string.Empty);
                    engine.InputReceived();
                    inputReceived?.Invoke();
                    break;
                case ExecutionState.Paused:
                    engine.Continue();
                    break;
                case ExecutionState.Terminated:
                    return;
                default:
                    throw new InvalidOperationException($"Unexpected engine state: {engine.State}");
            }
        }
    }
}
