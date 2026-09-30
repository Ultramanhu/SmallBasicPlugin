namespace SmallBasic.Vsix.Commands
{
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.Commands;

    internal static class SmallBasicMenuConfiguration
    {
        [VisualStudioContribution]
        public static MenuConfiguration SmallBasicToolsMenu => new("Small Basic")
        {
            Children = new[]
            {
                MenuChild.Group(
                    GroupChild.Command<RunCSharpCommand>(),
                    GroupChild.Command<DebugCSharpCommand>()),
                MenuChild.Group(
                    GroupChild.Command<RunJavaScriptCommand>(),
                    GroupChild.Command<DebugJavaScriptCommand>()),
                MenuChild.Group(
                    GroupChild.Command<RunBlazorCommand>(),
                    GroupChild.Command<DebugBlazorCommand>(),
                    GroupChild.Command<ShowDocumentOutlineCommand>()),
            },
        };

        [VisualStudioContribution]
        public static CommandGroupConfiguration SmallBasicToolsMenuGroup => new(GroupPlacement.KnownPlacements.ToolsMenu)
        {
            Children = new[]
            {
                GroupChild.Menu(SmallBasicToolsMenu),
            },
        };
    }
}