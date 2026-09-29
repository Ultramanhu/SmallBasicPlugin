namespace SmallBasic.LanguageServices
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Text;
    using System.Text.Json.Nodes;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    /// Reads and writes LSP/JSON-RPC messages framed via Content-Length headers.
    /// </summary>
    public sealed class SmallBasicLspStream
    {
        private readonly Stream input;
        private readonly Stream output;
        private readonly SemaphoreSlim writeLock = new SemaphoreSlim(1, 1);

        public SmallBasicLspStream(Stream input, Stream output)
        {
            this.input = new BufferedStream(input);
            this.output = output;
        }

        /// <summary>
        /// Reads the next framed JSON message. Returns <see langword="null"/> when the
        /// input ends or the framing is incomplete.
        /// </summary>
        public async Task<JsonObject?> ReadMessageAsync(CancellationToken cancellationToken)
        {
            int contentLength = -1;

            while (true)
            {
                string header = await this.ReadHeaderLineAsync(cancellationToken).ConfigureAwait(false);
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

            byte[] body = new byte[contentLength];
            int offset = 0;
            while (offset < body.Length)
            {
                int read = await this.input.ReadAsync(body, offset, body.Length - offset, cancellationToken).ConfigureAwait(false);
                if (read <= 0)
                {
                    return null;
                }

                offset += read;
            }

            return JsonNode.Parse(body) as JsonObject;
        }

        public async Task WriteMessageAsync(JsonObject message, CancellationToken cancellationToken)
        {
            byte[] body = Encoding.UTF8.GetBytes(message.ToJsonString());
            byte[] header = Encoding.ASCII.GetBytes($"Content-Length: {body.Length}\r\n\r\n");

            await this.writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await this.output.WriteAsync(header, 0, header.Length, cancellationToken).ConfigureAwait(false);
                await this.output.WriteAsync(body, 0, body.Length, cancellationToken).ConfigureAwait(false);
                await this.output.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                this.writeLock.Release();
            }
        }

        private async Task<string?> ReadHeaderLineAsync(CancellationToken cancellationToken)
        {
            var bytes = new List<byte>(64);
            while (true)
            {
                byte[] buffer = new byte[1];
                int read = await this.input.ReadAsync(buffer, 0, 1, cancellationToken).ConfigureAwait(false);
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
}
