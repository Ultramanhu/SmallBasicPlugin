namespace SmallBasic.Vsix.Commands
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;

    [VisualStudioContribution]
    internal sealed class DebugCSharpCommand : SmallBasicBackendCommandBase
    {
        public DebugCSharpCommand(VisualStudioExtensibility extensibility)
            : base(extensibility, SmallBasicBackend.CSharp, debug: true)
        {
        }

        public override CommandConfiguration CommandConfiguration => new("Debug with C# Backend")
        {
            Icon = new(ImageMoniker.KnownValues.Extension, IconSettings.IconAndText),
            EnabledWhen = SmallBasicDocumentEnabledWhen,
        };
    }
}