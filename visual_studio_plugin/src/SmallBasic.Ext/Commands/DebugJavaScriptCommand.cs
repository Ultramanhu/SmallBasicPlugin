namespace SmallBasic.Ext.Commands
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;
    using SmallBasic.Vsix.Commands;

    [VisualStudioContribution]
    internal sealed class DebugJavaScriptCommand : SmallBasicBackendCommandBase
    {
        public DebugJavaScriptCommand(VisualStudioExtensibility extensibility)
            : base(extensibility, SmallBasicBackend.JavaScript, debug: true)
        {
        }

        public override CommandConfiguration CommandConfiguration => new("Debug with JavaScript Backend")
        {
            Icon = new(ImageMoniker.KnownValues.Extension, IconSettings.IconAndText),
        };
    }
}