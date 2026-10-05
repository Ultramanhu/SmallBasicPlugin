// <copyright file="CompletionItemProviderTests.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Tests.Services
{
    using System;
    using System.Linq;
    using FluentAssertions;
    using SmallBasic.Compiler;
    using SmallBasic.Compiler.Diagnostics;
    using SmallBasic.Compiler.Services;
    using SmallBasic.Utilities;
    using SmallBasic.Utilities.Resources;
    using Xunit;

    public sealed class CompletionItemProviderTests : IClassFixture<CultureFixture>
    {
        [Fact]
        public void CompletesLibrariesStartingWithT()
        {
            TestForCompletionItems("T$",
                "Text",
                "TextWindow",
                "Timer",
                "Turtle");
        }

        [Fact]
        public void CompletesLibrariesStartingWithSt()
        {
            TestForCompletionItems("St$",
                "Stack");
        }

        [Fact]
        public void NoCompletionAfterNonExistingLibraries()
        {
            TestForCompletionItems("Wrong$");
        }

        [Fact]
        public void CompletesAllMembersAfterDot()
        {
            TestForCompletionItemsWithInsertText("Program.$",
                ("Delay(milliSeconds)", "Delay(${1:milliSeconds})"),
                ("End()", "End()"),
                ("GetArgument(index)", "GetArgument(${1:index})"),
                ("Pause()", "Pause()"),
                ("ArgumentCount", "ArgumentCount"),
                ("Directory", "Directory"));
        }

        [Fact]
        public void CompletesTopLevelItemsOnBlankLine()
        {
            TestForCompletionLabels("TextWindow.WriteLine(\"done\")\n$",
                "Array",
                "Clock",
                "Controls",
                "Desktop",
                "Dictionary",
                "File",
                "Flickr",
                "GraphicsWindow",
                "ImageList",
                "Math",
                "Mouse",
                "Network",
                "Program",
                "Shapes",
                "Sound",
                "Stack",
                "Text",
                "TextWindow",
                "Timer",
                "Turtle",
                "If",
                "ElseIf",
                "Else",
                "EndIf",
                "GoTo",
                "While",
                "EndWhile",
                "For",
                "For Step",
                "EndFor",
                "Break",
                "Continue",
                "Sub",
                "EndSub",
                "Function",
                "EndFunction",
                "Dim",
                "Return");
        }

        [Fact]
        public void CompletesInACaseInsensitiveManner()
        {
            TestForCompletionItemsWithInsertText("Program.d$",
                ("Delay(milliSeconds)", "Delay(${1:milliSeconds})"),
                ("Directory", "Directory"));
        }

        [Fact]
        public void CompletesMembersStartingWithPrefix()
        {
            TestForCompletionItemsWithInsertText("TextWindow.Wri$",
                ("Write(data)", "Write(${1:data})"),
                ("WriteLine(data)", "WriteLine(${1:data})"));
        }

        [Fact]
        public void CompletesMethodsWithParameterDocumentation()
        {
            var delay = GetItems("Program.D$").Single(item => item.label == "Delay(milliSeconds)");
            delay.documentation.Should().Be($"milliSeconds: {LibrariesResources.Program_Delay_milliSeconds}");

            // Parameterless methods carry no parameter docs.
            var end = GetItems("Program.$").Single(item => item.label == "End()");
            end.documentation.Should().BeEmpty();
        }

        [Fact]
        public void CompletesWhileSnippet()
        {
            var snippet = new string[]
            {
                "While ${1:condition}",
                "EndWhile"
            }.Join(Environment.NewLine);

            TestForCompletionItemsWithInsertText("Whi$",
                ("While", snippet));
        }

        [Fact]
        public void CompletesVariablesOnly()
        {
            string code = @"
var1 = 1
var2Ar[0] = 2
somethingElse = 3
va$
";

            TestForCompletionItems(code,
                "var1",
                "var2Ar");
        }

        [Fact]
        public void CompletesVariablesAndLibraries()
        {
            string code = @"
text1 = 1
texAr[0] = 2
somethingElse = 3
tex$
";

            TestForCompletionItems(code,
                "text1",
                "texAr",
                "Text",
                "TextWindow");
        }

        [Fact]
        public void CompletesSubModulesNames()
        {
            string code = @"
Sub FireEvent
EndSub
Fi$
";

            TestForCompletionItemsWithInsertText(code,
                ("FireEvent", "FireEvent()"),
                ("File", "File"));
        }

        private static void TestForCompletionItems(string text, params string[] expectedItems)
        {
            var actualItems = GetItems(text);
            actualItems.Select(item => item.label).Should().Equal(expectedItems);
            actualItems.Select(item => item.insertText.value).Should().Equal(expectedItems);
        }

        private static void TestForCompletionLabels(string text, params string[] expectedItems)
        {
            GetItems(text).Select(item => item.label).Should().Equal(expectedItems);
        }

        private static void TestForCompletionItemsWithInsertText(string text, params (string label, string insertText)[] expectedItems)
        {
            var actualItems = GetItems(text);
            actualItems.Select(item => item.label).Should().Equal(expectedItems.Select(i => i.label));
            actualItems.Select(item => item.insertText.value).Should().Equal(expectedItems.Select(i => i.insertText));
        }

        private static MonacoCompletionItem[] GetItems(string text)
        {
            var markerCompilation = new SmallBasicCompilation(text);
            var marker = markerCompilation.Diagnostics.Single(d => d.Code == DiagnosticCode.UnrecognizedCharacter && d.Args.Single() == "$");

            var start = marker.Range.Start;
            var end = marker.Range.End;
            start.Line.Should().Be(end.Line);
            start.Column.Should().Be(end.Column);

            var compilation = new SmallBasicCompilation(text.Replace("$", string.Empty, StringComparison.CurrentCulture));
            return compilation.ProvideCompletionItems((start.Line, start.Column));
        }
    }
}
