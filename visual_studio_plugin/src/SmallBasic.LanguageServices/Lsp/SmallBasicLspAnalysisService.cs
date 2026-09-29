namespace SmallBasic.LanguageServices
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using SmallBasic.Compiler;
    using SmallBasic.Compiler.Diagnostics;
    using SmallBasic.Compiler.Scanning;
    using SmallBasic.Compiler.Services;

    /// <summary>
    /// Maps the vendor <see cref="SmallBasicCompilation"/> semantic model onto the
    /// transport-neutral LSP shapes in <see cref="SmallBasicLspModels"/>.
    /// </summary>
    /// <remarks>
    /// The service is deliberately free of any Visual Studio dependency so it can be
    /// exercised directly from tests (and reused by other hosts) without spinning up
    /// the shell.
    /// </remarks>
    public sealed class SmallBasicLspAnalysisService
    {
        public IReadOnlyList<SmallBasicLspCompletionItem> GetCompletions(string sourceText, int line, int character)
        {
            var compilation = new SmallBasicCompilation(sourceText ?? string.Empty);
            MonacoCompletionItem[] items = compilation.ProvideCompletionItems((line, character));

            return items.Select(item =>
            {
                string insertText = item.insertText?.value ?? item.label ?? string.Empty;
                bool isSnippet = insertText.IndexOf('$') >= 0;
                return new SmallBasicLspCompletionItem(
                    item.label ?? string.Empty,
                    item.detail ?? item.label ?? string.Empty,
                    insertText,
                    MapCompletionKind(item.kind),
                    isSnippet ? SmallBasicLspInsertTextFormat.Snippet : SmallBasicLspInsertTextFormat.PlainText);
            }).ToArray();
        }

        /// <summary>
        /// Returns the compiler documentation for the identifier at the position, or
        /// <see langword="null"/> when the position is not on an identifier or the
        /// compiler has no documentation for it.
        /// </summary>
        public SmallBasicLspHover? GetHover(string sourceText, int line, int character)
        {
            string normalizedText = sourceText ?? string.Empty;
            var compilation = new SmallBasicCompilation(normalizedText);
            string[] hover = compilation.ProvideHover((line, character));
            if (hover.Length == 0 || !TryGetIdentifierRange(normalizedText, line, character, out SmallBasicLspRange? range))
            {
                return null;
            }

            return new SmallBasicLspHover(string.Join(Environment.NewLine, hover), range!);
        }

        public IReadOnlyList<SmallBasicLspDiagnostic> GetDiagnostics(string sourceText)
        {
            var compilation = new SmallBasicCompilation(sourceText ?? string.Empty);
            return compilation.Diagnostics.Select(ToDiagnostic).ToArray();
        }

        public IReadOnlyList<SmallBasicLspDocumentSymbol> GetDocumentSymbols(string sourceText)
        {
            var compilation = new SmallBasicCompilation(sourceText ?? string.Empty);
            return compilation.GetOutlineItems().Select(ToDocumentSymbol).ToArray();
        }

        private static SmallBasicLspCompletionKind MapCompletionKind(MonacoCompletionItemKind kind)
        {
            switch (kind)
            {
                case MonacoCompletionItemKind.Method:
                    return SmallBasicLspCompletionKind.Method;
                case MonacoCompletionItemKind.Class:
                    return SmallBasicLspCompletionKind.Class;
                case MonacoCompletionItemKind.Property:
                    return SmallBasicLspCompletionKind.Property;
                case MonacoCompletionItemKind.Snippet:
                    return SmallBasicLspCompletionKind.Snippet;
                case MonacoCompletionItemKind.Event:
                    return SmallBasicLspCompletionKind.Event;
                default:
                    return SmallBasicLspCompletionKind.Variable;
            }
        }

        private static SmallBasicLspDiagnostic ToDiagnostic(Diagnostic diagnostic)
        {
            return new SmallBasicLspDiagnostic(
                diagnostic.ToDisplayString(),
                ToRange(diagnostic.Range),
                SmallBasicLspDiagnosticSeverity.Error);
        }

        private static SmallBasicLspDocumentSymbol ToDocumentSymbol(OutlineItem item)
        {
            SmallBasicLspSymbolKind kind = item.Kind == OutlineItemKind.Procedure
                ? SmallBasicLspSymbolKind.Function
                : SmallBasicLspSymbolKind.Variable;

            return new SmallBasicLspDocumentSymbol(
                item.Name,
                kind,
                ToRange(item.Range),
                ToRange(item.SelectionRange),
                item.Children.Select(ToDocumentSymbol).ToArray());
        }

        /// <summary>
        /// Converts a compiler range into LSP coordinates. The compiler reports an
        /// inclusive end column while LSP expects an exclusive one.
        /// </summary>
        private static SmallBasicLspRange ToRange(TextRange range)
        {
            return new SmallBasicLspRange(
                range.Start.Line,
                range.Start.Column,
                range.End.Line,
                range.End.Column + 1);
        }

        private static bool TryGetIdentifierRange(string text, int line, int character, out SmallBasicLspRange? range)
        {
            range = null;
            string[] lines = (text ?? string.Empty).Replace("\r\n", "\n").Split('\n');
            if (lines.Length == 0 || line < 0 || line >= lines.Length)
            {
                return false;
            }

            string lineText = lines[line];
            if (lineText.Length == 0)
            {
                return false;
            }

            int index = Math.Max(0, Math.Min(character, lineText.Length));
            if (index == lineText.Length)
            {
                index--;
            }

            if (index >= 0 && index < lineText.Length && !IsIdentifierCharacter(lineText[index]) && index > 0 && IsIdentifierCharacter(lineText[index - 1]))
            {
                index--;
            }

            if (index < 0 || index >= lineText.Length || !IsIdentifierCharacter(lineText[index]))
            {
                return false;
            }

            int start = index;
            while (start > 0 && IsIdentifierCharacter(lineText[start - 1]))
            {
                start--;
            }

            int end = index + 1;
            while (end < lineText.Length && IsIdentifierCharacter(lineText[end]))
            {
                end++;
            }

            range = new SmallBasicLspRange(line, start, line, end);
            return true;
        }

        private static bool IsIdentifierCharacter(char value)
        {
            return char.IsLetterOrDigit(value) || value == '_';
        }
    }
}
