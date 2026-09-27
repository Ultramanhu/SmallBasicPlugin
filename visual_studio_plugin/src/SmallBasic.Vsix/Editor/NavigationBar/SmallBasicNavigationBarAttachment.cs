namespace SmallBasic.Vsix.Editor.NavigationBar
{
    using System;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Editor;
    using Microsoft.VisualStudio.TextManager.Interop;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// Owns one attached navigation bar: it keeps the client referenced, follows
    /// the caret/text buffer and drives the combo refresh.
    /// </summary>
    internal sealed class SmallBasicNavigationBarAttachment
    {
        private readonly SmallBasicNavigationBarClient client;
        private readonly IWpfTextView textView;
        private readonly IVsDropdownBar dropdownBar;

        private SmallBasicNavigationBarAttachment(
            SmallBasicNavigationBarClient client,
            IWpfTextView textView,
            IVsDropdownBar dropdownBar)
        {
            this.client = client;
            this.textView = textView;
            this.dropdownBar = dropdownBar;
        }

        /// <summary>
        /// Attaches the SmallBasic outline as the navigation bar of a code window.
        /// Returns false (and logs why) when the bar is unavailable or taken.
        /// </summary>
        public static bool TryAttach(
            IVsDropdownBarManager manager,
            IWpfTextView textView,
            SmallBasicCompilationService compilationService,
            string source)
        {
            try
            {
                if (manager == null)
                {
                    SmallBasicDiagnostics.Write($"[{source}] IVsDropdownBarManager unavailable");
                    return false;
                }

                if (textView == null)
                {
                    SmallBasicDiagnostics.Write($"[{source}] IWpfTextView unavailable");
                    return false;
                }

                if (compilationService == null)
                {
                    SmallBasicDiagnostics.Write($"[{source}] SmallBasicCompilationService unavailable");
                    return false;
                }

                if (manager.GetDropdownBar(out IVsDropdownBar existing) == VSConstants.S_OK && existing != null)
                {
                    SmallBasicDiagnostics.Write($"[{source}] navigation bar already attached");
                    return false;
                }

                var client = new SmallBasicNavigationBarClient(compilationService, textView);
                int hr = manager.AddDropdownBar(SmallBasicNavigationBarClient.ComboCount, client);
                if (hr != VSConstants.S_OK)
                {
                    SmallBasicDiagnostics.Write($"[{source}] AddDropdownBar failed 0x{hr:X8}");
                    return false;
                }

                IVsDropdownBar dropdownBar = null;
                if (manager.GetDropdownBar(out IVsDropdownBar bar) != VSConstants.S_OK)
                {
                    bar = null;
                }

                dropdownBar = bar;
                var attachment = new SmallBasicNavigationBarAttachment(client, textView, dropdownBar);
                attachment.Subscribe();
                attachment.RefreshSelections();
                client.Prime();
                SmallBasicDiagnostics.Write($"[{source}] navigation bar attached ({client.EntrySummary})");
                return true;
            }
            catch (Exception ex)
            {
                SmallBasicDiagnostics.Write($"[{source}] attach failed: {ex.GetType().Name}: {ex.Message}");
                return false;
            }
        }

        private void Subscribe()
        {
            this.textView.Caret.PositionChanged += this.OnCaretPositionChanged;
            this.textView.TextBuffer.Changed += this.OnTextBufferChanged;
        }

        private void OnCaretPositionChanged(object sender, CaretPositionChangedEventArgs e)
        {
            this.RefreshSelections();
        }

        private void OnTextBufferChanged(object sender, TextContentChangedEventArgs e)
        {
            this.RefreshSelections();
        }

        private void RefreshSelections()
        {
            try
            {
                if (this.dropdownBar == null)
                {
                    return;
                }

                // RefreshCombo re-queries the client (entry counts + text) and moves
                // the selection, which is how the bar tracks the caret.
                this.dropdownBar.RefreshCombo(0, this.client.GetScopeIndexAtCaret());
                this.dropdownBar.RefreshCombo(1, this.client.GetMemberIndexAtCaret());
            }
            catch (Exception ex)
            {
                SmallBasicDiagnostics.Write("refresh failed: " + ex.Message);
            }
        }
    }
}
