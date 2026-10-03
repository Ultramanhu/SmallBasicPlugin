namespace SmallBasic.Vsix.Editor.NavigationBar
{
    using System;
    using System.Collections.Generic;
    using System.Runtime.InteropServices;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Editor;
    using Microsoft.VisualStudio.TextManager.Interop;
    using SmallBasic.Compiler.Scanning;
    using SmallBasic.Compiler.Services;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// Feeds the editor's native navigation bar with the SmallBasic document
    /// outline, exactly like the C# and TypeScript editors do:
    /// combo 0 lists the main program plus every procedure, combo 1 lists the
    /// variables that are first used in the selected scope.
    /// </summary>
    [ComVisible(true)]
    public sealed class SmallBasicNavigationBarClient : IVsDropdownBarClient, IVsDropdownBarClient3
    {
        public const int ComboCount = 2;

        private const string MainProgramName = "<主程序>";

        private readonly SmallBasicCompilationService compilationService;
        private readonly IWpfTextView textView;
        private IVsDropdownBar dropdownBar;
        private int cachedVersionNumber = -1;
        private List<OutlineItem> procedures = new List<OutlineItem>();
        private List<OutlineItem> mainVariables = new List<OutlineItem>();
        private List<OutlineItem> currentMembers;
        private string lastLoggedSummary;

        internal SmallBasicNavigationBarClient(SmallBasicCompilationService compilationService, IWpfTextView textView)
        {
            this.compilationService = compilationService;
            this.textView = textView;
        }

        /// <summary>Index of the combo 0 entry that contains the caret, or 0 for the main program.</summary>
        public int GetScopeIndexAtCaret()
        {
            try
            {
                this.EnsureItems();
                (int line, int column) = this.GetCaretPosition();
                for (var index = 0; index < this.procedures.Count; index++)
                {
                    if (Contains(this.procedures[index].Range, line, column))
                    {
                        return index + 1;
                    }
                }
            }
            catch (Exception)
            {
            }

            return 0;
        }

        /// <summary>Index of the combo 1 entry under the caret, or -1 when there is none.</summary>
        public int GetMemberIndexAtCaret()
        {
            try
            {
                this.EnsureItems();
                (int line, int column) = this.GetCaretPosition();
                List<OutlineItem> members = this.GetCurrentMembers();
                for (var index = 0; index < members.Count; index++)
                {
                    if (Contains(members[index].Range, line, column))
                    {
                        return index;
                    }
                }
            }
            catch (Exception)
            {
            }

            return -1;
        }

        public int SetDropdownBar(IVsDropdownBar pDropdownBar)
        {
            this.dropdownBar = pDropdownBar;
            return VSConstants.S_OK;
        }

        public int GetComboAttributes(int iCombo, out uint pcEntries, out uint puEntryType, out IntPtr phImageList)
        {
            puEntryType = (uint)(DROPDOWNENTRYTYPE.ENTRY_TEXT | DROPDOWNENTRYTYPE.ENTRY_ATTR);
            phImageList = IntPtr.Zero;
            pcEntries = 0;

            try
            {
                this.EnsureItems();
                if (iCombo == 0)
                {
                    pcEntries = (uint)(1 + this.procedures.Count);
                    return VSConstants.S_OK;
                }

                if (iCombo == 1)
                {
                    // The member combo always mirrors the currently selected scope.
                    this.currentMembers = null;
                    pcEntries = (uint)this.GetCurrentMembers().Count;
                    return VSConstants.S_OK;
                }
            }
            catch (Exception)
            {
            }

            return VSConstants.E_INVALIDARG;
        }

        public int GetEntryText(int iCombo, int iIndex, out string ppszText)
        {
            ppszText = string.Empty;

            try
            {
                this.EnsureItems();
                if (iCombo == 0)
                {
                    if (iIndex <= 0)
                    {
                        ppszText = MainProgramName;
                        return VSConstants.S_OK;
                    }

                    OutlineItem procedure = this.GetProcedureAt(iIndex);
                    if (procedure != null)
                    {
                        ppszText = procedure.Detail;
                        return VSConstants.S_OK;
                    }
                }
                else if (iCombo == 1)
                {
                    List<OutlineItem> members = this.GetCurrentMembers();
                    if (iIndex >= 0 && iIndex < members.Count)
                    {
                        ppszText = members[iIndex].Name;
                        return VSConstants.S_OK;
                    }
                }
            }
            catch (Exception)
            {
            }

            return VSConstants.E_INVALIDARG;
        }

        public int GetEntryAttributes(int iCombo, int iIndex, out uint pAttr)
        {
            pAttr = (uint)DROPDOWNFONTATTR.FONTATTR_PLAIN;
            return VSConstants.S_OK;
        }

        public int GetEntryImage(int iCombo, int iIndex, out int piImageIndex)
        {
            piImageIndex = -1;
            return VSConstants.E_NOTIMPL;
        }

        public int GetComboTipText(int iCombo, out string pbstrText)
        {
            pbstrText = iCombo == 0 ? "Small Basic 过程" : "当前作用域中首次使用的变量";
            return VSConstants.S_OK;
        }

        public int OnItemSelected(int iCombo, int iIndex)
        {
            return VSConstants.S_OK;
        }

        public int OnComboGetFocus(int iCombo)
        {
            return VSConstants.S_OK;
        }

        public int OnItemChosen(int iCombo, int iIndex)
        {
            try
            {
                this.EnsureItems();
                if (iCombo == 0)
                {
                    this.currentMembers = null;
                    this.dropdownBar?.RefreshCombo(1, 0);

                    OutlineItem procedure = this.GetProcedureAt(iIndex);
                    if (procedure != null)
                    {
                        this.Navigate(procedure.SelectionRange.Start.Line, procedure.SelectionRange.Start.Column);
                    }
                    else
                    {
                        this.Navigate(0, 0);
                    }
                }
                else if (iCombo == 1)
                {
                    List<OutlineItem> members = this.GetCurrentMembers();
                    if (iIndex >= 0 && iIndex < members.Count)
                    {
                        this.Navigate(members[iIndex].SelectionRange.Start.Line, members[iIndex].SelectionRange.Start.Column);
                    }
                }
            }
            catch (Exception)
            {
            }

            return VSConstants.S_OK;
        }

        public int GetComboWidth(int iCombo, out int piWidthPercent)
        {
            piWidthPercent = iCombo == 0 ? 45 : 55;
            return VSConstants.S_OK;
        }

        public int GetAutomationProperties(int iCombo, out string pbstrName, out string pbstrId)
        {
            pbstrName = iCombo == 0 ? "SmallBasic 过程" : "SmallBasic 变量";
            pbstrId = iCombo == 0 ? "SmallBasicProcedures" : "SmallBasicVariables";
            return VSConstants.S_OK;
        }

        public int GetEntryImage(int iCombo, int iIndex, out int piImageIndex, out IntPtr phImageList)
        {
            piImageIndex = -1;
            phImageList = IntPtr.Zero;
            return VSConstants.E_NOTIMPL;
        }

        private static bool Contains(TextRange range, int line, int column)
        {
            return Compare(range.Start, line, column) <= 0 && Compare(range.End, line, column) >= 0;
        }

        private static int Compare(TextPosition position, int line, int column)
        {
            return position.Line != line ? position.Line - line : position.Column - column;
        }

        private void EnsureItems()
        {
            int versionNumber = this.textView.TextBuffer.CurrentSnapshot.Version.VersionNumber;
            if (this.cachedVersionNumber == versionNumber)
            {
                return;
            }

            var procedures = new List<OutlineItem>();
            var mainVariables = new List<OutlineItem>();
            try
            {
                foreach (OutlineItem item in this.compilationService.GetCompilation(this.textView.TextBuffer).GetOutlineItems())
                {
                    if (item.Kind == OutlineItemKind.Procedure || item.Kind == OutlineItemKind.Function)
                    {
                        procedures.Add(item);
                    }
                    else
                    {
                        mainVariables.Add(item);
                    }
                }
            }
            catch (Exception ex)
            {
                SmallBasicDiagnostics.Write("outline failed: " + ex);
            }

            this.procedures = procedures;
            this.mainVariables = mainVariables;
            this.currentMembers = null;
            this.cachedVersionNumber = versionNumber;

            string summary = this.EntrySummary;
            if (!string.Equals(summary, this.lastLoggedSummary, StringComparison.Ordinal))
            {
                this.lastLoggedSummary = summary;
                SmallBasicDiagnostics.Write("outline: " + summary);
            }
        }

        /// <summary>Reads the outline immediately (used for diagnostics).</summary>
        public void Prime()
        {
            this.EnsureItems();
        }

        /// <summary>Diagnostic summary of what the navigation bar currently offers.</summary>
        public string EntrySummary => $"procedures={this.procedures.Count}, variables={this.mainVariables.Count}";

        private OutlineItem GetProcedureAt(int scopeIndex)
        {
            return scopeIndex >= 1 && scopeIndex - 1 < this.procedures.Count ? this.procedures[scopeIndex - 1] : null;
        }

        private List<OutlineItem> GetCurrentMembers()
        {
            if (this.currentMembers != null)
            {
                return this.currentMembers;
            }

            int scopeIndex = 0;
            try
            {
                if (this.dropdownBar != null && this.dropdownBar.GetCurrentSelection(0, out int selection) == VSConstants.S_OK && selection >= 0)
                {
                    scopeIndex = selection;
                }
            }
            catch (Exception)
            {
            }

            OutlineItem procedure = this.GetProcedureAt(scopeIndex);
            this.currentMembers = procedure != null
                ? new List<OutlineItem>(procedure.Children)
                : new List<OutlineItem>(this.mainVariables);
            return this.currentMembers;
        }

        private (int Line, int Column) GetCaretPosition()
        {
            SnapshotPoint caret = this.textView.Caret.Position.BufferPosition;
            ITextSnapshotLine line = caret.GetContainingLine();
            return (line.LineNumber, caret.Position - line.Start.Position);
        }

        private void Navigate(int line, int column)
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
    }
}
