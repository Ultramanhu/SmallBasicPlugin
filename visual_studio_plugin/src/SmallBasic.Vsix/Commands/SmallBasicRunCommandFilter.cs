namespace SmallBasic.Vsix.Commands
{
    using System;
    using System.ComponentModel.Composition;
    using System.IO;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.Editor;
    using Microsoft.VisualStudio.OLE.Interop;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Editor;
    using Microsoft.VisualStudio.TextManager.Interop;
    using Microsoft.VisualStudio.Utilities;

    /// <summary>
    /// Installs a command filter on every Small Basic text view so that Ctrl+F5,
    /// plus classic solution-mode F5 / F10 / F11, run the active .sb file. Open
    /// Folder debugging must flow to the workspace launch pipeline so the chosen
    /// .vscode/launch.json profile can select the backend.
    /// </summary>
    [Export(typeof(ITextViewCreationListener))]
    [Name("SmallBasic Run Command Filter")]
    [ContentType("smallbasic")]
    [TextViewRole(PredefinedTextViewRoles.Document)]
    internal sealed class SmallBasicRunCommandFilterInstaller : ITextViewCreationListener
    {
        [Import]
        internal IVsEditorAdaptersFactoryService EditorAdaptersFactoryService = null!;

        public void TextViewCreated(ITextView textView)
        {
            RememberDocumentIfAvailable(textView);

            EventHandler gotAggregateFocus = (_, _) => RememberDocumentIfAvailable(textView);
            textView.GotAggregateFocus += gotAggregateFocus;
            textView.Closed += (_, _) => textView.GotAggregateFocus -= gotAggregateFocus;

            IVsTextView? viewAdapter = this.EditorAdaptersFactoryService.GetViewAdapter(textView);
            if (viewAdapter != null)
            {
                var filter = new SmallBasicRunCommandFilter(textView);
                viewAdapter.AddCommandFilter(filter, out IOleCommandTarget? next);
                filter.SetNext(next);
            }
        }

        private static void RememberDocumentIfAvailable(ITextView textView)
        {
            if (textView.TextBuffer.Properties.TryGetProperty(typeof(ITextDocument), out ITextDocument document)
                && document != null
                && !string.IsNullOrWhiteSpace(document.FilePath))
            {
                SmallBasicCommandService.RememberSmallBasicDocument(document.FilePath);
            }
        }
    }

    internal sealed class SmallBasicRunCommandFilter : IOleCommandTarget
    {
        private readonly ITextView textView;
        private IOleCommandTarget? next;

        public SmallBasicRunCommandFilter(ITextView textView)
        {
            this.textView = textView;
        }

        internal void SetNext(IOleCommandTarget? nextTarget)
        {
            this.next = nextTarget;
        }

        public int QueryStatus(ref Guid pguidCmdGroup, uint cCmds, OLECMD[] prgCmds, IntPtr pCmdText)
        {
            bool isOpenFolderWorkspace = IsOpenFolderWorkspace();
            int result = this.ForwardQueryStatus(ref pguidCmdGroup, cCmds, prgCmds, pCmdText);
            if (pguidCmdGroup == VSConstants.GUID_VSStandardCommandSet97
                && !this.IsDebuggerActive()
                && this.TryGetSmallBasicDocument(out _))
            {
                bool handledAny = false;
                for (int i = 0; i < prgCmds.Length; i++)
                {
                    if (!ShouldHandleCommand(prgCmds[i].cmdID, isOpenFolderWorkspace))
                    {
                        continue;
                    }

                    prgCmds[i].cmdf = (uint)(OLECMDF.OLECMDF_SUPPORTED | OLECMDF.OLECMDF_ENABLED);
                    handledAny = true;
                }

                if (handledAny)
                {
                    return VSConstants.S_OK;
                }
            }

            return result;
        }

        public int Exec(ref Guid pguidCmdGroup, uint nCmdID, uint nCmdexecopt, IntPtr pvaIn, IntPtr pvaOut)
        {
            // While a debug session is active (break/run mode), every debug key
            // (F5 continue, F10/F11 stepping, Shift+F5 stop) must reach the Debug
            // Adapter Host. Claiming them here would launch a second session.
            bool isOpenFolderWorkspace = IsOpenFolderWorkspace();
            if (pguidCmdGroup == VSConstants.GUID_VSStandardCommandSet97
                && !this.IsDebuggerActive()
                && this.TryGetSmallBasicDocument(out ITextDocument? document))
            {
                Services.SmallBasicDiagnostics.Write($"[command filter] exec cmdId={nCmdID} openFolder={isOpenFolderWorkspace}");

                // In Open Folder mode F5/F10/F11 must stay with Visual Studio's
                // workspace launch pipeline so the selected .vscode/launch.json
                // profile decides whether C#, JavaScript or Blazor is used.
                // Ctrl+F5 remains local and reuses the current backend.
                if (!ShouldHandleCommand(nCmdID, isOpenFolderWorkspace))
                {
                    return this.ForwardExec(ref pguidCmdGroup, nCmdID, nCmdexecopt, pvaIn, pvaOut);
                }

                if (nCmdID == (uint)VSConstants.VSStd97CmdID.Start)
                {
                    this.Debug(document!, stopOnEntry: false);
                    return VSConstants.S_OK;
                }

                if (nCmdID == (uint)VSConstants.VSStd97CmdID.StartNoDebug)
                {
                    this.Run(document!);
                    return VSConstants.S_OK;
                }

                // Design-time F10/F11: mirror Visual Studio's "step into a new
                // instance" semantics by launching with stopOnEntry.
                if (nCmdID == (uint)VSConstants.VSStd97CmdID.StepInto
                    || nCmdID == (uint)VSConstants.VSStd97CmdID.StepOver)
                {
                    this.Debug(document!, stopOnEntry: true);
                    return VSConstants.S_OK;
                }
            }

            return this.ForwardExec(ref pguidCmdGroup, nCmdID, nCmdexecopt, pvaIn, pvaOut);
        }

        private int ForwardExec(ref Guid pguidCmdGroup, uint nCmdID, uint nCmdexecopt, IntPtr pvaIn, IntPtr pvaOut)
        {
            if (this.next != null)
            {
                return this.next.Exec(ref pguidCmdGroup, nCmdID, nCmdexecopt, pvaIn, pvaOut);
            }

            return (int)Microsoft.VisualStudio.OLE.Interop.Constants.OLECMDERR_E_NOTSUPPORTED;
        }

        private int ForwardQueryStatus(ref Guid pguidCmdGroup, uint cCmds, OLECMD[] prgCmds, IntPtr pCmdText)
        {
            if (this.next != null)
            {
                return this.next.QueryStatus(ref pguidCmdGroup, cCmds, prgCmds, pCmdText);
            }

            return (int)Microsoft.VisualStudio.OLE.Interop.Constants.OLECMDERR_E_NOTSUPPORTED;
        }

        private static bool ShouldHandleCommand(uint commandId, bool isOpenFolderWorkspace)
        {
            if (commandId == (uint)VSConstants.VSStd97CmdID.StartNoDebug)
            {
                return true;
            }

            return !isOpenFolderWorkspace
                && (commandId == (uint)VSConstants.VSStd97CmdID.Start
                    || commandId == (uint)VSConstants.VSStd97CmdID.StepInto
                    || commandId == (uint)VSConstants.VSStd97CmdID.StepOver);
        }

        private bool IsDebuggerActive()
        {
            try
            {
                if (Package.GetGlobalService(typeof(SDTE)) is EnvDTE.DTE dte && dte.Debugger != null)
                {
                    return dte.Debugger.CurrentMode != EnvDTE.dbgDebugMode.dbgDesignMode;
                }
            }
            catch
            {
                // DTE not available yet (early startup): assume design mode.
            }

            return false;
        }

        private static bool IsOpenFolderWorkspace()
        {
            try
            {
                // In Open Folder mode the "solution file" is the folder itself
                // (or empty); a real .sln/.slnx keeps the classic behavior where
                // this filter owns F5/F10/F11 for .sb files.
                if (Package.GetGlobalService(typeof(SVsSolution)) is IVsSolution solution
                    && solution.GetSolutionInfo(out string directory, out string solutionFile, out _) == VSConstants.S_OK)
                {
                    return !string.IsNullOrEmpty(directory)
                        && (string.IsNullOrEmpty(solutionFile)
                            || Directory.Exists(solutionFile)
                            || string.Equals(solutionFile.TrimEnd('\\'), directory.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase));
                }
            }
            catch
            {
                // Solution service unavailable (early startup): classic behavior.
            }

            return false;
        }

        private bool TryGetSmallBasicDocument(out ITextDocument? document)
        {
            document = null;
            ITextBuffer buffer = this.textView.TextBuffer;
            if (!buffer.ContentType.IsOfType("smallbasic"))
            {
                return false;
            }

            if (buffer.Properties.TryGetProperty(typeof(ITextDocument), out document)
                && document != null
                && !string.IsNullOrEmpty(document.FilePath))
            {
                SmallBasicCommandService.RememberSmallBasicDocument(document.FilePath);
                return true;
            }

            return false;
        }

        private void Run(ITextDocument document)
        {
            document.Save();
            SmallBasicCommandService.Run(document.FilePath, SmallBasicCommandService.SelectedBackend);
        }

        private void Debug(ITextDocument document, bool stopOnEntry)
        {
            document.Save();
            SmallBasicCommandService.Debug(
                document.FilePath,
                SmallBasicCommandService.SelectedBackend,
                stopOnEntry);
        }
    }
}
