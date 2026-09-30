namespace SmallBasic.LanguageServices
{
    using System;
    using System.Collections.Generic;
    using System.Globalization;
    using System.IO;
    using System.Linq;
    using System.Text;
    using System.Text.Json.Nodes;
    using System.Threading;
    using System.Threading.Tasks;
    using FluentAssertions;
    using SmallBasic.Tests;
    using Xunit;

    /// <summary>
    /// Drives <see cref="SmallBasicLanguageServer"/> end to end over two memory streams:
    /// every test feeds real Content-Length framed JSON-RPC traffic in and asserts on the
    /// traffic the server writes back, so the protocol wiring (not just the analysis
    /// layer) is covered.
    /// </summary>
    public sealed class SmallBasicLanguageServerTests : IClassFixture<CultureFixture>
    {
        private const string DocumentUri = "file:///g:/temp/smallbasic-lsp-sample.sb";
        private const string ServerVersion = "9.9.9-test";

        [Fact]
        public async Task InitializeAdvertisesCompletionHoverDiagnosticsAndDocumentSymbols()
        {
            List<JsonObject> messages = await RunAsync(
                Request(1, "initialize", new JsonObject()),
                Request(2, "shutdown"));

            messages.Should().HaveCount(2);
            ((int)messages[0]["id"]).Should().Be(1);

            JsonObject result = Obj(messages[0]["result"]);
            JsonObject capabilities = Obj(result["capabilities"]);
            JsonObject textDocumentSync = Obj(capabilities["textDocumentSync"]);
            JsonObject completionProvider = Obj(capabilities["completionProvider"]);
            JsonObject serverInfo = Obj(result["serverInfo"]);

            ((bool)textDocumentSync["openClose"]).Should().BeTrue();
            ((int)textDocumentSync["change"]).Should().Be(1);
            ((bool)completionProvider["resolveProvider"]).Should().BeFalse();
            ((string)completionProvider["triggerCharacters"].AsArray()[0]).Should().Be(".");
            ((bool)capabilities["hoverProvider"]).Should().BeTrue();
            ((bool)capabilities["documentSymbolProvider"]).Should().BeTrue();

            JsonObject signatureHelpProvider = Obj(capabilities["signatureHelpProvider"]);
            ((string)signatureHelpProvider["triggerCharacters"].AsArray()[0]).Should().Be("(");
            ((string)signatureHelpProvider["triggerCharacters"].AsArray()[1]).Should().Be(",");

            ((string)serverInfo["name"]).Should().Be("SmallBasic LSP");
            ((string)serverInfo["version"]).Should().Be(ServerVersion);
            messages[1]["error"].Should().BeNull();
        }

        [Fact]
        public async Task DidOpenPublishesDiagnosticsForAnInvalidProgram()
        {
            List<JsonObject> messages = await RunAsync(
                Notification("textDocument/didOpen", TextDocument("TextWindow.NoMethod()")));

            JsonObject parameters = Obj(DiagnosticsNotifications(messages).Single()["params"]);
            ((string)parameters["uri"]).Should().Be(DocumentUri);

            JsonArray items = parameters["diagnostics"].AsArray();
            items.Should().NotBeEmpty();
            items.Select(item => (string)item.AsObject()["message"])
                .Should().Contain(message => message.Contains("NoMethod", StringComparison.Ordinal));
            ((int)items[0].AsObject()["severity"]).Should().Be((int)SmallBasicLspDiagnosticSeverity.Error);
        }

        [Fact]
        public async Task DidChangeRepublishesDiagnostics()
        {
            List<JsonObject> messages = await RunAsync(
                Notification("textDocument/didOpen", TextDocument("TextWindow.NoMethod()")),
                Notification("textDocument/didChange", new JsonObject
                {
                    ["textDocument"] = new JsonObject { ["uri"] = DocumentUri, ["version"] = 2 },
                    ["contentChanges"] = new JsonArray(new JsonObject { ["text"] = "TextWindow.WriteLine(\"ok\")" }),
                }));

            List<JsonObject> notifications = DiagnosticsNotifications(messages);
            notifications.Should().HaveCount(2);
            Obj(notifications[0]["params"])["diagnostics"].AsArray().Should().NotBeEmpty();
            Obj(notifications[1]["params"])["diagnostics"].AsArray().Should().BeEmpty();
        }

        [Fact]
        public async Task DidCloseClearsDiagnostics()
        {
            List<JsonObject> messages = await RunAsync(
                Notification("textDocument/didOpen", TextDocument("TextWindow.NoMethod()")),
                Notification("textDocument/didClose", new JsonObject
                {
                    ["textDocument"] = new JsonObject { ["uri"] = DocumentUri },
                }));

            List<JsonObject> notifications = DiagnosticsNotifications(messages);
            notifications.Should().HaveCount(2);
            Obj(notifications[1]["params"])["diagnostics"].AsArray().Should().BeEmpty();
        }

        [Fact]
        public async Task CompletionReturnsSnippetItemsFromTheOpenDocument()
        {
            List<JsonObject> messages = await RunAsync(
                Notification("textDocument/didOpen", TextDocument("Program.d")),
                Request(10, "textDocument/completion", TextPosition(DocumentUri, 0, 9)));

            JsonObject result = Obj(Response(messages, 10)["result"]);
            ((bool)result["isIncomplete"]).Should().BeFalse();

            JsonArray items = result["items"].AsArray();
            JsonObject delay = items.Select(item => item.AsObject())
                .Single(item => (string)item["label"] == "Delay(milliSeconds)");

            ((int)delay["kind"]).Should().Be((int)SmallBasicLspCompletionKind.Method);
            ((int)delay["insertTextFormat"]).Should().Be((int)SmallBasicLspInsertTextFormat.Snippet);
            ((string)delay["insertText"]).Should().Be("Delay(${1:milliSeconds})");
            ((string)delay["documentation"]).Should().Contain("milliSeconds:");
        }

        [Fact]
        public async Task SignatureHelpReturnsTheActiveParameterFromTheOpenDocument()
        {
            List<JsonObject> messages = await RunAsync(
                Notification("textDocument/didOpen", TextDocument("Shapes.Move(name, 1, 2)")),
                Request(17, "textDocument/signatureHelp", TextPosition(DocumentUri, 0, 18)));

            JsonObject result = Obj(Response(messages, 17)["result"]);
            ((int)result["activeParameter"]).Should().Be(1);

            JsonObject signature = result["signatures"].AsArray()[0].AsObject();
            ((string)signature["label"]).Should().Be("Shapes.Move(shapeName, x, y)");
            signature["parameters"].AsArray().Select(parameter => (string)parameter.AsObject()["label"])
                .Should().Equal("shapeName", "x", "y");
        }

        [Fact]
        public async Task SignatureHelpOutsideAnArgumentListReturnsNull()
        {
            List<JsonObject> messages = await RunAsync(
                Notification("textDocument/didOpen", TextDocument("Shapes.Move(name, 1, 2)")),
                Request(18, "textDocument/signatureHelp", TextPosition(DocumentUri, 0, 23)));

            Response(messages, 18)["result"].Should().BeNull();
        }

        [Fact]
        public async Task HoverReturnsPlainTextAndIdentifierRange()
        {
            List<JsonObject> messages = await RunAsync(
                Notification("textDocument/didOpen", TextDocument("TextWindow.WriteLine(1)")),
                Request(11, "textDocument/hover", TextPosition(DocumentUri, 0, 15)));

            JsonObject result = Obj(Response(messages, 11)["result"]);
            JsonObject contents = Obj(result["contents"]);
            JsonObject range = Obj(result["range"]);

            ((string)contents["kind"]).Should().Be("plaintext");
            ((string)contents["value"]).Should().Contain("TextWindow.WriteLine(data)");
            ((string)contents["value"]).Should().Contain("data:");
            ((int)Obj(range["start"])["character"]).Should().Be(11);
            ((int)Obj(range["end"])["character"]).Should().Be(20);
        }

        [Fact]
        public async Task HoverOutsideAnyIdentifierReturnsNull()
        {
            List<JsonObject> messages = await RunAsync(
                Notification("textDocument/didOpen", TextDocument("TextWindow.WriteLine(1)\n\n")),
                Request(12, "textDocument/hover", TextPosition(DocumentUri, 1, 0)));

            Response(messages, 12)["result"].Should().BeNull();
        }

        [Fact]
        public async Task DocumentSymbolsPreserveTheProcedureHierarchy()
        {
            List<JsonObject> messages = await RunAsync(
                Notification("textDocument/didOpen", TextDocument("count = 1\nSub Greet\n  name = count\nEndSub")),
                Request(13, "textDocument/documentSymbol", TextDocumentOnly(DocumentUri)));

            JsonArray symbols = Response(messages, 13)["result"].AsArray();
            symbols.Select(symbol => (string)symbol.AsObject()["name"]).Should().Equal("count", "Greet");
            ((int)symbols[0].AsObject()["kind"]).Should().Be((int)SmallBasicLspSymbolKind.Variable);
            ((int)symbols[1].AsObject()["kind"]).Should().Be((int)SmallBasicLspSymbolKind.Function);

            JsonObject procedure = symbols[1].AsObject();
            procedure["children"].AsArray().Select(symbol => (string)symbol.AsObject()["name"]).Should().Equal("name");
            ((int)Obj(procedure["selectionRange"].AsObject()["start"])["line"]).Should().Be(1);
            ((int)Obj(procedure["selectionRange"].AsObject()["start"])["character"]).Should().Be(4);
        }

        [Fact]
        public async Task RequestsForAnUnknownDocumentReturnEmptyResults()
        {
            const string Unknown = "file:///g:/temp/smallbasic-lsp-unknown.sb";
            List<JsonObject> messages = await RunAsync(
                Request(14, "textDocument/completion", TextPosition(Unknown, 0, 0)),
                Request(15, "textDocument/documentSymbol", TextDocumentOnly(Unknown)));

            Obj(Response(messages, 14)["result"])["items"].AsArray().Should().BeEmpty();
            Response(messages, 15)["result"].AsArray().Should().BeEmpty();
        }

        [Fact]
        public async Task UnknownRequestReturnsMethodNotFoundError()
        {
            List<JsonObject> messages = await RunAsync(Request(16, "workspace/unknownMethod"));

            JsonObject response = Response(messages, 16);
            response["result"].Should().BeNull();
            ((int)Obj(response["error"])["code"]).Should().Be(-32601);
            ((string)Obj(response["error"])["message"]).Should().Contain("workspace/unknownMethod");
        }

        [Fact]
        public async Task ServerWritesNothingWhenThereIsNoInput()
        {
            List<JsonObject> messages = await RunAsync();

            messages.Should().BeEmpty();
        }

        [Fact]
        public async Task ServerSurvivesAMalformedMessageAndKeepsServing()
        {
            // "method": 123 throws inside the dispatcher; the session must report
            // the failure and keep serving the next request.
            List<JsonObject> messages = await RunAsync(
                "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":123}",
                Request(21, "textDocument/completion", TextPosition(DocumentUri, 0, 0)));

            messages.Should().HaveCount(2);
            ((int)Obj(messages[0]["error"])["code"]).Should().Be(-32603);
            ((int)messages[1]["id"]).Should().Be(21);
            messages[1]["result"].Should().NotBeNull();
        }

        private static async Task<List<JsonObject>> RunAsync(params string[] jsonMessages)
        {
            using var input = Frame(jsonMessages);
            using var output = new MemoryStream();
            var server = new SmallBasicLanguageServer(new SmallBasicLspAnalysisService(), ServerVersion);

            await server.RunAsync(input, output, CancellationToken.None);

            return ReadMessages(output);
        }

        private static JsonObject Obj(JsonNode node)
        {
            return node.AsObject();
        }

        private static string Request(int id, string method, JsonObject parameters = null)
        {
            var message = new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = id,
                ["method"] = method,
            };

            if (parameters != null)
            {
                message["params"] = parameters;
            }

            return message.ToJsonString();
        }

        private static string Notification(string method, JsonObject parameters)
        {
            var message = new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["method"] = method,
                ["params"] = parameters,
            };

            return message.ToJsonString();
        }

        private static JsonObject TextDocument(string text)
        {
            return new JsonObject
            {
                ["textDocument"] = new JsonObject
                {
                    ["uri"] = DocumentUri,
                    ["languageId"] = "smallbasic",
                    ["version"] = 1,
                    ["text"] = text,
                },
            };
        }

        private static JsonObject TextDocumentOnly(string uri)
        {
            return new JsonObject
            {
                ["textDocument"] = new JsonObject { ["uri"] = uri },
            };
        }

        private static JsonObject TextPosition(string uri, int line, int character)
        {
            return new JsonObject
            {
                ["textDocument"] = new JsonObject { ["uri"] = uri },
                ["position"] = new JsonObject { ["line"] = line, ["character"] = character },
            };
        }

        private static JsonObject Response(List<JsonObject> messages, int id)
        {
            return messages.Single(message => message["id"] != null && (int)message["id"] == id);
        }

        private static List<JsonObject> DiagnosticsNotifications(List<JsonObject> messages)
        {
            return messages
                .Where(message => (string)message["method"] == "textDocument/publishDiagnostics")
                .ToList();
        }

        private static MemoryStream Frame(params string[] jsonMessages)
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

        private static List<JsonObject> ReadMessages(MemoryStream stream)
        {
            byte[] bytes = stream.ToArray();
            var messages = new List<JsonObject>();
            int offset = 0;

            while (offset < bytes.Length)
            {
                int bodyStart = FindBodyStart(bytes, offset);
                if (bodyStart < 0)
                {
                    throw new InvalidOperationException("The language server wrote a message without Content-Length framing.");
                }

                string header = Encoding.ASCII.GetString(bytes, offset, bodyStart - offset);
                int contentLength = ParseContentLength(header);
                string body = Encoding.UTF8.GetString(bytes, bodyStart, contentLength);
                messages.Add((JsonObject)JsonNode.Parse(body));
                offset = bodyStart + contentLength;
            }

            return messages;
        }

        private static int FindBodyStart(byte[] bytes, int offset)
        {
            for (int index = offset; index <= bytes.Length - 4; index++)
            {
                if (bytes[index] == '\r' && bytes[index + 1] == '\n' && bytes[index + 2] == '\r' && bytes[index + 3] == '\n')
                {
                    return index + 4;
                }
            }

            return -1;
        }

        private static int ParseContentLength(string header)
        {
            const string Prefix = "Content-Length:";
            foreach (string line in header.Split('\n'))
            {
                if (line.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return int.Parse(line.Substring(Prefix.Length).Trim(), CultureInfo.InvariantCulture);
                }
            }

            throw new InvalidOperationException($"The language server response is missing a Content-Length header: {header}");
        }
    }
}
