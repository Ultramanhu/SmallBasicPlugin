namespace SmallBasic.LanguageServices
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using FluentAssertions;
    using SmallBasic.Compiler;
    using SmallBasic.Compiler.Diagnostics;
    using SmallBasic.Tests;
    using Xunit;

    public sealed class SmallBasicLspAnalysisServiceTests : IClassFixture<CultureFixture>
    {
        private readonly SmallBasicLspAnalysisService service = new SmallBasicLspAnalysisService();

        [Fact]
        public void CompletionMapsMethodsPropertiesAndSnippetsToLspItems()
        {
            IReadOnlyList<SmallBasicLspCompletionItem> items = this.GetCompletions("Program.d$");

            SmallBasicLspCompletionItem delay = items.Single(item => item.Label == "Delay");
            SmallBasicLspCompletionItem directory = items.Single(item => item.Label == "Directory");

            delay.Kind.Should().Be(SmallBasicLspCompletionKind.Method);
            delay.InsertTextFormat.Should().Be(SmallBasicLspInsertTextFormat.Snippet);
            delay.InsertText.Should().Be("Delay(${1:milliSeconds})");

            directory.Kind.Should().Be(SmallBasicLspCompletionKind.Property);
            directory.InsertTextFormat.Should().Be(SmallBasicLspInsertTextFormat.PlainText);
            directory.InsertText.Should().Be("Directory");
        }

        [Fact]
        public void CompletionMapsKeywordBlocksAsSnippetItems()
        {
            IReadOnlyList<SmallBasicLspCompletionItem> items = this.GetCompletions("Whi$");

            SmallBasicLspCompletionItem whileItem = items.Single(item => item.Label == "While");
            whileItem.Kind.Should().Be(SmallBasicLspCompletionKind.Snippet);
            whileItem.InsertTextFormat.Should().Be(SmallBasicLspInsertTextFormat.Snippet);
            whileItem.InsertText.Should().Contain("${1:condition}");
            whileItem.InsertText.Should().Contain("EndWhile");
        }

        [Fact]
        public void HoverUsesCompilerDocumentationAndIdentifierRange()
        {
            (string source, int line, int column) = Marker("TextWindow.Write$Line(1)");

            SmallBasicLspHover? hover = this.service.GetHover(source, line, column);

            hover.Should().NotBeNull();
            hover!.Contents.Should().Contain("WriteLine");
            hover.Range.StartLine.Should().Be(0);
            hover.Range.StartCharacter.Should().Be(11);
            hover.Range.EndCharacter.Should().Be(20);
        }

        [Fact]
        public void DiagnosticsConvertCompilerInclusiveRangesToLspExclusiveRanges()
        {
            const string source = "TextWindow.NoMethod()";
            Diagnostic expected = new SmallBasicCompilation(source).Diagnostics.Single(d => d.Code == DiagnosticCode.LibraryMemberNotFound);

            SmallBasicLspDiagnostic actual = this.service.GetDiagnostics(source).Single(d => d.Message.Contains("NoMethod", StringComparison.Ordinal));

            actual.Message.Should().Contain("NoMethod");
            actual.Range.StartLine.Should().Be(expected.Range.Start.Line);
            actual.Range.StartCharacter.Should().Be(expected.Range.Start.Column);
            actual.Range.EndCharacter.Should().Be(expected.Range.End.Column + 1);
        }

        [Fact]
        public void DocumentSymbolsPreserveProcedureHierarchy()
        {
            const string source = "count = 1\nSub Greet\n  name = count\nEndSub";

            IReadOnlyList<SmallBasicLspDocumentSymbol> symbols = this.service.GetDocumentSymbols(source);

            symbols.Select(symbol => symbol.Name).Should().Equal("count", "Greet");
            symbols[0].Kind.Should().Be(SmallBasicLspSymbolKind.Variable);
            symbols[1].Kind.Should().Be(SmallBasicLspSymbolKind.Function);
            symbols[1].Children.Select(symbol => symbol.Name).Should().Equal("name");
            symbols[1].SelectionRange.StartLine.Should().Be(1);
            symbols[1].SelectionRange.StartCharacter.Should().Be(4);
        }

        private IReadOnlyList<SmallBasicLspCompletionItem> GetCompletions(string markedSource)
        {
            (string source, int line, int column) = Marker(markedSource);
            return this.service.GetCompletions(source, line, column);
        }

        private static (string Source, int Line, int Column) Marker(string text)
        {
            SmallBasicCompilation markerCompilation = new SmallBasicCompilation(text);
            Diagnostic marker = markerCompilation.Diagnostics.Single(d => d.Code == DiagnosticCode.UnrecognizedCharacter && d.Args.Single() == "$");
            return (text.Replace("$", string.Empty, StringComparison.CurrentCulture), marker.Range.Start.Line, marker.Range.Start.Column);
        }
    }
}