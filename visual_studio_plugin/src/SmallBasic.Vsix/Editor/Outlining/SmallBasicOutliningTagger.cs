namespace SmallBasic.Vsix.Editor.Outlining
{
    using System;
    using System.Collections.Generic;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Adornments;
    using Microsoft.VisualStudio.Text.Tagging;
    using SmallBasic.Compiler.Scanning;
    using SmallBasic.Compiler.Services;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// Publishes the document outline ("文档大纲") and the folding regions of a
    /// SmallBasic buffer as <see cref="IStructureTag"/> spans:
    /// control-flow blocks (If / While / For) are scanned line by line, while the
    /// procedure declarations and variable first uses come from the compiler so
    /// the outline matches the language semantics.
    /// </summary>
    internal sealed class SmallBasicStructureTagger : ITagger<IStructureTag>
    {
        private readonly ITextBuffer textBuffer;
        private readonly SmallBasicCompilationService compilationService;
        private ITextSnapshot? cachedSnapshot;
        private IReadOnlyList<TagSpan<IStructureTag>> cachedTags = Array.Empty<TagSpan<IStructureTag>>();

        public SmallBasicStructureTagger(ITextBuffer textBuffer, SmallBasicCompilationService compilationService)
        {
            this.textBuffer = textBuffer;
            this.compilationService = compilationService;
            this.textBuffer.Changed += this.OnTextBufferChanged;
        }

        public event EventHandler<SnapshotSpanEventArgs>? TagsChanged;

        public IEnumerable<ITagSpan<IStructureTag>> GetTags(NormalizedSnapshotSpanCollection spans)
        {
            if (spans.Count == 0)
            {
                yield break;
            }

            ITextSnapshot snapshot = spans[0].Snapshot;
            if (!ReferenceEquals(snapshot, this.cachedSnapshot))
            {
                this.cachedSnapshot = snapshot;
                this.cachedTags = BuildTags(snapshot);
            }

            foreach (TagSpan<IStructureTag> tag in this.cachedTags)
            {
                if (IntersectsRequestedSpan(spans, tag.Span))
                {
                    yield return tag;
                }
            }
        }

        private static IReadOnlyList<BlockRegion> FindRegions(ITextSnapshot snapshot)
        {
            var regions = new List<BlockRegion>();
            var openBlocks = new Stack<OpenBlock>();

            for (var lineNumber = 0; lineNumber < snapshot.LineCount; lineNumber++)
            {
                string keyword = ReadLeadingKeyword(snapshot.GetLineFromLineNumber(lineNumber).GetText());
                if (TryGetOpeningKind(keyword, out BlockKind openingKind))
                {
                    openBlocks.Push(new OpenBlock(openingKind, lineNumber));
                    continue;
                }

                if (!TryGetClosingKind(keyword, out BlockKind closingKind)
                    || openBlocks.Count == 0
                    || openBlocks.Peek().Kind != closingKind)
                {
                    continue;
                }

                OpenBlock opening = openBlocks.Pop();
                if (lineNumber > opening.LineNumber)
                {
                    regions.Add(new BlockRegion(opening.Kind, opening.LineNumber, lineNumber));
                }
            }

            regions.Sort((left, right) =>
            {
                int startComparison = left.OpeningLine.CompareTo(right.OpeningLine);
                return startComparison != 0
                    ? startComparison
                    : right.ClosingLine.CompareTo(left.ClosingLine);
            });
            return regions;
        }

        private static bool IntersectsRequestedSpan(
            NormalizedSnapshotSpanCollection requestedSpans,
            SnapshotSpan regionSpan)
        {
            foreach (SnapshotSpan requestedSpan in requestedSpans)
            {
                if (requestedSpan.IntersectsWith(regionSpan))
                {
                    return true;
                }
            }

            return false;
        }

        private static int FindFirstNonWhitespace(ITextSnapshotLine line)
        {
            string text = line.GetText();
            var index = 0;
            while (index < text.Length && char.IsWhiteSpace(text[index]))
            {
                index++;
            }

            return line.Start.Position + index;
        }

        private static bool TryToSpan(ITextSnapshot snapshot, TextRange range, out SnapshotSpan span)
        {
            span = default;
            if (range.Start.Line < 0 || range.End.Line < 0
                || range.Start.Line >= snapshot.LineCount || range.End.Line >= snapshot.LineCount)
            {
                return false;
            }

            ITextSnapshotLine startLine = snapshot.GetLineFromLineNumber(range.Start.Line);
            ITextSnapshotLine endLine = snapshot.GetLineFromLineNumber(range.End.Line);
            int start = startLine.Start.Position + Math.Min(range.Start.Column, startLine.Length);
            int end = endLine.Start.Position + Math.Min(range.End.Column, endLine.Length);
            if (end < start || end > snapshot.Length)
            {
                return false;
            }

            span = new SnapshotSpan(snapshot, Span.FromBounds(start, end));
            return true;
        }

        private static TagSpan<IStructureTag> CreateTag(
            ITextSnapshot snapshot,
            Span structureSpan,
            Span outliningSpan,
            Span headerSpan,
            string type,
            bool isCollapsible,
            string collapsedForm,
            string collapsedHintForm)
        {
            var structureTag = new StructureTag(
                snapshot,
                outliningSpan,
                headerSpan,
                guideLineSpan: null,
                guideLineHorizontalAnchor: headerSpan.Start,
                type: type,
                isCollapsible: isCollapsible,
                isDefaultCollapsed: false,
                isImplementation: false,
                collapsedForm: collapsedForm,
                collapsedHintForm: collapsedHintForm);
            return new TagSpan<IStructureTag>(new SnapshotSpan(snapshot, structureSpan), structureTag);
        }

        private static void AddOutlineTags(ITextSnapshot snapshot, List<TagSpan<IStructureTag>> tags, OutlineItem item)
        {
            if (TryToSpan(snapshot, item.Range, out SnapshotSpan span))
            {
                bool isProcedure = item.Kind == OutlineItemKind.Procedure;
                ITextSnapshotLine firstLine = snapshot.GetLineFromPosition(span.Start.Position);
                ITextSnapshotLine lastLine = snapshot.GetLineFromPosition(span.End.Position);
                bool isCollapsible = isProcedure && lastLine.LineNumber > firstLine.LineNumber;
                var headerSpan = isProcedure
                    ? Span.FromBounds(FindFirstNonWhitespace(firstLine), firstLine.End.Position)
                    : span.Span;
                var outliningSpan = isCollapsible
                    ? Span.FromBounds(firstLine.End.Position, lastLine.End.Position)
                    : span.Span;

                tags.Add(CreateTag(
                    snapshot,
                    span.Span,
                    outliningSpan,
                    headerSpan,
                    GetStructureType(item.Kind),
                    isCollapsible,
                    collapsedForm: isProcedure ? "..." : item.Name,
                    collapsedHintForm: isProcedure ? snapshot.GetText(span.Span) : item.Name));
            }

            foreach (OutlineItem child in item.Children)
            {
                AddOutlineTags(snapshot, tags, child);
            }
        }

        private static string GetStructureType(BlockKind kind)
        {
            switch (kind)
            {
                case BlockKind.If:
                    return PredefinedStructureTagTypes.Conditional;
                case BlockKind.While:
                case BlockKind.For:
                    return PredefinedStructureTagTypes.Loop;
                default:
                    return PredefinedStructureTagTypes.Structural;
            }
        }

        private static string GetStructureType(OutlineItemKind kind)
        {
            return kind == OutlineItemKind.Procedure
                ? PredefinedStructureTagTypes.Member
                : PredefinedStructureTagTypes.Statement;
        }

        private static string ReadLeadingKeyword(string line)
        {
            var index = 0;
            while (index < line.Length && char.IsWhiteSpace(line[index]))
            {
                index++;
            }

            if (index >= line.Length || line[index] == '\'')
            {
                return string.Empty;
            }

            int start = index;
            while (index < line.Length && char.IsLetter(line[index]))
            {
                index++;
            }

            return index == start ? string.Empty : line.Substring(start, index - start);
        }

        private static bool TryGetOpeningKind(string keyword, out BlockKind kind)
        {
            if (keyword.Equals("If", StringComparison.OrdinalIgnoreCase))
            {
                kind = BlockKind.If;
                return true;
            }

            if (keyword.Equals("While", StringComparison.OrdinalIgnoreCase))
            {
                kind = BlockKind.While;
                return true;
            }

            if (keyword.Equals("For", StringComparison.OrdinalIgnoreCase))
            {
                kind = BlockKind.For;
                return true;
            }

            kind = default;
            return false;
        }

        private static bool TryGetClosingKind(string keyword, out BlockKind kind)
        {
            if (keyword.Equals("EndIf", StringComparison.OrdinalIgnoreCase))
            {
                kind = BlockKind.If;
                return true;
            }

            if (keyword.Equals("EndWhile", StringComparison.OrdinalIgnoreCase))
            {
                kind = BlockKind.While;
                return true;
            }

            if (keyword.Equals("EndFor", StringComparison.OrdinalIgnoreCase))
            {
                kind = BlockKind.For;
                return true;
            }

            kind = default;
            return false;
        }

        private IReadOnlyList<TagSpan<IStructureTag>> BuildTags(ITextSnapshot snapshot)
        {
            var tags = new List<TagSpan<IStructureTag>>();

            // Folding regions for the control-flow blocks.
            foreach (BlockRegion region in FindRegions(snapshot))
            {
                ITextSnapshotLine openingLine = snapshot.GetLineFromLineNumber(region.OpeningLine);
                ITextSnapshotLine closingLine = snapshot.GetLineFromLineNumber(region.ClosingLine);
                int headerStart = FindFirstNonWhitespace(openingLine);
                string hoverText = snapshot.GetText(Span.FromBounds(openingLine.Start.Position, closingLine.End.Position));
                tags.Add(CreateTag(
                    snapshot,
                    Span.FromBounds(openingLine.Start.Position, closingLine.End.Position),
                    Span.FromBounds(openingLine.End.Position, closingLine.End.Position),
                    Span.FromBounds(headerStart, openingLine.End.Position),
                    GetStructureType(region.Kind),
                    isCollapsible: true,
                    collapsedForm: "...",
                    collapsedHintForm: hoverText));
            }

            // Document outline: procedure declarations and variable first uses.
            // A compiler failure must never cost the folding regions above.
            try
            {
                foreach (OutlineItem item in this.compilationService.GetCompilation(this.textBuffer).GetOutlineItems())
                {
                    AddOutlineTags(snapshot, tags, item);
                }
            }
            catch (Exception)
            {
                // Ignore: the control-flow folding regions are already collected.
            }

            return tags;
        }

        private void OnTextBufferChanged(object? sender, TextContentChangedEventArgs e)
        {
            this.cachedSnapshot = null;
            this.cachedTags = Array.Empty<TagSpan<IStructureTag>>();
            this.TagsChanged?.Invoke(
                this,
                new SnapshotSpanEventArgs(new SnapshotSpan(e.After, 0, e.After.Length)));
        }

        private enum BlockKind
        {
            If,
            While,
            For,
        }

        private readonly struct OpenBlock
        {
            public OpenBlock(BlockKind kind, int lineNumber)
            {
                this.Kind = kind;
                this.LineNumber = lineNumber;
            }

            public BlockKind Kind { get; }

            public int LineNumber { get; }
        }

        private readonly struct BlockRegion
        {
            public BlockRegion(BlockKind kind, int openingLine, int closingLine)
            {
                this.Kind = kind;
                this.OpeningLine = openingLine;
                this.ClosingLine = closingLine;
            }

            public BlockKind Kind { get; }

            public int OpeningLine { get; }

            public int ClosingLine { get; }
        }
    }
}
