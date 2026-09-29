using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.JSInterop;
using SmallBasic.Blazor.Shared;

namespace SmallBasic.Blazor.Client.Runtime;

/// <summary>
/// Bridges the in-browser engine to the standalone web shell (see
/// <c>wwwroot/shell.js</c> and the <c>runhost/web</c> distribution) instead of a
/// WebSocket. It only needs the shell for output and lifecycle notifications
/// because program input is still collected by the rendered Runner input row,
/// exactly like the CLI host does.
/// </summary>
public sealed class WebShellTransport : IRunHostTransport
{
    private const string HostObject = "SmallBasicWebHost";

    /// <summary>
    /// Text output is coalesced before it crosses the interop boundary: a Small
    /// Basic program that writes character by character would otherwise pay one
    /// JavaScript call per character.
    /// </summary>
    private static readonly TimeSpan FlushInterval = TimeSpan.FromMilliseconds(50);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IJSRuntime js;
    private readonly Channel<HostMessage> commands = Channel.CreateUnbounded<HostMessage>();
    private readonly StringBuilder pendingOutput = new();
    private bool flushScheduled;
    private bool disposed;

    public WebShellTransport(IJSRuntime js)
    {
        this.js = js;
    }

    public ValueTask<HostMessage> ReadAsync(CancellationToken cancellationToken = default)
        => this.commands.Reader.ReadAsync(cancellationToken);

    public bool TryRead(out HostMessage? message) => this.commands.Reader.TryRead(out message);

    public void EnqueueLocal(HostMessage message) => this.commands.Writer.TryWrite(message);

    public async Task SendAsync(BrowserMessage message, CancellationToken cancellationToken = default)
    {
        if (this.disposed)
        {
            return;
        }

        if (message.Type == "output")
        {
            this.AppendOutput(message.Text ?? string.Empty);
            return;
        }

        // Lifecycle events must never overtake the text they follow.
        await this.FlushOutputAsync(CancellationToken.None);
        await this.js.InvokeVoidAsync(HostObject + ".notify", cancellationToken, JsonSerializer.Serialize(message, JsonOptions));
    }

    public async ValueTask DisposeAsync()
    {
        this.disposed = true;
        this.commands.Writer.TryComplete();
        try
        {
            await this.FlushOutputAsync(CancellationToken.None);
        }
        catch (JSException)
        {
            // The page went away (navigation or reload) before the last chunk.
        }
        catch (InvalidOperationException)
        {
        }
    }

    private void AppendOutput(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        this.pendingOutput.Append(text);
        if (this.flushScheduled)
        {
            return;
        }

        this.flushScheduled = true;
        _ = this.FlushLaterAsync();
    }

    private async Task FlushLaterAsync()
    {
        await Task.Delay(FlushInterval);
        await this.FlushOutputAsync(CancellationToken.None);
    }

    private async Task FlushOutputAsync(CancellationToken cancellationToken)
    {
        this.flushScheduled = false;
        if (this.pendingOutput.Length == 0 || this.disposed)
        {
            return;
        }

        string text = this.pendingOutput.ToString();
        this.pendingOutput.Clear();
        await this.js.InvokeVoidAsync(HostObject + ".write", cancellationToken, text);
    }
}
