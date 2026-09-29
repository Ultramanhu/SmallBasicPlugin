namespace SmallBasic.Ext.Commands
{
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;
    using Microsoft.VisualStudio.Shell;
    using SmallBasic.Vsix.Commands;

    internal abstract class SmallBasicBackendCommandBase : Command
    {
        private readonly SmallBasicBackend backend;
        private readonly bool debug;

        protected SmallBasicBackendCommandBase(
            VisualStudioExtensibility extensibility,
            SmallBasicBackend backend,
            bool debug)
            : base(extensibility)
        {
            this.backend = backend;
            this.debug = debug;
            this.DisableDuringExecution = true;
        }

        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            if (this.debug)
            {
                SmallBasicCommandService.DebugActiveDocument(this.backend);
            }
            else
            {
                SmallBasicCommandService.RunActiveDocument(this.backend);
            }
        }
    }
}