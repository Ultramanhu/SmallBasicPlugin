namespace SmallBasic.Vsix.Editor.Breadcrumb
{
    using System.ComponentModel.Composition;
    using Microsoft.VisualStudio.Text.Classification;
    using Microsoft.VisualStudio.Text.Editor;
    using Microsoft.VisualStudio.Utilities;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// Adds the SmallBasic breadcrumb bar above the text view.
    /// </summary>
    /// <remarks>
    /// Visual Studio exposes <see cref="PredefinedMarginNames.Top"/> ("the margin
    /// above the text view") as a first class editor extension point — the same
    /// mechanism the built-in Sticky Scroll margin uses. The bar renders
    /// <c>file path › scope › variable</c> for the caret position, mirroring the
    /// VS Code breadcrumb, and navigates when a segment is clicked.
    /// </remarks>
    // ---------------------------------------------------------------
    // DISABLED (2026-09-28): the outline / breadcrumb surfaces are switched
    // off because the integration could not be validated inside Visual Studio
    // (the breadcrumb bar did not show up above the text view and the native
    // navigation bar cannot be reached). The implementation is kept as-is.
    //
    // To re-enable the breadcrumb bar, uncomment the [Export] line below.
    // ---------------------------------------------------------------
    // [Export(typeof(IWpfTextViewMarginProvider))]
    [Name(SmallBasicBreadcrumbMargin.MarginName)]
    [ContentType("smallbasic")]
    [MarginContainer(PredefinedMarginNames.Top)]
    [TextViewRole(PredefinedTextViewRoles.Document)]
    internal sealed class SmallBasicBreadcrumbMarginProvider : IWpfTextViewMarginProvider
    {
        [Import]
        internal SmallBasicCompilationService CompilationService = null!;

        [Import]
        internal IEditorFormatMapService EditorFormatMapService = null!;

        public IWpfTextViewMargin CreateMargin(IWpfTextViewHost textViewHost, IWpfTextViewMargin containerMargin)
        {
            SmallBasicDiagnostics.Write("[breadcrumb] margin created");
            return new SmallBasicBreadcrumbMargin(textViewHost.TextView, this.CompilationService, this.EditorFormatMapService);
        }
    }
}
