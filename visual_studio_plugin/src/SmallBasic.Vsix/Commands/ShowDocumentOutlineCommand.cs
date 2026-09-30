namespace SmallBasic.Vsix.Commands
{
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;
    using SmallBasic.Vsix.ToolWindows.Outline;

    [VisualStudioContribution]
    internal sealed class ShowDocumentOutlineCommand : Command
    {
        public ShowDocumentOutlineCommand(VisualStudioExtensibility extensibility)
            : base(extensibility)
        {
        }

        public override CommandConfiguration CommandConfiguration => new("Show Document Outline")
        {
            Icon = new(ImageMoniker.KnownValues.ToolWindow, IconSettings.IconAndText),
        };

        public override Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            return this.Extensibility.Shell().ShowToolWindowAsync<SmallBasicOutlineToolWindow>(activate: true, cancellationToken);
        }
    }
}