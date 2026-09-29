namespace SmallBasic.Ext.Commands
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;
    using SmallBasic.Vsix.Commands;

    [VisualStudioContribution]
    internal sealed class DebugBlazorCommand : SmallBasicBackendCommandBase
    {
        public DebugBlazorCommand(VisualStudioExtensibility extensibility)
            : base(extensibility, SmallBasicBackend.Blazor, debug: true)
        {
        }

        public override CommandConfiguration CommandConfiguration => new("Debug with Blazor Backend")
        {
            Icon = new(ImageMoniker.KnownValues.Extension, IconSettings.IconAndText),
        };
    }
}