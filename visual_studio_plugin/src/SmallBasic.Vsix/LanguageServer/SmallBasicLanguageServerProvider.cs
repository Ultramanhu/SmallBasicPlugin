namespace SmallBasic.Vsix.LanguageServer
{
    using System;
    using System.Diagnostics;
    using System.IO;
    using System.IO.Pipelines;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Editor;
    using Microsoft.VisualStudio.Extensibility.LanguageServer;
    using Microsoft.VisualStudio.RpcContracts.LanguageServerProvider;
    using Nerdbank.Streams;
    using SmallBasic.LanguageServices;
    using SmallBasic.Vsix;

#pragma warning disable VSEXTPREVIEW_LSP

    /// <summary>
    /// Bridges Visual Studio's LSP client with the in-process Small Basic language
    /// server. Completion, hover, diagnostics and document symbols are served through
    /// the protocol; the analysis itself lives in SmallBasic.LanguageServices.
    /// </summary>
    [VisualStudioContribution]
    internal sealed class SmallBasicLanguageServerProvider : LanguageServerProvider
    {
        private readonly SmallBasicLspAnalysisService analysisService;
        private readonly TraceSource traceSource;

        public SmallBasicLanguageServerProvider(ExtensionCore container, VisualStudioExtensibility extensibilityObject, TraceSource traceSource, SmallBasicLspAnalysisService analysisService)
            : base(container, extensibilityObject)
        {
            this.traceSource = traceSource;
            this.analysisService = analysisService;
        }

        [VisualStudioContribution]
        internal static DocumentTypeConfiguration SmallBasicLspDocumentType => new("smallbasic-lsp")
        {
            FileExtensions = new[] { ".sb" },
            BaseDocumentType = LanguageServerBaseDocumentType,
        };

        public override LanguageServerProviderConfiguration LanguageServerProviderConfiguration =>
            new("Small Basic LSP",
                new[]
                {
                    DocumentFilter.FromDocumentType(SmallBasicLspDocumentType),
                });

        public override Task<IDuplexPipe?> CreateServerConnectionAsync(CancellationToken cancellationToken)
        {
            (Stream pipeToServer, Stream pipeToVisualStudio) = FullDuplexStream.CreatePair();
            var server = new SmallBasicLanguageServer(this.analysisService, SmallBasicVersion.Value);

            // The given cancellationToken only scopes the *creation* of the connection.
            // The server must outlive this call, so it runs with CancellationToken.None
            // and ends when Visual Studio closes its end of the pipe (EOF on read).
            _ = Task.Run(async () =>
            {
                try
                {
                    await server.RunAsync(pipeToServer, CancellationToken.None).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    this.traceSource.TraceEvent(TraceEventType.Error, 0, $"SmallBasic LSP terminated unexpectedly: {ex}");
                }
                finally
                {
                    pipeToServer.Dispose();
                }
            });

            return Task.FromResult<IDuplexPipe?>(new StreamBackedDuplexPipe(pipeToVisualStudio));
        }

        public override Task OnServerInitializationResultAsync(ServerInitializationResult startState, LanguageServerInitializationFailureInfo? initializationFailureInfo, CancellationToken cancellationToken)
        {
            if (startState == ServerInitializationResult.Failed)
            {
                this.traceSource.TraceEvent(
                    TraceEventType.Error,
                    0,
                    initializationFailureInfo?.Exception?.ToString() ?? initializationFailureInfo?.StatusMessage ?? "SmallBasic LSP failed to initialize.");
            }

            return Task.CompletedTask;
        }

        private sealed class StreamBackedDuplexPipe : IDuplexPipe
        {
            public StreamBackedDuplexPipe(Stream stream)
            {
                this.Input = PipeReader.Create(stream);
                this.Output = PipeWriter.Create(stream);
            }

            public PipeReader Input { get; }

            public PipeWriter Output { get; }
        }
    }
}

#pragma warning restore VSEXTPREVIEW_LSP
