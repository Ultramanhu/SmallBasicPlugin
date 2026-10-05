namespace SmallBasic.Tests.Editor
{
    using System.Collections.Generic;
    using System.Linq;
    using FluentAssertions;
    using SmallBasic.Compiler;
    using SmallBasic.Compiler.Services;
    using Xunit;

    public sealed class SmallBasicOutlineTests
    {
        [Fact]
        public void CollectsProceduresAndVariableFirstUsesInDocumentOrder()
        {
            IReadOnlyList<OutlineItem> items = OutlineOf(
                "count = 1",
                "Sub Greet",
                "  TextWindow.WriteLine(\"hi\")",
                "EndSub",
                "total = count + 1");

            items.Select(Describe).Should().Equal(
                "Variable count@0:0",
                "Procedure Greet@1:4",
                "Variable total@4:0");
        }

        [Fact]
        public void NestsVariablesUnderTheProcedureOwningTheirFirstUse()
        {
            IReadOnlyList<OutlineItem> items = OutlineOf(
                "count = 1",
                "Sub Greet",
                "  name = count",
                "EndSub");

            items.Select(Describe).Should().Equal("Variable count@0:0", "Procedure Greet@1:4");

            OutlineItem greet = items.Single(item => item.Kind == OutlineItemKind.Procedure);
            greet.Name.Should().Be("Greet");
            // `name` first appears inside the procedure; `count` first appears above it.
            greet.Children.Select(Describe).Should().Equal("Variable name@2:2");
        }

        [Fact]
        public void IgnoresLibraryNamesAndProcedureNames()
        {
            IReadOnlyList<OutlineItem> items = OutlineOf(
                "Sub Greet",
                "  TextWindow.WriteLine(\"hi\")",
                "EndSub",
                "Greet()",
                "value = Math.Abs(-3)");

            items.Select(Describe).Should().Equal("Procedure Greet@0:4", "Variable value@4:0");
            items[0].Children.Should().BeEmpty();
        }

        [Fact]
        public void ReportsForLoopVariables()
        {
            IReadOnlyList<OutlineItem> items = OutlineOf(
                "For i = 1 To 3",
                "  total = total + i",
                "EndFor");

            items.Select(Describe).Should().Equal("Variable i@0:4", "Variable total@1:2");
        }

        [Fact]
        public void KeepsOnlyTheEarliestOccurrenceOfAVariable()
        {
            IReadOnlyList<OutlineItem> items = OutlineOf("x = 1", "x = 2", "y = x");

            items.Select(Describe).Should().Equal("Variable x@0:0", "Variable y@2:0");
        }

        [Fact]
        public void HandlesTheSampleHelloProgram()
        {
            // Mirrors sample/hello/hello.sb, the file used to validate the editor UI.
            IReadOnlyList<OutlineItem> items = OutlineOf(
                "TextWindow.WriteLine(\"Hello, World!\")",
                string.Empty,
                "a1 = 1",
                "a2 = a1 + \"\"",
                "TextWindow.WriteLine(a2)",
                string.Empty,
                "s1 = \"3\"",
                "s2 = s1 * 1",
                "TextWindow.WriteLine(s2)",
                string.Empty,
                "Sub MySub",
                "\tTextWindow.WriteLine(\"Hello\")",
                "EndSub",
                string.Empty,
                "MySub()");

            items.Select(Describe).Should().Equal(
                "Variable a1@2:0",
                "Variable a2@3:0",
                "Variable s1@6:0",
                "Variable s2@7:0",
                "Procedure MySub@10:4");

            items.Single(item => item.Kind == OutlineItemKind.Procedure).Children.Should().BeEmpty();
        }

        private static IReadOnlyList<OutlineItem> OutlineOf(params string[] lines)
        {
            return new SmallBasicCompilation(string.Join("\n", lines)).GetOutlineItems();
        }

        private static string Describe(OutlineItem item)
        {
            var kind = item.Kind == OutlineItemKind.Procedure ? "Procedure" : "Variable";
            return $"{kind} {item.Name}@{item.SelectionRange.Start.Line}:{item.SelectionRange.Start.Column}";
        }
    }
}
