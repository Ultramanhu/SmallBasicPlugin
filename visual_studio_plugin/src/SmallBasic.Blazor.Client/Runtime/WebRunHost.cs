using System.Text.Json;
using System.Threading.Channels;
using Microsoft.JSInterop;

namespace SmallBasic.Blazor.Client.Runtime;

/// <summary>
/// One program pushed by the browser shell into the WebAssembly RunHost.
/// </summary>
public sealed class WebRunRequest
{
    public string Name { get; set; } = "program.sb";

    public string Source { get; set; } = string.Empty;
}

/// <summary>
/// Entry points the standalone web shell (<c>wwwroot/shell.js</c>) calls through
/// JavaScript interop. Static state is sufficient because a page hosts exactly
/// one Small Basic session, and it keeps the shell free of any knowledge about
/// the Blazor component tree.
/// </summary>
public static class WebRunHost
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

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

    /// <summary>Called by the shell with <c>{ name, source }</c> for every run.</summary>
    [JSInvokable]
    public static void SetSession(string json)
    {
        WebRunRequest? request = Deserialize(json);
        if (request is null || string.IsNullOrWhiteSpace(request.Source))
        {
            return;
        }

        Requests.Writer.TryWrite(request);
    }

    /// <summary>Called by the shell's Stop button.</summary>
    [JSInvokable]
    public static void Stop() => active?.Terminate();

    public static Task<WebRunRequest> NextRequestAsync(CancellationToken cancellationToken)
        => Requests.Reader.ReadAsync(cancellationToken).AsTask();

    public static void SetActive(BrowserEngineSession? session) => active = session;

    private static WebRunRequest? Deserialize(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<WebRunRequest>(json, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
