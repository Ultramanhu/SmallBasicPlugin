namespace SmallBasic.RunHost.Debug;

using System.IO;
using System.Text;
using System.Text.Json.Nodes;

/// <summary>
/// Reads and writes Debug Adapter Protocol messages (Content-Length framed JSON)
/// over a pair of streams. All sends are serialized so concurrent writers on the
/// message loop and the engine run loop cannot interleave frames.
/// </summary>
public sealed class DapStream
{
    private readonly Stream input;
    private readonly Stream output;
    private readonly SemaphoreSlim writeLock = new SemaphoreSlim(1, 1);

    public DapStream(Stream input, Stream output)
    {
        this.input = new BufferedStream(input);
        this.output = output;
    }

    public async Task<JsonObject?> ReadMessageAsync()
    {
        var contentLength = -1;

        while (true)
        {
            string? header = await this.ReadHeaderLineAsync().ConfigureAwait(false);
            if (header is null)
            {
                return null;
            }

            if (header.Length == 0)
            {
                break;
            }

            const string prefix = "Content-Length:";
            if (header.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                && int.TryParse(header.Substring(prefix.Length).Trim(), out int parsed))
            {
                contentLength = parsed;
            }
        }

        if (contentLength < 0)
        {
            return null;
        }

        var body = new byte[contentLength];
        var offset = 0;
        while (offset < body.Length)
        {
            int read = await this.input.ReadAsync(body, offset, body.Length - offset).ConfigureAwait(false);
            if (read <= 0)
            {
                return null;
            }

            offset += read;
        }

        return JsonNode.Parse(body) as JsonObject;
    }

    public void WriteMessage(JsonObject message)
    {
        byte[] body = Encoding.UTF8.GetBytes(message.ToJsonString());
        byte[] header = Encoding.ASCII.GetBytes($"Content-Length: {body.Length}\r\n\r\n");

        this.writeLock.Wait();
        try
        {
            this.output.Write(header, 0, header.Length);
            this.output.Write(body, 0, body.Length);
            this.output.Flush();
        }
        finally
        {
            this.writeLock.Release();
        }
    }

    private async Task<string?> ReadHeaderLineAsync()
    {
        var bytes = new List<byte>(64);
        while (true)
        {
            var buffer = new byte[1];
            int read = await this.input.ReadAsync(buffer, 0, 1).ConfigureAwait(false);
            if (read <= 0)
            {
                return bytes.Count == 0 ? null : Encoding.ASCII.GetString(bytes.ToArray());
            }

            byte value = buffer[0];
            if (value == (byte)'\n')
            {
                return Encoding.ASCII.GetString(bytes.ToArray());
            }

            if (value != (byte)'\r')
            {
                bytes.Add(value);
            }
        }
    }
}
