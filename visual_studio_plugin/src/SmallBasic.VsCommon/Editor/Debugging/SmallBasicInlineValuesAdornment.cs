namespace SmallBasic.Vsix.Editor.Debugging
{
    using System;
    using System.Collections.Generic;
    using System.ComponentModel.Composition;
    using System.Linq;
    using System.Text.RegularExpressions;
    using System.Windows.Controls;
    using System.Windows.Media;
    using System.Windows.Threading;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Editor;
    using Microsoft.VisualStudio.Text.Formatting;
    using Microsoft.VisualStudio.Utilities;

    [Export(typeof(IWpfTextViewCreationListener))]
    [ContentType("smallbasic")]
    [TextViewRole(PredefinedTextViewRoles.Document)]
    internal sealed class SmallBasicInlineValuesAdornmentProvider : IWpfTextViewCreationListener
    {
        internal const string LayerName = "SmallBasic Inline Values";

#pragma warning disable CS0649
        [Export(typeof(AdornmentLayerDefinition))]
        [Name(LayerName)]
        [Order(After = PredefinedAdornmentLayers.Text)]
        private AdornmentLayerDefinition? layerDefinition;
#pragma warning restore CS0649

        public void TextViewCreated(IWpfTextView textView)
        {
            textView.Properties.GetOrCreateSingletonProperty(
                () => new SmallBasicInlineValuesAdornment(textView));
        }
    }

    /// <summary>
    /// Shows the current Small Basic globals at the end of the active statement.
    /// The DAP host exposes its Globals scope through DTE's current stack frame;
    /// polling while the debugger is in break mode keeps the adornment in sync
    /// with F10/F11 without coupling the editor to a specific debug engine.
    /// </summary>
    internal sealed class SmallBasicInlineValuesAdornment : IDisposable
    {
        private static readonly Regex IdentifierPattern = new Regex(
            @"\b[A-Za-z_][A-Za-z0-9_]*\b",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private readonly IWpfTextView view;
        private readonly IAdornmentLayer layer;
        private readonly DispatcherTimer refreshTimer;
        private string lastFingerprint = string.Empty;
        private bool disposed;

        public SmallBasicInlineValuesAdornment(IWpfTextView view)
        {
            this.view = view;
            this.layer = view.GetAdornmentLayer(SmallBasicInlineValuesAdornmentProvider.LayerName);
            this.refreshTimer = new DispatcherTimer(DispatcherPriority.Background, view.VisualElement.Dispatcher)
            {
                Interval = TimeSpan.FromMilliseconds(150),
            };
            this.refreshTimer.Tick += this.OnRefreshTimer;
            this.view.LayoutChanged += this.OnLayoutChanged;
            this.view.Closed += this.OnViewClosed;
            this.refreshTimer.Start();
        }

        public void Dispose()
        {
            if (this.disposed)
            {
                return;
            }

            this.disposed = true;
            this.refreshTimer.Stop();
            this.refreshTimer.Tick -= this.OnRefreshTimer;
            this.view.LayoutChanged -= this.OnLayoutChanged;
            this.view.Closed -= this.OnViewClosed;
            this.layer.RemoveAllAdornments();
        }

        private void OnRefreshTimer(object? sender, EventArgs e) => this.Refresh();

        private void OnLayoutChanged(object? sender, TextViewLayoutChangedEventArgs e)
        {
            if (e.NewOrReformattedLines.Count > 0 || e.VerticalTranslation)
            {
                this.lastFingerprint = string.Empty;
                this.Refresh();
            }
        }

        private void OnViewClosed(object? sender, EventArgs e) => this.Dispose();

        private void Refresh()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            SnapshotPoint caret = this.view.Caret.Position.BufferPosition;
            ITextSnapshotLine snapshotLine = caret.GetContainingLine();
            if (!this.TryGetInlineText(snapshotLine.GetText(), out string inlineText))
            {
                this.Clear();
                return;
            }

            string fingerprint = $"{snapshotLine.LineNumber}:{inlineText}";
            if (fingerprint == this.lastFingerprint)
            {
                return;
            }

            this.lastFingerprint = fingerprint;
            this.layer.RemoveAllAdornments();

            ITextViewLine? viewLine = this.view.TextViewLines.GetTextViewLineContainingBufferPosition(snapshotLine.End);
            if (viewLine == null)
            {
                return;
            }

            var label = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(24, 128, 128, 128)),
                CornerRadius = new System.Windows.CornerRadius(3),
                Padding = new System.Windows.Thickness(5, 0, 5, 0),
                IsHitTestVisible = false,
                Child = new TextBlock
                {
                    Text = inlineText,
                    Foreground = new SolidColorBrush(Color.FromArgb(210, 128, 128, 128)),
                    FontFamily = new FontFamily("Consolas"),
                    FontSize = 12,
                },
            };

            Canvas.SetLeft(label, viewLine.Right + 12);
            Canvas.SetTop(label, viewLine.Top);
            this.layer.AddAdornment(
                AdornmentPositioningBehavior.TextRelative,
                new SnapshotSpan(snapshotLine.End, 0),
                null,
                label,
                null);
        }

        private bool TryGetInlineText(string sourceLine, out string text)
        {
            text = string.Empty;
            try
            {
                if (!(Package.GetGlobalService(typeof(SDTE)) is EnvDTE.DTE dte)
                    || dte.Debugger == null
                    || dte.Debugger.CurrentMode != EnvDTE.dbgDebugMode.dbgBreakMode)
                {
                    return false;
                }

                if (this.view.TextBuffer.Properties.TryGetProperty(typeof(ITextDocument), out ITextDocument? document)
                    && document != null
                    && dte.ActiveDocument != null
                    && !string.Equals(document.FilePath, dte.ActiveDocument.FullName, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }

                EnvDTE.Expressions? locals = dte.Debugger.CurrentStackFrame?.Locals;
                if (locals == null || locals.Count == 0)
                {
                    return false;
                }

                var lineIdentifiers = new HashSet<string>(
                    IdentifierPattern.Matches(sourceLine).Cast<Match>().Select(match => match.Value),
                    StringComparer.OrdinalIgnoreCase);
                var values = new List<string>();
                foreach (EnvDTE.Expression expression in locals)
                {
                    if (!expression.IsValidValue || string.IsNullOrWhiteSpace(expression.Name))
                    {
                        continue;
                    }

                    if (lineIdentifiers.Count > 0 && !lineIdentifiers.Contains(expression.Name))
                    {
                        continue;
                    }

                    string value = (expression.Value ?? string.Empty)
                        .Replace("\r", " ")
                        .Replace("\n", " ");
                    if (value.Length > 48)
                    {
                        value = value.Substring(0, 45) + "...";
                    }

                    values.Add($"{expression.Name} = {value}");
                    if (values.Count >= 12)
                    {
                        break;
                    }
                }

                text = string.Join("    ", values.OrderBy(value => value, StringComparer.OrdinalIgnoreCase));
                return text.Length > 0;
            }
            catch
            {
                // Debugger state can change between COM calls while continuing.
                return false;
            }
        }

        private void Clear()
        {
            if (this.lastFingerprint.Length == 0)
            {
                return;
            }

            this.lastFingerprint = string.Empty;
            this.layer.RemoveAllAdornments();
        }
    }
}
