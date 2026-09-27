using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;
using SmallBasic.Blazor.Shared;

namespace SmallBasic.Blazor.RunHost.Hosting;

public sealed class BlazorHostSession
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly Channel<BrowserMessage> messages = Channel.CreateUnbounded<BrowserMessage>();
    private readonly SemaphoreSlim sendLock = new(1, 1);
    private readonly TaskCompletionSource<bool> connected = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource<bool> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource<int> completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private WebSocket? socket;

    public BlazorHostSession(SessionDescriptor descriptor)
    {
        this.Descriptor = descriptor;
    }

    public SessionDescriptor Descriptor { get; }

    public Task<int> Completion => this.completion.Task;

    public Task WaitUntilConnectedAsync() => this.connected.Task;

    public Task WaitUntilReadyAsync() => this.ready.Task;

    public ValueTask<BrowserMessage> ReadAsync(CancellationToken cancellationToken = default)
        => this.messages.Reader.ReadAsync(cancellationToken);

    public async Task SendAsync(HostMessage message, CancellationToken cancellationToken = default)
    {
        WebSocket? current = this.socket;
        if (current is null || current.State != WebSocketState.Open)
        {
            return;
        }

        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(message, JsonOptions);
        await this.sendLock.WaitAsync(cancellationToken);
        try
        {
            if (current.State == WebSocketState.Open)
            {
                await current.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
            }
        }
        finally
        {
            this.sendLock.Release();
        }
    }

    public async Task AttachAsync(WebSocket webSocket, CancellationToken cancellationToken)
    {
        if (Interlocked.CompareExchange(ref this.socket, webSocket, null) is not null)
        {
            await webSocket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "The session already has a browser.", cancellationToken);
            return;
        }

        this.connected.TrySetResult(true);
        var buffer = new byte[16 * 1024];
        try
        {
            while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                using var payload = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await webSocket.ReceiveAsync(buffer, cancellationToken);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        if (!this.completion.Task.IsCompleted)
                        {
                            this.completion.TrySetResult(5);
                        }

                        return;
                    }

                    payload.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                BrowserMessage? message = JsonSerializer.Deserialize<BrowserMessage>(payload.ToArray(), JsonOptions);
                if (message is null)
                {
                    continue;
                }

                if (message.Type == "ready")
                {
                    this.ready.TrySetResult(true);
                }
                else if (message.Type == "terminated")
                {
                    this.completion.TrySetResult(message.ExitCode);
                }

                await this.messages.Writer.WriteAsync(message, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (WebSocketException)
        {
            this.completion.TrySetResult(5);
        }
        finally
        {
            this.messages.Writer.TryComplete();
        }
    }
}
