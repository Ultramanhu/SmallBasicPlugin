namespace SmallBasic.Vsix.Editor.Breadcrumb
{
    using System;
    using System.Collections.Generic;
    using System.Windows;
    using System.Windows.Controls;
    using System.Windows.Input;
    using System.Windows.Media;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Classification;
    using Microsoft.VisualStudio.Text.Editor;
    using SmallBasic.Compiler.Scanning;
    using SmallBasic.Compiler.Services;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// The breadcrumb bar shown above a SmallBasic text view.
    /// </summary>
    /// <remarks>
    /// The chain always contains the document, the scope owning the caret
    /// (<c>&lt;主程序&gt;</c> or the enclosing <c>Sub</c>) and, when the caret sits
    /// on one, the variable. This mirrors the VS Code breadcrumb and the
    /// <c>&lt;top-level-statements-entry-point&gt;</c> entry the C# navigation bar
    /// shows for top level statements.
    /// </remarks>
    internal sealed class SmallBasicBreadcrumbMargin : IWpfTextViewMargin
    {
        internal const string MarginName = "SmallBasicBreadcrumb";

        private const string MainProgramName = "<主程序>";
        private const string PlainTextFormatName = "Plain Text";
        private const double BarHeight = 22d;
        private const double PathMaxWidth = 520d;

        private readonly IWpfTextView textView;
        private readonly SmallBasicCompilationService compilationService;
        private readonly IEditorFormatMap editorFormatMap;
        private readonly Border border;
        private readonly StackPanel panel;
        private bool isDisposed;

        public SmallBasicBreadcrumbMargin(
            IWpfTextView textView,
            SmallBasicCompilationService compilationService,
            IEditorFormatMapService editorFormatMapService)
        {
            this.textView = textView;
            this.compilationService = compilationService;
            this.editorFormatMap = editorFormatMapService.GetEditorFormatMap(textView);

            this.panel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
            };

            this.border = new Border
            {
                Height = BarHeight,
                Padding = new Thickness(6, 0, 6, 0),
                Child = this.panel,
            };
            this.VisualElement = this.border;

            this.textView.Caret.PositionChanged += this.OnCaretPositionChanged;
            this.textView.TextBuffer.Changed += this.OnBufferChanged;
            this.editorFormatMap.FormatMappingChanged += this.OnFormatMappingChanged;

            this.Update();
        }

        public FrameworkElement VisualElement { get; }

        public bool Enabled => true;

        public double MarginSize => BarHeight;

        public ITextViewMargin? GetTextViewMargin(string marginName)
        {
            return string.Equals(marginName, MarginName, StringComparison.OrdinalIgnoreCase) ? this : null;
        }

        public void Dispose()
        {
            if (this.isDisposed)
            {
                return;
            }

            this.isDisposed = true;
            this.textView.Caret.PositionChanged -= this.OnCaretPositionChanged;
            this.textView.TextBuffer.Changed -= this.OnBufferChanged;
            this.editorFormatMap.FormatMappingChanged -= this.OnFormatMappingChanged;
        }

        private void OnCaretPositionChanged(object sender, CaretPositionChangedEventArgs e)
        {
            this.Update();
        }

        private void OnBufferChanged(object sender, TextContentChangedEventArgs e)
        {
            this.Update();
        }

        private void OnFormatMappingChanged(object sender, EventArgs e)
        {
            this.Update();
        }

        private void Update()
        {
            if (this.isDisposed)
            {
                return;
            }

            try
            {
                Brush foreground = this.GetPlainTextBrush(EditorFormatDefinition.ForegroundBrushId, SystemColors.ControlTextBrush);
                this.border.Background = this.GetPlainTextBrush(EditorFormatDefinition.BackgroundBrushId, SystemColors.ControlBrush);

                SnapshotPoint caret = this.textView.Caret.Position.BufferPosition;
                ITextSnapshotLine caretLine = caret.GetContainingLine();
                int line = caretLine.LineNumber;
                int column = caret.Position - caretLine.Start.Position;

                this.panel.Children.Clear();
                this.AddSegment(this.GetDocumentPath(), string.Empty, null, foreground, isLast: false, isPath: true);

                IReadOnlyList<OutlineItem> items = this.GetOutline();
                OutlineItem? procedure = this.FindEnclosingProcedure(items, line, column);
                OutlineItem? variable = this.FindVariableAt(procedure, items, line, column);

                if (procedure != null)
                {
                    this.AddSegment(procedure.Name, string.Empty, procedure, foreground, isLast: variable == null, isPath: false);
                }
                else
                {
                    // Top level statements still get a node, like the C# navigation
                    // bar shows <top-level-statements-entry-point>.
                    this.AddSegment(MainProgramName, "主程序（顶层语句）", null, foreground, isLast: variable == null, isPath: false);
                }

                if (variable != null)
                {
                    this.AddSegment(variable.Name, string.Empty, variable, foreground, isLast: true, isPath: false);
                }
            }
            catch (Exception ex)
            {
                SmallBasicDiagnostics.Write("[breadcrumb] update failed: " + ex.Message);
            }
        }

        private Brush GetPlainTextBrush(string propertyName, Brush fallback)
        {
            try
            {
                return this.editorFormatMap.GetProperties(PlainTextFormatName)[propertyName] as Brush ?? fallback;
            }
            catch (Exception)
            {
                return fallback;
            }
        }

        private OutlineItem? FindEnclosingProcedure(IReadOnlyList<OutlineItem> items, int line, int column)
        {
            foreach (OutlineItem item in items)
            {
                if (item.Kind == OutlineItemKind.Procedure && this.Contains(item.Range, line, column))
                {
                    return item;
                }
            }

            return null;
        }

        private OutlineItem? FindVariableAt(OutlineItem? procedure, IReadOnlyList<OutlineItem> items, int line, int column)
        {
            IReadOnlyList<OutlineItem> scope = procedure != null ? procedure.Children : items;
            foreach (OutlineItem item in scope)
            {
                if (item.Kind == OutlineItemKind.Variable && this.Contains(item.Range, line, column))
                {
                    return item;
                }
            }

            return null;
        }

        private bool Contains(TextRange range, int line, int column)
        {
            return this.Compare(range.Start, line, column) <= 0 && this.Compare(range.End, line, column) >= 0;
        }

        private int Compare(TextPosition position, int line, int column)
        {
            return position.Line != line ? position.Line - line : position.Column - column;
        }

        private void AddSegment(string text, string tooltip, OutlineItem? target, Brush foreground, bool isLast, bool isPath)
        {
            if (!isPath && this.panel.Children.Count > 0)
            {
                this.panel.Children.Add(new TextBlock
                {
                    Text = "›",
                    Margin = new Thickness(6, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = foreground,
                    Opacity = 0.6,
                });
            }

            var label = new TextBlock
            {
                Text = text,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = foreground,
                TextTrimming = TextTrimming.CharacterEllipsis,
                FontWeight = isLast ? FontWeights.SemiBold : FontWeights.Normal,
            };

            if (isPath)
            {
                label.MaxWidth = PathMaxWidth;
                label.ToolTip = text;
            }
            else if (!string.IsNullOrEmpty(tooltip))
            {
                label.ToolTip = tooltip;
            }

            if (target != null)
            {
                label.Cursor = Cursors.Hand;
                label.ToolTip = "跳转到 " + target.Name;
                OutlineItem attached = target;
                label.MouseLeftButtonUp += (sender, args) => this.Navigate(attached);
            }

            this.panel.Children.Add(label);
        }

        private void Navigate(OutlineItem item)
        {
            this.NavigateTo(item.SelectionRange.Start.Line, item.SelectionRange.Start.Column);
        }

        private void NavigateTo(int line, int column)
        {
            ITextSnapshot snapshot = this.textView.TextSnapshot;
            int lineNumber = Math.Min(line, snapshot.LineCount - 1);
            if (lineNumber < 0)
            {
                return;
            }

            ITextSnapshotLine target = snapshot.GetLineFromLineNumber(lineNumber);
            int offset = Math.Min(column, target.Length);
            var point = new SnapshotPoint(snapshot, target.Start.Position + offset);
            this.textView.Caret.MoveTo(point);
            this.textView.ViewScroller.EnsureSpanVisible(new SnapshotSpan(point, point.Position < snapshot.Length ? 1 : 0));
            this.textView.VisualElement.Focus();
        }

        private string GetDocumentPath()
        {
            if (this.textView.TextBuffer.Properties.TryGetProperty(typeof(ITextDocument), out ITextDocument document)
                && !string.IsNullOrEmpty(document.FilePath))
            {
                return document.FilePath;
            }

            return "未命名";
        }

        private IReadOnlyList<OutlineItem> GetOutline()
        {
            return this.compilationService.GetCompilation(this.textView.TextBuffer).GetOutlineItems();
        }
    }
}
