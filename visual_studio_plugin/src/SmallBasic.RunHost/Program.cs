using System.Globalization;
using System.IO;
using SmallBasic.RunHost.Debug;
using SmallBasic.RunHost.Libraries;
using SmallBasic.Compiler;

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;

if (args.Length == 1 && string.Equals(args[0], "--capabilities", StringComparison.OrdinalIgnoreCase))
{
    Console.WriteLine("{\"protocolVersion\":2,\"capabilities\":[\"function-v1\"]}");
    return;
}

if (args.Length >= 1 && string.Equals(args[0], "debug", StringComparison.OrdinalIgnoreCase))
{
    // DAP debug adapter mode: stdin/stdout carry the protocol, so all program
    // I/O is bridged through DAP events (see DebugAdapter).
#if NET48
    // The official SmallBasicLibrary kills its host process (Process.Kill) when
    // a graphics program ends, unless the code runs inside an AppDomain named
    // "Debuggee" (the host domain of the original Small Basic IDE). Running the
    // adapter inside such a domain lets a closed GraphicsWindow shut the session
    // down gracefully instead of tearing the adapter down mid-stream.
    AppDomain.CreateDomain("Debuggee").DoCallBack(static () =>
    {
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        DebugAdapter.RunAsync().ConfigureAwait(false).GetAwaiter().GetResult();
    });
    return;
#else
    await DebugAdapter.RunAsync().ConfigureAwait(false);
    return;
#endif
}

if (!TryParseArguments(args, out var filePath, out var pauseOnExit, out var errorMessage))
{
    Console.Error.WriteLine(errorMessage);
    PauseAndExit(1, pauseOnExit: true);
}

if (!File.Exists(filePath))
{
    Console.Error.WriteLine($"SmallBasic source file not found: {filePath}");
    PauseAndExit(1, pauseOnExit);
}

var compilation = new SmallBasicCompilation(File.ReadAllText(filePath));
if (compilation.Diagnostics.Count > 0)
{
    foreach (var diagnostic in compilation.Diagnostics)
    {
        Console.Error.WriteLine(diagnostic.ToDisplayString());
    }

    PauseAndExit(1, pauseOnExit);
}

using var libraries = new RuntimeLibrariesCollection(Console.In, Console.Out, compilation.Analysis.UsesGraphicsWindow);
var engine = new SmallBasicEngine(compilation, libraries)
{
    Mode = ExecutionMode.RunToEnd,
};

try
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
                    await Task.Delay(1).ConfigureAwait(false);
                }

                break;
            case ExecutionState.BlockedOnStringInput:
                libraries.TextWindow.SetPendingInput(await Console.In.ReadLineAsync().ConfigureAwait(false) ?? string.Empty);
                engine.InputReceived();
                break;
            case ExecutionState.BlockedOnNumberInput:
                libraries.TextWindow.SetPendingInput(await Console.In.ReadLineAsync().ConfigureAwait(false) ?? "0");
                engine.InputReceived();
                break;
            case ExecutionState.Paused:
                engine.Continue();
                break;
            case ExecutionState.Terminated:
                PauseAndExit(0, pauseOnExit);
                break;
            default:
                throw new InvalidOperationException($"Unexpected engine state: {engine.State}");
        }
    }
}
catch (NotSupportedException ex)
{
    Console.Error.WriteLine(ex.Message);
    PauseAndExit(3, pauseOnExit);
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex);
    PauseAndExit(4, pauseOnExit);
}

static void PauseAndExit(int code, bool pauseOnExit)
{
    if (pauseOnExit)
    {
        Console.Out.Flush();
        Console.Error.Flush();
        Console.WriteLine();
        Console.WriteLine("按任意键继续...");
        try
        {
            Console.ReadKey(true);
        }
        catch
        {
            // Console might not have a keyboard (e.g. redirected input)
        }
    }

    Environment.Exit(code);
}

static bool TryParseArguments(string[] args, out string filePath, out bool pauseOnExit, out string errorMessage)
{
    filePath = string.Empty;
    pauseOnExit = args.Any(value => string.Equals(value, "--pause", StringComparison.OrdinalIgnoreCase));
    errorMessage = "Usage: SmallBasic.RunHost run --file <program.sb> [--pause] | SmallBasic.RunHost debug | SmallBasic.RunHost --capabilities";

    if (args.Length >= 3 && string.Equals(args[0], "run", StringComparison.OrdinalIgnoreCase))
    {
        for (var i = 1; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--file", StringComparison.OrdinalIgnoreCase))
            {
                filePath = Path.GetFullPath(args[i + 1]);
                errorMessage = string.Empty;
                return true;
            }
        }
    }

    return false;
}
