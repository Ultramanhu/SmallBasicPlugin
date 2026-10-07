using System.Globalization;
using System.Text.Json.Nodes;
using SmallBasic.Blazor.RunHost.Debug;
using SmallBasic.Blazor.RunHost.Hosting;
using SmallBasic.Compiler;
using SmallBasic.Compiler.Runtime;
using SmallBasic.RunHost;
using SmallBasic.RunHost.Libraries;

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;

return await RunAsync(args);

static async Task<int> RunAsync(string[] args)
{
    bool noOpen = args.Any(value => value.Equals("--no-open", StringComparison.OrdinalIgnoreCase));
    if (args.Length > 0 && args[0].Equals("debug", StringComparison.OrdinalIgnoreCase))
    {
        await using BlazorRuntimeServer server = await BlazorRuntimeServer.StartAsync(quiet: true);
        var adapter = new BlazorDebugAdapter(server, noOpen);
        await adapter.RunAsync();
        return 0;
    }

    if (!TryGetFile(args, out string filePath))
    {
        Console.Error.WriteLine("Usage: SmallBasic.Blazor.RunHost run --file <program.sb> [--no-open] | SmallBasic.Blazor.RunHost debug [--no-open]");
        return 1;
    }

    if (!File.Exists(filePath))
    {
        Console.Error.WriteLine($"SmallBasic source file not found: {filePath}");
        return 1;
    }

    string source = await File.ReadAllTextAsync(filePath);
    var compilation = new SmallBasicCompilation(source);
    if (compilation.Diagnostics.Count > 0)
    {
        foreach (var diagnostic in compilation.Diagnostics)
        {
            Console.Error.WriteLine(diagnostic.ToDisplayString());
        }

        return 2;
    }

    if (!compilation.Analysis.UsesGraphicsWindow)
    {
        return await RunInConsoleAsync(compilation, args.Any(value => value.Equals("--pause", StringComparison.OrdinalIgnoreCase)));
    }

    await using BlazorRuntimeServer runtime = await BlazorRuntimeServer.StartAsync(quiet: true);
    BlazorHostSession session = runtime.CreateSession(
        filePath,
        source,
        debug: false,
        stopOnEntry: false,
        compilation.Analysis.UsesGraphicsWindow);
    string url = runtime.GetSessionUrl(session);
    Console.WriteLine($"Small Basic Blazor RunHost: {url}");
    WriteSessionControlLine(url, session.Descriptor.Id);
    if (!noOpen)
    {
        try
        {
            BrowserLauncher.Open(url);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Could not open the browser automatically: {ex.Message}");
            Console.Error.WriteLine($"Open this URL manually: {url}");
        }
    }

    return await session.Completion;
}

/// <summary>
/// Emits the machine-readable graphics-session announcement consumed by the
/// Tauri desktop shell (design doc 10, §18.4): one versioned JSON control
/// line on stderr, keeping stdout free for TextWindow output.
/// </summary>
static void WriteSessionControlLine(string url, string sessionId)
{
    var payload = new JsonObject
    {
        ["v"] = 1,
        ["type"] = "smallbasic/blazorSession",
        ["url"] = url,
        ["sessionId"] = sessionId
    };
    Console.Error.WriteLine(payload.ToJsonString());
}

static async Task<int> RunInConsoleAsync(SmallBasicCompilation compilation, bool pauseOnExit)
{
    using var libraries = new RuntimeLibrariesCollection(Console.In, Console.Out, enableGraphics: false);
    var engine = new SmallBasicEngine(compilation, libraries) { Mode = ExecutionMode.RunToEnd };
    try
    {
        await EngineRunLoop.RunAsync(
            engine,
            _ => Console.In.ReadLineAsync(),
            line => libraries.TextWindow.SetPendingInput(line));

        // Runtime errors terminate the engine gracefully instead of throwing;
        // mirror the unified `[Runtime Error] code: message` line to stderr.
        int exitCode = 0;
        if (engine.LastError is { } lastError)
        {
            Console.Error.WriteLine(lastError.ToDisplayString());
            exitCode = 4;
        }

        if (pauseOnExit)
        {
            Console.WriteLine();
            Console.WriteLine("按任意键继续...");
            if (!Console.IsInputRedirected)
            {
                Console.ReadKey(true);
            }
        }

        return exitCode;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine(ex);
        return 4;
    }
}

static bool TryGetFile(string[] args, out string filePath)
{
    filePath = string.Empty;
    if (args.Length == 0 || !args[0].Equals("run", StringComparison.OrdinalIgnoreCase))
    {
        return false;
    }

    for (int index = 1; index < args.Length - 1; index++)
    {
        if (args[index].Equals("--file", StringComparison.OrdinalIgnoreCase))
        {
            filePath = Path.GetFullPath(args[index + 1]);
            return true;
        }
    }

    return false;
}
