namespace SmallBasic.Vsix.Editor.NavigationBar
{
    using System;
    using System.ComponentModel.Composition;
    using Microsoft.VisualStudio.Editor;
    using Microsoft.VisualStudio.Text.Editor;
    using Microsoft.VisualStudio.TextManager.Interop;
    using Microsoft.VisualStudio.Utilities;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// Second, independent chance to attach the navigation bar: some builds expose
    /// <see cref="IVsDropdownBarManager"/> directly on the text view adapter, in
    /// which case the language service is not involved at all. Whichever path runs
    /// first wins; the other detects the existing bar and backs off.
    /// </summary>
    [Export(typeof(IVsTextViewCreationListener))]
    [ContentType("smallbasic")]
    [TextViewRole(PredefinedTextViewRoles.Document)]
    internal sealed class SmallBasicNavigationBarAttacher : IVsTextViewCreationListener
    {
        [Import]
        internal SmallBasicCompilationService CompilationService = null!;

        [Import]
        internal IVsEditorAdaptersFactoryService AdaptersFactory = null!;

        public void VsTextViewCreated(IVsTextView textViewAdapter)
        {
            try
            {
                var manager = textViewAdapter as IVsDropdownBarManager;
                SmallBasicDiagnostics.Write($"[text view] IVsDropdownBarManager={(manager != null ? "yes" : "no")}");
                if (manager == null)
                {
                    return;
                }

                IWpfTextView? view = this.AdaptersFactory.GetWpfTextView(textViewAdapter);
                SmallBasicNavigationBarAttachment.TryAttach(manager, view, this.CompilationService, "text view");
            }
            catch (Exception ex)
            {
                SmallBasicDiagnostics.Write("[text view] attach failed: " + ex.Message);
            }
        }
    }
}
