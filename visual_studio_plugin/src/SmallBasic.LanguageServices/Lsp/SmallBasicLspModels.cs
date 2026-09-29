namespace SmallBasic.LanguageServices
{
    using System.Collections.Generic;

    /// <summary>
    /// Transport-neutral completion item kinds used by the Small Basic language
    /// server. The numeric values mirror the LSP <c>CompletionItemKind</c> enum so
    /// the JSON-RPC layer can forward them verbatim.
    /// </summary>
    public enum SmallBasicLspCompletionKind
    {
        Method = 2,
        Variable = 6,
        Class = 7,
        Property = 10,
        Snippet = 15,
        Event = 23,
    }

    public enum SmallBasicLspInsertTextFormat
    {
        PlainText = 1,
        Snippet = 2,
    }

    public enum SmallBasicLspDiagnosticSeverity
    {
        Error = 1,
    }

    public enum SmallBasicLspSymbolKind
    {
        Function = 12,
        Variable = 13,
    }

    /// <summary>
    /// A zero-based, half-open text range using LSP coordinates.
    /// </summary>
    public sealed class SmallBasicLspRange
    {
        public SmallBasicLspRange(int startLine, int startCharacter, int endLine, int endCharacter)
        {
            this.StartLine = startLine;
            this.StartCharacter = startCharacter;
            this.EndLine = endLine;
            this.EndCharacter = endCharacter;
        }

        public int StartLine { get; }

        public int StartCharacter { get; }

        public int EndLine { get; }

        public int EndCharacter { get; }
    }

    public sealed class SmallBasicLspCompletionItem
    {
        public SmallBasicLspCompletionItem(string label, string detail, string insertText, SmallBasicLspCompletionKind kind, SmallBasicLspInsertTextFormat insertTextFormat)
        {
            this.Label = label;
            this.Detail = detail;
            this.InsertText = insertText;
            this.Kind = kind;
            this.InsertTextFormat = insertTextFormat;
        }

        public string Label { get; }

        public string Detail { get; }

        public string InsertText { get; }

        public SmallBasicLspCompletionKind Kind { get; }

        public SmallBasicLspInsertTextFormat InsertTextFormat { get; }
    }

    public sealed class SmallBasicLspHover
    {
        public SmallBasicLspHover(string contents, SmallBasicLspRange range)
        {
            this.Contents = contents;
            this.Range = range;
        }

        public string Contents { get; }

        public SmallBasicLspRange Range { get; }
    }

    public sealed class SmallBasicLspDiagnostic
    {
        public SmallBasicLspDiagnostic(string message, SmallBasicLspRange range, SmallBasicLspDiagnosticSeverity severity)
        {
            this.Message = message;
            this.Range = range;
            this.Severity = severity;
        }

        public string Message { get; }

        public SmallBasicLspRange Range { get; }

        public SmallBasicLspDiagnosticSeverity Severity { get; }
    }

    public sealed class SmallBasicLspDocumentSymbol
    {
        public SmallBasicLspDocumentSymbol(string name, SmallBasicLspSymbolKind kind, SmallBasicLspRange range, SmallBasicLspRange selectionRange, IReadOnlyList<SmallBasicLspDocumentSymbol> children)
        {
            this.Name = name;
            this.Kind = kind;
            this.Range = range;
            this.SelectionRange = selectionRange;
            this.Children = children;
        }

        public string Name { get; }

        public SmallBasicLspSymbolKind Kind { get; }

        public SmallBasicLspRange Range { get; }

        public SmallBasicLspRange SelectionRange { get; }

        public IReadOnlyList<SmallBasicLspDocumentSymbol> Children { get; }
    }
}
