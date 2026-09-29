namespace SmallBasic.LanguageServices
{
    using System;
    using System.Globalization;
    using System.IO;
    using System.Text;
    using System.Text.Json.Nodes;
    using System.Threading;
    using System.Threading.Tasks;
    using FluentAssertions;
    using Xunit;

    /// <summary>
    /// Covers the Content-Length framing that both the in-process Visual Studio host and
    /// the language server rely on.
    /// </summary>
    public sealed class SmallBasicLspStreamTests
    {
        [Fact]
        public async Task WriteUsesContentLengthHeaderAndUtf8Body()
        {
            var output = new MemoryStream();
            var stream = new SmallBasicLspStream(Stream.Null, output);

            await stream.WriteMessageAsync(
                new JsonObject { ["jsonrpc"] = "2.0", ["id"] = 7, ["method"] = "initialize" },
                CancellationToken.None);

            byte[] bytes = output.ToArray();
            string text = Encoding.ASCII.GetString(bytes, 0, bytes.Length);
            text.Should().StartWith("Content-Length: ");

            const string prefix = "Content-Length: ";
            int separator = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            separator.Should().BeGreaterThan(0);

            int declaredLength = int.Parse(
                text.Substring(prefix.Length, separator - prefix.Length),
                CultureInfo.InvariantCulture);
            declaredLength.Should().Be(bytes.Length - separator - 4);
        }

        [Fact]
        public async Task ReadRoundTripsAFramedMessage()
        {
            var stream = new SmallBasicLspStream(
                WriteFrames("""{"jsonrpc":"2.0","id":7,"method":"initialize"}"""),
                Stream.Null);

            JsonObject? message = await stream.ReadMessageAsync(CancellationToken.None);

            message.Should().NotBeNull();
            ((string)message!["method"]).Should().Be("initialize");
            ((int)message!["id"]).Should().Be(7);
        }

        [Fact]
        public async Task ReadReturnsMessagesInOrderUntilTheStreamEnds()
        {
            var stream = new SmallBasicLspStream(
                WriteFrames(
                    """{"jsonrpc":"2.0","id":1,"method":"initialize"}""",
                    """{"jsonrpc":"2.0","method":"initialized"}"""),
                Stream.Null);

            JsonObject? first = await stream.ReadMessageAsync(CancellationToken.None);
            JsonObject? second = await stream.ReadMessageAsync(CancellationToken.None);
            JsonObject? end = await stream.ReadMessageAsync(CancellationToken.None);

            ((string)first!["method"]).Should().Be("initialize");
            ((string)second!["method"]).Should().Be("initialized");
            end.Should().BeNull();
        }

        [Fact]
        public async Task ReadReturnsNullForAnEmptyStream()
        {
            var stream = new SmallBasicLspStream(new MemoryStream(), Stream.Null);

            JsonObject? message = await stream.ReadMessageAsync(CancellationToken.None);

            message.Should().BeNull();
        }

        private static MemoryStream WriteFrames(params string[] jsonMessages)
        {
            var buffer = new MemoryStream();
            foreach (string json in jsonMessages)
            {
                byte[] body = Encoding.UTF8.GetBytes(json);
                byte[] header = Encoding.ASCII.GetBytes($"Content-Length: {body.Length}\r\n\r\n");
                buffer.Write(header, 0, header.Length);
                buffer.Write(body, 0, body.Length);
            }

            buffer.Position = 0;
            return buffer;
        }
    }
}
