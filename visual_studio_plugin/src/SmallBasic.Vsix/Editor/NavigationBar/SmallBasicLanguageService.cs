namespace SmallBasic.Vsix.Editor.NavigationBar
{
    using System;
    using System.Runtime.InteropServices;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.TextManager.Interop;

    /// <summary>
    /// Minimal legacy language service. Its only purpose is to be handed the
    /// <c>IVsCodeWindow</c> so the extension can attach the editor's native
    /// navigation bar (<c>IVsDropdownBar</c>), which is the same surface the C#
    /// and TypeScript editors use.
    /// </summary>
    /// <remarks>
    /// No colorizer and no editor factory are provided, so the modern MEF based
    /// editor and its classification/completion features stay in charge.
    /// </remarks>
    [Guid(LanguageServiceGuidString)]
    [ComVisible(true)]
    public sealed class SmallBasicLanguageService : IVsLanguageInfo
    {
        public const string LanguageServiceGuidString = "8F2B7C41-6D9A-4E3B-9C55-1A2D3E4F5A60";

        public int GetLanguageName(out string bstrName)
        {
            bstrName = "SmallBasic";
            return VSConstants.S_OK;
        }

        public int GetFileExtensions(out string pbstrExtensions)
        {
            pbstrExtensions = ".sb";
            return VSConstants.S_OK;
        }

        public int GetColorizer(IVsTextLines pBuffer, out IVsColorizer ppColorizer)
        {
            // The modern editor colors the document through its MEF classifier.
            ppColorizer = null;
            return VSConstants.E_NOTIMPL;
        }

        public int GetCodeWindowManager(IVsCodeWindow pCodeWin, out IVsCodeWindowManager ppCodeWinMgr)
        {
            Services.SmallBasicDiagnostics.Write("[language service] GetCodeWindowManager called");
            ppCodeWinMgr = pCodeWin != null ? new SmallBasicCodeWindowManager(pCodeWin) : null;
            return VSConstants.S_OK;
        }
    }
}
