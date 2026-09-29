namespace SmallBasic.LanguageServices
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Text.Json.Nodes;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    /// Minimal in-process LSP server for Small Basic. It implements the subset of the
    /// protocol the Visual Studio extension needs (completion, hover, diagnostics and
    /// document symbols) on top of <see cref="SmallBasicLspAnalysisService"/>.
    /// </summary>
    /// <remarks>
    /// The server is transport agnostic: it only needs an input and an output
    /// <see cref="Stream"/>, which lets the Visual Studio provider wire it to an
    /// in-memory duplex stream and lets tests drive it with two memory streams.
    /// </remarks>
    public sealed class SmallBasicLanguageServer
    {
        private readonly SmallBasicLspAnalysisService analysisService;
        private readonly string serverVersion;
        private readonly Dictionary<string, SmallBasicTextDocument> documents = new Dictionary<string, SmallBasicTextDocument>(StringComparer.OrdinalIgnoreCase);

        public SmallBasicLanguageServer(SmallBasicLspAnalysisService analysisService, string serverVersion = "")
        {
            this.analysisService = analysisService;
            this.serverVersion = serverVersion ?? string.Empty;
        }

        /// <summary>Runs the server over a single duplex stream.</summary>
        public Task RunAsync(Stream stream, CancellationToken cancellationToken)
        {
            return this.RunAsync(stream, stream, cancellationToken);
        }

        /// <summary>Runs the server until the input stream ends or cancellation is requested.</summary>
        public async Task RunAsync(Stream input, Stream output, CancellationToken cancellationToken)
        {
            var protocol = new SmallBasicLspStream(input, output);
            while (!cancellationToken.IsCancellationRequested)
            {
                JsonObject? message = await protocol.ReadMessageAsync(cancellationToken).ConfigureAwait(false);
                if (message is null)
                {
                    break;
                }

                await this.DispatchAsync(protocol, message, cancellationToken).ConfigureAwait(false);
            }
        }

        private async Task DispatchAsync(SmallBasicLspStream protocol, JsonObject message, CancellationToken cancellationToken)
        {
            string method = (string)message["method"];
            JsonNode id = message["id"];
            JsonObject parameters = message["params"] as JsonObject;

            if (string.IsNullOrEmpty(method))
            {
                return;
            }

            switch (method)
            {
                case "initialize":
                    await this.SendResponseAsync(protocol, id, this.CreateInitializeResult(), cancellationToken).ConfigureAwait(false);
                    break;

                case "initialized":
                    break;

                case "textDocument/didOpen":
                    await this.HandleDidOpenAsync(protocol, parameters, cancellationToken).ConfigureAwait(false);
                    break;

                case "textDocument/didChange":
                    await this.HandleDidChangeAsync(protocol, parameters, cancellationToken).ConfigureAwait(false);
                    break;

                case "textDocument/didClose":
                    await this.HandleDidCloseAsync(protocol, parameters, cancellationToken).ConfigureAwait(false);
                    break;

                case "textDocument/completion":
                    await this.HandleCompletionAsync(protocol, id, parameters, cancellationToken).ConfigureAwait(false);
                    break;

                case "textDocument/hover":
                    await this.HandleHoverAsync(protocol, id, parameters, cancellationToken).ConfigureAwait(false);
                    break;

                case "textDocument/documentSymbol":
                    await this.HandleDocumentSymbolAsync(protocol, id, parameters, cancellationToken).ConfigureAwait(false);
                    break;

                case "shutdown":
                    await this.SendResponseAsync(protocol, id, null, cancellationToken).ConfigureAwait(false);
                    break;

                case "exit":
                    break;

                default:
                    if (id != null)
                    {
                        await this.SendErrorResponseAsync(protocol, id, -32601, $"Method '{method}' is not supported by the Small Basic language server.", cancellationToken).ConfigureAwait(false);
                    }

                    break;
            }
        }

        private async Task HandleDidOpenAsync(SmallBasicLspStream protocol, JsonObject parameters, CancellationToken cancellationToken)
        {
            JsonObject textDocument = parameters?["textDocument"] as JsonObject;
            string uri = (string)textDocument?["uri"];
            string text = (string)textDocument?["text"];
            if (string.IsNullOrWhiteSpace(uri))
            {
                return;
            }

            this.documents[NormalizeUri(uri)] = new SmallBasicTextDocument(uri, text ?? string.Empty);
            await this.PublishDiagnosticsAsync(protocol, uri, text ?? string.Empty, cancellationToken).ConfigureAwait(false);
        }

        private async Task HandleDidChangeAsync(SmallBasicLspStream protocol, JsonObject parameters, CancellationToken cancellationToken)
        {
            JsonObject textDocument = parameters?["textDocument"] as JsonObject;
            string uri = (string)textDocument?["uri"];
            JsonArray changes = parameters?["contentChanges"] as JsonArray;
            if (string.IsNullOrWhiteSpace(uri) || changes == null || changes.Count == 0)
            {
                return;
            }

            string text = null;
            foreach (JsonNode change in changes)
            {
                if (change is JsonObject changeObject && changeObject["text"] is JsonNode textNode)
                {
                    text = (string)textNode;
                }
            }

            if (text == null)
            {
                return;
            }

            this.documents[NormalizeUri(uri)] = new SmallBasicTextDocument(uri, text);
            await this.PublishDiagnosticsAsync(protocol, uri, text, cancellationToken).ConfigureAwait(false);
        }

        private async Task HandleDidCloseAsync(SmallBasicLspStream protocol, JsonObject parameters, CancellationToken cancellationToken)
        {
            JsonObject textDocument = parameters?["textDocument"] as JsonObject;
            string uri = (string)textDocument?["uri"];
            if (string.IsNullOrWhiteSpace(uri))
            {
                return;
            }

            this.documents.Remove(NormalizeUri(uri));
            await this.SendNotificationAsync(protocol, "textDocument/publishDiagnostics", new JsonObject
            {
                ["uri"] = uri,
                ["diagnostics"] = new JsonArray(),
            }, cancellationToken).ConfigureAwait(false);
        }

        private async Task HandleCompletionAsync(SmallBasicLspStream protocol, JsonNode id, JsonObject parameters, CancellationToken cancellationToken)
        {
            if (id == null || !this.TryGetDocumentAndPosition(parameters, out _, out string text, out int line, out int character))
            {
                await this.SendResponseAsync(protocol, id, new JsonObject { ["isIncomplete"] = false, ["items"] = new JsonArray() }, cancellationToken).ConfigureAwait(false);
                return;
            }

            IReadOnlyList<SmallBasicLspCompletionItem> items = this.analysisService.GetCompletions(text, line, character);
            var array = new JsonArray();
            foreach (SmallBasicLspCompletionItem item in items)
            {
                array.Add(new JsonObject
                {
                    ["label"] = item.Label,
                    ["detail"] = item.Detail,
                    ["kind"] = (int)item.Kind,
                    ["insertText"] = item.InsertText,
                    ["insertTextFormat"] = (int)item.InsertTextFormat,
                });
            }

            await this.SendResponseAsync(protocol, id, new JsonObject
            {
                ["isIncomplete"] = false,
                ["items"] = array,
            }, cancellationToken).ConfigureAwait(false);
        }

        private async Task HandleHoverAsync(SmallBasicLspStream protocol, JsonNode id, JsonObject parameters, CancellationToken cancellationToken)
        {
            if (id == null || !this.TryGetDocumentAndPosition(parameters, out _, out string text, out int line, out int character))
            {
                await this.SendResponseAsync(protocol, id, null, cancellationToken).ConfigureAwait(false);
                return;
            }

            SmallBasicLspHover? hover = this.analysisService.GetHover(text, line, character);
            if (hover == null)
            {
                await this.SendResponseAsync(protocol, id, null, cancellationToken).ConfigureAwait(false);
                return;
            }

            await this.SendResponseAsync(protocol, id, new JsonObject
            {
                ["contents"] = new JsonObject
                {
                    ["kind"] = "plaintext",
                    ["value"] = hover.Contents,
                },
                ["range"] = ToJsonRange(hover.Range),
            }, cancellationToken).ConfigureAwait(false);
        }

        private async Task HandleDocumentSymbolAsync(SmallBasicLspStream protocol, JsonNode id, JsonObject parameters, CancellationToken cancellationToken)
        {
            if (id == null || !this.TryGetDocumentText(parameters, out _, out string text))
            {
                await this.SendResponseAsync(protocol, id, new JsonArray(), cancellationToken).ConfigureAwait(false);
                return;
            }

            IReadOnlyList<SmallBasicLspDocumentSymbol> symbols = this.analysisService.GetDocumentSymbols(text);
            var array = new JsonArray();
            foreach (SmallBasicLspDocumentSymbol symbol in symbols)
            {
                array.Add(ToJsonDocumentSymbol(symbol));
            }

            await this.SendResponseAsync(protocol, id, array, cancellationToken).ConfigureAwait(false);
        }

        private async Task PublishDiagnosticsAsync(SmallBasicLspStream protocol, string uri, string text, CancellationToken cancellationToken)
        {
            IReadOnlyList<SmallBasicLspDiagnostic> diagnostics = this.analysisService.GetDiagnostics(text);
            var array = new JsonArray();
            foreach (SmallBasicLspDiagnostic diagnostic in diagnostics)
            {
                array.Add(new JsonObject
                {
                    ["range"] = ToJsonRange(diagnostic.Range),
                    ["severity"] = (int)diagnostic.Severity,
                    ["message"] = diagnostic.Message,
                });
            }

            await this.SendNotificationAsync(protocol, "textDocument/publishDiagnostics", new JsonObject
            {
                ["uri"] = uri,
                ["diagnostics"] = array,
            }, cancellationToken).ConfigureAwait(false);
        }

        private JsonObject CreateInitializeResult()
        {
            var serverInfo = new JsonObject
            {
                ["name"] = "SmallBasic LSP",
            };

            if (!string.IsNullOrEmpty(this.serverVersion))
            {
                serverInfo["version"] = this.serverVersion;
            }

            return new JsonObject
            {
                ["capabilities"] = new JsonObject
                {
                    ["textDocumentSync"] = new JsonObject
                    {
                        ["openClose"] = true,
                        ["change"] = 1,
                    },
                    ["completionProvider"] = new JsonObject
                    {
                        ["resolveProvider"] = false,
                        ["triggerCharacters"] = new JsonArray("."),
                    },
                    ["hoverProvider"] = true,
                    ["documentSymbolProvider"] = true,
                },
                ["serverInfo"] = serverInfo,
            };
        }

        private static JsonObject ToJsonDocumentSymbol(SmallBasicLspDocumentSymbol symbol)
        {
            var children = new JsonArray();
            foreach (SmallBasicLspDocumentSymbol child in symbol.Children)
            {
                children.Add(ToJsonDocumentSymbol(child));
            }

            return new JsonObject
            {
                ["name"] = symbol.Name,
                ["kind"] = (int)symbol.Kind,
                ["range"] = ToJsonRange(symbol.Range),
                ["selectionRange"] = ToJsonRange(symbol.SelectionRange),
                ["children"] = children,
            };
        }

        private static JsonObject ToJsonRange(SmallBasicLspRange range)
        {
            return new JsonObject
            {
                ["start"] = new JsonObject
                {
                    ["line"] = range.StartLine,
                    ["character"] = range.StartCharacter,
                },
                ["end"] = new JsonObject
                {
                    ["line"] = range.EndLine,
                    ["character"] = range.EndCharacter,
                },
            };
        }

        private static string NormalizeUri(string uri)
        {
            return Uri.TryCreate(uri, UriKind.Absolute, out Uri parsed)
                ? parsed.AbsoluteUri
                : uri;
        }

        private bool TryGetDocumentAndPosition(JsonObject parameters, out string uri, out string text, out int line, out int character)
        {
            line = 0;
            character = 0;
            if (!this.TryGetDocumentText(parameters, out uri, out text))
            {
                return false;
            }

            JsonObject position = parameters?["position"] as JsonObject;
            line = (int?)position?["line"] ?? 0;
            character = (int?)position?["character"] ?? 0;
            return true;
        }

        private bool TryGetDocumentText(JsonObject parameters, out string uri, out string text)
        {
            uri = (string)((parameters?["textDocument"] as JsonObject)?["uri"]);
            text = null;
            if (string.IsNullOrWhiteSpace(uri))
            {
                return false;
            }

            if (this.documents.TryGetValue(NormalizeUri(uri), out SmallBasicTextDocument document))
            {
                text = document.Text;
                return true;
            }

            if (Uri.TryCreate(uri, UriKind.Absolute, out Uri parsed) && parsed.IsFile && File.Exists(parsed.LocalPath))
            {
                text = File.ReadAllText(parsed.LocalPath);
                return true;
            }

            return false;
        }

        private async Task SendNotificationAsync(SmallBasicLspStream protocol, string method, JsonObject parameters, CancellationToken cancellationToken)
        {
            var message = new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["method"] = method,
            };

            if (parameters != null)
            {
                message["params"] = parameters;
            }

            await protocol.WriteMessageAsync(message, cancellationToken).ConfigureAwait(false);
        }

        private async Task SendResponseAsync(SmallBasicLspStream protocol, JsonNode id, JsonNode result, CancellationToken cancellationToken)
        {
            var response = new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = id?.DeepClone(),
                ["result"] = result?.DeepClone(),
            };

            await protocol.WriteMessageAsync(response, cancellationToken).ConfigureAwait(false);
        }

        private async Task SendErrorResponseAsync(SmallBasicLspStream protocol, JsonNode id, int code, string message, CancellationToken cancellationToken)
        {
            var response = new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = id?.DeepClone(),
                ["error"] = new JsonObject
                {
                    ["code"] = code,
                    ["message"] = message,
                },
            };

            await protocol.WriteMessageAsync(response, cancellationToken).ConfigureAwait(false);
        }

        private sealed class SmallBasicTextDocument
        {
            public SmallBasicTextDocument(string uri, string text)
            {
                this.Uri = uri;
                this.Text = text;
            }

            public string Uri { get; }

            public string Text { get; }
        }
    }
}
