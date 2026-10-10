namespace SmallBasic.Vsix.Commands
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;

    [VisualStudioContribution]
    internal sealed class DebugCompiledCSharpCommand : SmallBasicBackendCommandBase
    {
        public DebugCompiledCSharpCommand(VisualStudioExtensibility extensibility)
            : base(extensibility, SmallBasicBackend.CompiledCSharp, debug: true)
        {
        }

        public override CommandConfiguration CommandConfiguration => new("Debug with Compiled C# Backend")
        {
            Icon = new(ImageMoniker.KnownValues.Extension, IconSettings.IconAndText),
            EnabledWhen = SmallBasicDocumentEnabledWhen,
        };
    }
}
