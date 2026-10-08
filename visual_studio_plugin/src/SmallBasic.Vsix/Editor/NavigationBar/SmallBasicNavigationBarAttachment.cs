namespace SmallBasic.Vsix.Editor.NavigationBar
{
    using System;
    using System.Collections.Generic;
    using System.Runtime.InteropServices;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Editor;
    using Microsoft.VisualStudio.TextManager.Interop;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// Owns one attached navigation bar: it keeps the client referenced, follows
    /// the caret/text buffer and drives the combo refresh.
    /// </summary>
    internal sealed class SmallBasicNavigationBarAttachment : IDisposable
    {
        private static readonly object ActiveAttachmentsGate = new object();
        private static readonly Dictionary<long, SmallBasicNavigationBarAttachment> ActiveAttachments =
            new Dictionary<long, SmallBasicNavigationBarAttachment>();

        private readonly SmallBasicNavigationBarClient client;
        private readonly IWpfTextView textView;
        private readonly IVsDropdownBar? dropdownBar;
        private readonly long dropdownBarKey;
        private bool isDisposed;

        private SmallBasicNavigationBarAttachment(
            SmallBasicNavigationBarClient client,
            IWpfTextView textView,
            IVsDropdownBar? dropdownBar)
        {
            this.client = client;
            this.textView = textView;
            this.dropdownBar = dropdownBar;
            this.dropdownBarKey = dropdownBar != null ? GetComIdentityKey(dropdownBar) : 0;
        }

        /// <summary>
        /// Attaches the SmallBasic outline as the navigation bar of a code window.
        /// Returns false (and logs why) when the bar is unavailable.
        /// </summary>
        public static bool TryAttach(
            IVsDropdownBarManager? manager,
            IWpfTextView? textView,
            SmallBasicCompilationService? compilationService,
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
                    if (TryGetTrackedAttachment(existing, out SmallBasicNavigationBarAttachment trackedAttachment)
                        && trackedAttachment.Owns(textView))
                    {
                        trackedAttachment.RefreshSelections();
                        SmallBasicDiagnostics.Write($"[{source}] navigation bar already attached to this view");
                        return true;
                    }

                    if (TryUntrackAttachment(existing, out trackedAttachment))
                    {
                        trackedAttachment.Dispose();
                    }

                    int removeHr = manager.RemoveDropdownBar();
                    SmallBasicDiagnostics.Write($"[{source}] removed previous navigation bar hr=0x{removeHr:X8}");
                }

                var client = new SmallBasicNavigationBarClient(compilationService, textView);
                int hr = manager.AddDropdownBar(SmallBasicNavigationBarClient.ComboCount, client);
                if (hr != VSConstants.S_OK)
                {
                    SmallBasicDiagnostics.Write($"[{source}] AddDropdownBar failed 0x{hr:X8}");
                    return false;
                }

                IVsDropdownBar? dropdownBar = null;
                int getHr = manager.GetDropdownBar(out IVsDropdownBar? bar);
                if (getHr != VSConstants.S_OK)
                {
                    bar = null;
                }

                dropdownBar = bar;
                SmallBasicDiagnostics.Write(
                    $"[{source}] GetDropdownBar -> hr=0x{getHr:X8}, bar={(bar == null ? "null" : "ok")}");
                var attachment = new SmallBasicNavigationBarAttachment(client, textView, dropdownBar);
                attachment.Track();
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

        public static void TryDetach(IVsDropdownBarManager? manager, string source)
        {
            try
            {
                if (manager == null)
                {
                    return;
                }

                if (manager.GetDropdownBar(out IVsDropdownBar existing) != VSConstants.S_OK || existing == null)
                {
                    return;
                }

                if (TryUntrackAttachment(existing, out SmallBasicNavigationBarAttachment trackedAttachment))
                {
                    trackedAttachment.Dispose();
                }

                int hr = manager.RemoveDropdownBar();
                SmallBasicDiagnostics.Write($"[{source}] RemoveDropdownBar -> hr=0x{hr:X8}");
            }
            catch (Exception ex)
            {
                SmallBasicDiagnostics.Write($"[{source}] detach failed: {ex.GetType().Name}: {ex.Message}");
            }
        }

        private static long GetComIdentityKey(object comObject)
        {
            IntPtr unknown = Marshal.GetIUnknownForObject(comObject);
            try
            {
                return unknown.ToInt64();
            }
            finally
            {
                Marshal.Release(unknown);
            }
        }

        private static bool TryGetTrackedAttachment(
            IVsDropdownBar dropdownBar,
            out SmallBasicNavigationBarAttachment attachment)
        {
            lock (ActiveAttachmentsGate)
            {
                return ActiveAttachments.TryGetValue(GetComIdentityKey(dropdownBar), out attachment);
            }
        }

        private static bool TryUntrackAttachment(
            IVsDropdownBar dropdownBar,
            out SmallBasicNavigationBarAttachment attachment)
        {
            lock (ActiveAttachmentsGate)
            {
                long key = GetComIdentityKey(dropdownBar);
                if (!ActiveAttachments.TryGetValue(key, out attachment))
                {
                    return false;
                }

                ActiveAttachments.Remove(key);
                return true;
            }
        }

        private void Track()
        {
            if (this.dropdownBarKey == 0)
            {
                return;
            }

            lock (ActiveAttachmentsGate)
            {
                ActiveAttachments[this.dropdownBarKey] = this;
            }
        }

        private void Untrack()
        {
            if (this.dropdownBarKey == 0)
            {
                return;
            }

            lock (ActiveAttachmentsGate)
            {
                if (ActiveAttachments.TryGetValue(this.dropdownBarKey, out SmallBasicNavigationBarAttachment existing)
                    && ReferenceEquals(existing, this))
                {
                    ActiveAttachments.Remove(this.dropdownBarKey);
                }
            }
        }

        private void Subscribe()
        {
            this.textView.Caret.PositionChanged += this.OnCaretPositionChanged;
            this.textView.TextBuffer.Changed += this.OnTextBufferChanged;
            this.textView.Closed += this.OnTextViewClosed;
        }

        private void Dispose(bool disposing)
        {
            if (this.isDisposed)
            {
                return;
            }

            this.isDisposed = true;
            if (!disposing)
            {
                return;
            }

            this.textView.Caret.PositionChanged -= this.OnCaretPositionChanged;
            this.textView.TextBuffer.Changed -= this.OnTextBufferChanged;
            this.textView.Closed -= this.OnTextViewClosed;
            this.Untrack();
        }

        private bool Owns(IWpfTextView view)
        {
            return ReferenceEquals(this.textView, view);
        }

        private void OnCaretPositionChanged(object sender, CaretPositionChangedEventArgs e)
        {
            this.RefreshSelections();
        }

        private void OnTextBufferChanged(object sender, TextContentChangedEventArgs e)
        {
            this.RefreshSelections();
        }

        private void OnTextViewClosed(object sender, EventArgs e)
        {
            this.Dispose();
        }

        private void RefreshSelections()
        {
            try
            {
                if (this.isDisposed)
                {
                    return;
                }

                if (this.dropdownBar == null)
                {
                    return;
                }

                // RefreshCombo re-queries the client (entry counts + text) and moves
                // the selection, which is how the bar tracks the caret.
                int scopeIndex = this.client.GetScopeIndexAtCaret();
                this.client.SetSelectedScopeIndex(scopeIndex);
                this.dropdownBar.RefreshCombo(0, scopeIndex);
                this.dropdownBar.RefreshCombo(1, this.client.GetMemberIndexAtCaret(scopeIndex));
            }
            catch (Exception ex)
            {
                SmallBasicDiagnostics.Write("refresh failed: " + ex.Message);
            }
        }

        public void Dispose()
        {
            this.Dispose(true);
            GC.SuppressFinalize(this);
        }
    }
}
