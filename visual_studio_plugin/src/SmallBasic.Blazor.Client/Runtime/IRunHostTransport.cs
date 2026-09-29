using SmallBasic.Blazor.Shared;

namespace SmallBasic.Blazor.Client.Runtime;

/// <summary>
/// Channel used by <see cref="BrowserEngineSession"/> to talk to whoever drives
/// the WebAssembly engine:
/// <list type="bullet">
/// <item><see cref="BrowserBridge"/> - the WebSocket bridge of the CLI RunHost.</item>
/// <item><see cref="WebShellTransport"/> - the browser shell of the standalone web RunHost.</item>
/// </list>
/// Messages flow in both directions: <see cref="SendAsync"/> publishes output and
/// lifecycle events, while <see cref="ReadAsync"/>/<see cref="TryRead"/> receive
/// host commands (debugger control and program input).
/// </summary>
public interface IRunHostTransport : IAsyncDisposable
{
    ValueTask<HostMessage> ReadAsync(CancellationToken cancellationToken = default);

    bool TryRead(out HostMessage? message);

    void EnqueueLocal(HostMessage message);

    Task SendAsync(BrowserMessage message, CancellationToken cancellationToken = default);
}
