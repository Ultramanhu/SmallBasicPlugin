namespace SmallBasic.Vsix.Commands
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;

    [VisualStudioContribution]
    internal sealed class RunCSharpCommand : SmallBasicBackendCommandBase
    {
        public RunCSharpCommand(VisualStudioExtensibility extensibility)
            : base(extensibility, SmallBasicBackend.CSharp, debug: false)
        {
        }

        public override CommandConfiguration CommandConfiguration => new("Run with C# Backend")
        {
            Icon = new(ImageMoniker.KnownValues.Extension, IconSettings.IconAndText),
            EnabledWhen = SmallBasicDocumentEnabledWhen,
        };
    }
}