using System.Text.Json;
using System.Threading.Channels;
using Microsoft.JSInterop;
using SmallBasic.Blazor.Shared;

namespace SmallBasic.Blazor.Client.Runtime;

/// <summary>
/// One program pushed by the browser shell into the WebAssembly RunHost.
/// </summary>
public sealed class WebRunRequest
{
    public string Name { get; set; } = "program.sb";

    public string Source { get; set; } = string.Empty;

    /// <summary>True when the shell asked for a debug session instead of a plain run.</summary>
    public bool Debug { get; set; }

    public bool StopOnEntry { get; set; }

    /// <summary>Debug session id; used to isolate the webview message channel.</summary>
    public string? SessionId { get; set; }
}

/// <summary>
/// Entry points the standalone web shell (<c>wwwroot/shell.js</c>) and the VS Code
/// webview glue (<c>wwwroot/vscode-webview.js</c>) call through JavaScript
/// interop. Static state is sufficient because a page hosts exactly one Small
/// Basic session, and it keeps the shells free of any knowledge about the Blazor
/// component tree.
/// </summary>
public static class WebRunHost
{
    private static readonly JsonSerializerOptions JsonOptions = JsonDefaults.Web;

    private static readonly Channel<WebRunRequest> Requests = Channel.CreateUnbounded<WebRunRequest>();

    private static BrowserEngineSession? active;

    /// <summary>
    /// True when the page exposes the web shell. The CLI RunHost serves a page
    /// without <c>SmallBasicWebHost</c>, which is how the runner tells the two
    /// hosting modes apart.
    /// </summary>
    public static async Task<bool> IsEmbeddedAsync(IJSRuntime js)
    {
        try
        {
            return await js.InvokeAsync<bool>("SmallBasicWebHost.isWebRunHost");
        }
        catch (JSException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            // JavaScript interop is unavailable (prerendering); that never happens
            // in the WebAssembly host, but the runner stays usable if it does.
            return false;
        }
    }

    /// <summary>Called by the shell with <c>{ name, source, debug, stopOnEntry, sessionId }</c> for every run.</summary>
    [JSInvokable]
    public static void SetSession(string json)
    {
        WebRunRequest? request = Deserialize<WebRunRequest>(json);
        if (request is null || string.IsNullOrWhiteSpace(request.Source))
        {
            return;
        }

        Requests.Writer.TryWrite(request);
    }

    /// <summary>Called by the Stop button of the standalone shell / webview glue.</summary>
    [JSInvokable]
    public static void Stop() => active?.Terminate();

    /// <summary>
    /// Receives one debug command from the webview (<c>vscode-webview.js</c>
    /// forwards the wire JSON of <see cref="HostMessage"/>). Commands for an
    /// unknown version, an unknown session or a missing session are dropped, so
    /// a late message from a finished session can never drive a new one.
    /// </summary>
    [JSInvokable]
    public static void DispatchDebugCommand(string json)
    {
        HostMessage? command = Deserialize<HostMessage>(json);
        if (command is null)
        {
            return;
        }

        BrowserEngineSession? session = active;
        if (session is null)
        {
            return;
        }

        if (command.ProtocolVersion != 0 && command.ProtocolVersion != DebugProtocol.Version)
        {
            return;
        }

        if (!string.IsNullOrEmpty(command.SessionId) &&
            !string.Equals(command.SessionId, session.SessionId, StringComparison.Ordinal))
        {
            return;
        }

        session.EnqueueCommand(command);
    }

    public static Task<WebRunRequest> NextRequestAsync(CancellationToken cancellationToken)
        => Requests.Reader.ReadAsync(cancellationToken).AsTask();

    public static void SetActive(BrowserEngineSession? session) => active = session;

    private static T? Deserialize<T>(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<T>(json, JsonOptions);
        }
        catch (JsonException)
        {
            return default;
        }
    }
}
