namespace SmallBasic.Ext.Commands
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;
    using SmallBasic.Vsix.Commands;

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
        };
    }
}