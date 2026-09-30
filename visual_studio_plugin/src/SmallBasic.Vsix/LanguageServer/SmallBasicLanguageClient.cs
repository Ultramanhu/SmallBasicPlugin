namespace SmallBasic.Vsix.LanguageServer
{
    using System;
    using System.Collections.Generic;
    using System.ComponentModel.Composition;
    using System.IO;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.VisualStudio.LanguageServer.Client;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Threading;
    using Microsoft.VisualStudio.Utilities;
    using Nerdbank.Streams;
    using SmallBasic.LanguageServices;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// Connects Visual Studio's in-proc LSP client directly to the Small Basic
    /// content type.  The extension also has a minimal legacy language service for
    /// the native navigation bar, so using a second document-type registration for
    /// LSP prevents completion and hover from ever being activated for that buffer.
    /// Exporting <see cref="ILanguageClient"/> on the existing content type lets both
    /// features coexist.
    /// </summary>
    [ContentType("smallbasic")]
    [Export(typeof(ILanguageClient))]
    [RunOnContext(RunningContext.RunOnHost)]
    internal sealed class SmallBasicLanguageClient : ILanguageClient
    {
        private readonly object serverGate = new object();
        private CancellationTokenSource? serverCancellation;
        private Stream? serverStream;

        public event AsyncEventHandler<EventArgs>? StartAsync;

        public event AsyncEventHandler<EventArgs>? StopAsync;

        public string Name => "Small Basic LSP";

        public IEnumerable<string>? ConfigurationSections => null;

        public object? InitializationOptions => null;

        public IEnumerable<string>? FilesToWatch => null;

        public object? MiddleLayer => null;

        public bool ShowNotificationOnInitializeFailed => true;

        public Task<Connection?> ActivateAsync(CancellationToken token)
        {
            token.ThrowIfCancellationRequested();

            (Stream pipeToServer, Stream pipeToVisualStudio) = FullDuplexStream.CreatePair();
            var cancellation = new CancellationTokenSource();

            lock (this.serverGate)
            {
                this.StopActiveServer();
                this.serverCancellation = cancellation;
                this.serverStream = pipeToServer;
            }

            var server = new SmallBasicLanguageServer(new SmallBasicLspAnalysisService(), SmallBasicVersion.Value);
            _ = Task.Run(async () =>
            {
                try
                {
                    await server.RunAsync(pipeToServer, cancellation.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
                {
                }
                catch (Exception exception)
                {
                    SmallBasicDiagnostics.Write("[LSP] server terminated unexpectedly: " + exception);
                }
                finally
                {
                    pipeToServer.Dispose();

                    lock (this.serverGate)
                    {
                        if (ReferenceEquals(this.serverCancellation, cancellation))
                        {
                            this.serverCancellation = null;
                            this.serverStream = null;
                        }
                    }

                    cancellation.Dispose();
                    SmallBasicDiagnostics.Write("[LSP] server stopped");
                }
            });

            SmallBasicDiagnostics.Write("[LSP] connection created");
            return Task.FromResult<Connection?>(new Connection(pipeToVisualStudio, pipeToVisualStudio));
        }

        public async Task OnLoadedAsync()
        {
            SmallBasicDiagnostics.Write("[LSP] client loaded for smallbasic content type");
            if (this.StartAsync != null)
            {
                await this.StartAsync.InvokeAsync(this, EventArgs.Empty).ConfigureAwait(false);
            }
        }

        public Task OnServerInitializedAsync()
        {
            SmallBasicDiagnostics.Write("[LSP] initialized");
            return Task.CompletedTask;
        }

        public Task<InitializationFailureContext?> OnServerInitializeFailedAsync(ILanguageClientInitializationInfo initializationState)
        {
            string details = initializationState?.InitializationException?.ToString()
                ?? initializationState?.StatusMessage
                ?? "Unknown initialization failure.";
            SmallBasicDiagnostics.Write("[LSP] initialization failed: " + details);

            return Task.FromResult<InitializationFailureContext?>(new InitializationFailureContext
            {
                FailureMessage = "Small Basic IntelliSense failed to initialize. " + details,
            });
        }

        public Task StopServerAsync()
        {
            lock (this.serverGate)
            {
                this.StopActiveServer();
            }

            SmallBasicDiagnostics.Write("[LSP] stopped");
            return Task.CompletedTask;
        }

        private void StopActiveServer()
        {
            this.serverCancellation?.Cancel();
            this.serverStream?.Dispose();
            this.serverCancellation = null;
            this.serverStream = null;
        }
    }
}
