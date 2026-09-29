namespace SmallBasic.LanguageServices.Outline
{
    using System.Linq;
    using FluentAssertions;
    using Xunit;

    public sealed class SmallBasicOutlineBuilderTests
    {
        [Fact]
        public void GroupsTopLevelVariablesUnderMainModule()
        {
            var items = Build(
                "count = 1",
                "Sub Greet",
                "  name = count",
                "EndSub",
                "total = count + 1");

            items.Select(item => item.DisplayText).Should().Equal("<主程序>", "Sub Greet");
            items[0].Children.Select(item => Describe(item)).Should().Equal(
                "count@0:0",
                "total@4:0");
        }

        [Fact]
        public void NestsProcedureVariablesUnderProcedureNode()
        {
            var items = Build(
                "Sub Greet",
                "  firstName = \"Ada\"",
                "  lastName = firstName",
                "EndSub");

            items.Should().ContainSingle();
            items[0].DisplayText.Should().Be("Sub Greet");
            items[0].Children.Select(item => Describe(item)).Should().Equal(
                "firstName@1:2",
                "lastName@2:2");
        }

        [Fact]
        public void PreservesSelectionCoordinatesForNavigation()
        {
            var items = Build(
                "value = 1",
                "Sub Demo",
                "  inner = value",
                "EndSub");

            SmallBasicOutlineNodeInfo mainModule = items[0];
            SmallBasicOutlineNodeInfo procedure = items[1];

            mainModule.Line.Should().Be(0);
            mainModule.Column.Should().Be(0);
            procedure.Line.Should().Be(1);
            procedure.Column.Should().Be(4);
            procedure.Children.Single().Line.Should().Be(2);
            procedure.Children.Single().Column.Should().Be(2);
        }

        private static System.Collections.Generic.IReadOnlyList<SmallBasicOutlineNodeInfo> Build(params string[] lines)
        {
            return SmallBasicOutlineBuilder.Build(string.Join("\n", lines), @"G:\temp\sample.sb");
        }

        private static string Describe(SmallBasicOutlineNodeInfo item)
        {
            return $"{item.DisplayText}@{item.Line}:{item.Column}";
        }
    }
}