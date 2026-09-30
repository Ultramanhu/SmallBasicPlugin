namespace SmallBasic.Vsix.Commands
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;

    [VisualStudioContribution]
    internal sealed class RunJavaScriptCommand : SmallBasicBackendCommandBase
    {
        public RunJavaScriptCommand(VisualStudioExtensibility extensibility)
            : base(extensibility, SmallBasicBackend.JavaScript, debug: false)
        {
        }

        public override CommandConfiguration CommandConfiguration => new("Run with JavaScript Backend")
        {
            Icon = new(ImageMoniker.KnownValues.Extension, IconSettings.IconAndText),
            EnabledWhen = SmallBasicDocumentEnabledWhen,
        };
    }
}