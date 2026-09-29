namespace SmallBasic.Ext.Commands
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;
    using SmallBasic.Vsix.Commands;

    [VisualStudioContribution]
    internal sealed class RunBlazorCommand : SmallBasicBackendCommandBase
    {
        public RunBlazorCommand(VisualStudioExtensibility extensibility)
            : base(extensibility, SmallBasicBackend.Blazor, debug: false)
        {
        }

        public override CommandConfiguration CommandConfiguration => new("Run with Blazor Backend")
        {
            Icon = new(ImageMoniker.KnownValues.Extension, IconSettings.IconAndText),
        };
    }
}