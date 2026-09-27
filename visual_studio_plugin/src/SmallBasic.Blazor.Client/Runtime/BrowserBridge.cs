using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using SmallBasic.Blazor.Shared;

namespace SmallBasic.Blazor.Client.Runtime;

public sealed class BrowserBridge : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ClientWebSocket socket = new();
    private readonly SemaphoreSlim sendLock = new(1, 1);
    private readonly Channel<HostMessage> commands = Channel.CreateUnbounded<HostMessage>();

    public async Task ConnectAsync(Uri uri, CancellationToken cancellationToken = default)
    {
        await this.socket.ConnectAsync(uri, cancellationToken);
        _ = this.ReceiveLoopAsync();
    }

    public ValueTask<HostMessage> ReadAsync(CancellationToken cancellationToken = default)
        => this.commands.Reader.ReadAsync(cancellationToken);

    public bool TryRead(out HostMessage? message) => this.commands.Reader.TryRead(out message);

    public void EnqueueLocal(HostMessage message) => this.commands.Writer.TryWrite(message);

    public async Task SendAsync(BrowserMessage message, CancellationToken cancellationToken = default)
    {
        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(message, JsonOptions);
        await this.sendLock.WaitAsync(cancellationToken);
        try
        {
            if (this.socket.State == WebSocketState.Open)
            {
                await this.socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
            }
        }
        finally
        {
            this.sendLock.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (this.socket.State == WebSocketState.Open)
        {
            await this.socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Small Basic session ended", CancellationToken.None);
        }

        this.socket.Dispose();
        this.sendLock.Dispose();
    }

    private async Task ReceiveLoopAsync()
    {
        var buffer = new byte[16 * 1024];
        try
        {
            while (this.socket.State == WebSocketState.Open)
            {
                using var payload = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await this.socket.ReceiveAsync(buffer, CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        this.commands.Writer.TryComplete();
                        return;
                    }

                    payload.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                HostMessage? message = JsonSerializer.Deserialize<HostMessage>(payload.ToArray(), JsonOptions);
                if (message is not null)
                {
                    await this.commands.Writer.WriteAsync(message);
                }
            }
        }
        catch (Exception ex)
        {
            this.commands.Writer.TryComplete(ex);
        }
    }
}
