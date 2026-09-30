namespace SmallBasic.Vsix.Editor.NavigationBar
{
    using System;
    using System.Runtime.InteropServices;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.ComponentModelHost;
    using Microsoft.VisualStudio.Editor;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
    using Microsoft.VisualStudio.Text.Editor;
    using Microsoft.VisualStudio.TextManager.Interop;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// Attaches the SmallBasic navigation bar to a code window and keeps it in
    /// sync with the caret, mirroring the C# / TypeScript editor experience.
    /// </summary>
    [ComVisible(true)]
    public sealed class SmallBasicCodeWindowManager : IVsCodeWindowManager
    {
        private readonly IVsCodeWindow codeWindow;

        public SmallBasicCodeWindowManager(IVsCodeWindow codeWindow)
        {
            this.codeWindow = codeWindow;
        }

        public int AddAdornments()
        {
            try
            {
                SmallBasicDiagnostics.Write("[language service] AddAdornments called");

                var manager = this.codeWindow as IVsDropdownBarManager;
                var componentModel = Package.GetGlobalService(typeof(SComponentModel)) as IComponentModel;
                SmallBasicCompilationService compilationService = componentModel?.GetService<SmallBasicCompilationService>();
                IVsEditorAdaptersFactoryService adapters = componentModel?.GetService<IVsEditorAdaptersFactoryService>();

                IWpfTextView view = null;
                if (adapters != null
                    && this.codeWindow != null
                    && this.codeWindow.GetLastActiveView(out IVsTextView vsView) == VSConstants.S_OK
                    && vsView != null)
                {
                    view = adapters.GetWpfTextView(vsView);
                }

                SmallBasicNavigationBarAttachment.TryAttach(manager, view, compilationService, "language service");
            }
            catch (Exception ex)
            {
                SmallBasicDiagnostics.Write("[language service] AddAdornments failed: " + ex.Message);
            }

            return VSConstants.S_OK;
        }

        public int RemoveAdornments()
        {
            return VSConstants.S_OK;
        }

        public int OnNewView(IVsTextView pView)
        {
            return VSConstants.S_OK;
        }
    }
}
