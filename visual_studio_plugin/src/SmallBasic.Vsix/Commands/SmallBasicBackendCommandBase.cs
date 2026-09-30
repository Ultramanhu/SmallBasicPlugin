namespace SmallBasic.Vsix.Commands
{
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;
    using Microsoft.VisualStudio.Shell;

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

        // Run/debug only makes sense for Small Basic programs; the command is greyed
        // out unless the active editor shows a .sb document. Declared as a shared
        // expression because the manifest generator needs a concrete
        // CommandConfiguration on every command class.
        protected static ActivationConstraint SmallBasicDocumentEnabledWhen =>
            ActivationConstraint.ClientContext(
                ClientContextKey.Shell.ActiveEditorFileName,
                @"(?i)\.sb$");

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
