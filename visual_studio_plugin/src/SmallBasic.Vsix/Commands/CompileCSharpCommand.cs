namespace SmallBasic.Vsix.Commands
{
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;
    using Microsoft.VisualStudio.Shell;

    [VisualStudioContribution]
    internal sealed class CompileCSharpCommand : Command
    {
        public CompileCSharpCommand(VisualStudioExtensibility extensibility)
            : base(extensibility)
        {
            this.DisableDuringExecution = true;
        }

        public override CommandConfiguration CommandConfiguration => new("Compile to EXE (C#)")
        {
            Icon = new(ImageMoniker.KnownValues.Extension, IconSettings.IconAndText),
            EnabledWhen = SmallBasicBackendCommandBase.SmallBasicDocumentEnabledWhen,
        };

        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            SmallBasicCommandService.CompileActiveDocument();
        }
    }
}
