namespace SmallBasic.Vsix.Editor.NavigationBar
{
    using System;
    using System.Collections.Generic;
    using System.Globalization;
    using System.Runtime.InteropServices;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.Imaging.Interop;
    using Microsoft.VisualStudio.PlatformUI;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
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
    /// <remarks>
    /// Supplies a real image list to both dropdown image callbacks. Some editor
    /// hosts query IVsDropdownBarClient3 rather than the image-moniker interface.
    /// </remarks>
    [ComVisible(true)]
    public sealed class SmallBasicNavigationBarClient : IVsDropdownBarClient, IVsDropdownBarClient3
    {
        public const int ComboCount = 2;

        private const string MainProgramName = "<主程序>";
        private const int MainProgramImageIndex = 0;
        private const int ProcedureImageIndex = 1;
        private const int VariableImageIndex = 2;

        private static readonly ImageMoniker NavigationIcons = new ImageMoniker
        {
            Guid = new Guid("57c89fbb-6dd2-49b1-ad07-e02f072f65b9"),
            Id = 2,
        };

        private readonly SmallBasicCompilationService compilationService;
        private readonly IWpfTextView textView;
        private IVsDropdownBar dropdownBar;
        // The image service owns the HIMAGELIST. Keep its wrapper alive for as
        // long as the dropdown can use the handle; never destroy it ourselves.
        private IVsUIObject? imageListObject;
        private IntPtr imageListHandle;
        private uint imageListBackground;
        private int imageListDpi;
        private int cachedVersionNumber = -1;
        private int selectedScopeIndex;
        private List<OutlineItem> procedures = new List<OutlineItem>();
        private List<OutlineItem> mainVariables = new List<OutlineItem>();
        private List<OutlineItem> currentMembers;
        private string lastLoggedSummary;
        private int traceBudget = 80;

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
            return this.GetMemberIndexAtCaret(this.selectedScopeIndex);
        }

        /// <summary>Index of the combo 1 entry under the caret within the specified scope.</summary>
        public int GetMemberIndexAtCaret(int scopeIndex)
        {
            try
            {
                this.EnsureItems();
                (int line, int column) = this.GetCaretPosition();
                List<OutlineItem> members = this.GetMembersForScope(scopeIndex);
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

        public void SetSelectedScopeIndex(int scopeIndex)
        {
            int normalized = this.NormalizeScopeIndex(scopeIndex);
            if (this.selectedScopeIndex == normalized)
            {
                return;
            }

            this.selectedScopeIndex = normalized;
            this.currentMembers = null;
        }

        public int SetDropdownBar(IVsDropdownBar pDropdownBar)
        {
            this.dropdownBar = pDropdownBar;
            this.Trace("SetDropdownBar " + (pDropdownBar == null ? "null" : "ok"));
            return VSConstants.S_OK;
        }

        public int GetComboAttributes(int iCombo, out uint pcEntries, out uint puEntryType, out IntPtr phImageList)
        {
            puEntryType = (uint)(DROPDOWNENTRYTYPE.ENTRY_TEXT | DROPDOWNENTRYTYPE.ENTRY_ATTR);
            phImageList = IntPtr.Zero;
            pcEntries = 0;

            int hr = VSConstants.E_INVALIDARG;
            try
            {
                this.EnsureItems();
                if (iCombo == 0)
                {
                    pcEntries = (uint)(1 + this.procedures.Count);
                    hr = VSConstants.S_OK;
                }
                else if (iCombo == 1)
                {
                    // The member combo always mirrors the currently selected scope.
                    this.currentMembers = null;
                    pcEntries = (uint)this.GetCurrentMembers().Count;
                    hr = VSConstants.S_OK;
                }

                if (hr == VSConstants.S_OK)
                {
                    phImageList = this.GetImageList();
                    if (phImageList != IntPtr.Zero)
                    {
                        puEntryType |= (uint)DROPDOWNENTRYTYPE.ENTRY_IMAGE;
                    }
                }
            }
            catch (Exception ex)
            {
                this.Trace("GetComboAttributes threw: " + ex.GetType().Name);
            }

            this.Trace(string.Format(
                CultureInfo.InvariantCulture,
                "GetComboAttributes({0}) -> hr=0x{1:X8} entries={2} type=0x{3:X} imageList={4}",
                iCombo,
                hr,
                pcEntries,
                puEntryType,
                phImageList == IntPtr.Zero ? "null" : "set"));
            return hr;
        }

        public int GetEntryText(int iCombo, int iIndex, out string ppszText)
        {
            ppszText = string.Empty;

            int hr = VSConstants.E_INVALIDARG;
            try
            {
                this.EnsureItems();
                if (iCombo == 0)
                {
                    if (iIndex <= 0)
                    {
                        ppszText = MainProgramName;
                        hr = VSConstants.S_OK;
                    }
                    else
                    {
                        OutlineItem procedure = this.GetProcedureAt(iIndex);
                        if (procedure != null)
                        {
                            ppszText = procedure.Detail;
                            hr = VSConstants.S_OK;
                        }
                    }
                }
                else if (iCombo == 1)
                {
                    List<OutlineItem> members = this.GetCurrentMembers();
                    if (iIndex >= 0 && iIndex < members.Count)
                    {
                        ppszText = members[iIndex].Name;
                        hr = VSConstants.S_OK;
                    }
                }
            }
            catch (Exception ex)
            {
                this.Trace("GetEntryText threw: " + ex.GetType().Name);
            }

            this.Trace(string.Format(
                CultureInfo.InvariantCulture,
                "GetEntryText({0},{1}) -> hr=0x{2:X8} text=\"{3}\"",
                iCombo,
                iIndex,
                hr,
                ppszText));
            return hr;
        }

        public int GetEntryAttributes(int iCombo, int iIndex, out uint pAttr)
        {
            pAttr = (uint)DROPDOWNFONTATTR.FONTATTR_PLAIN;
            return VSConstants.S_OK;
        }

        public int GetEntryImage(int iCombo, int iIndex, out int piImageIndex)
        {
            return this.GetEntryImage(iCombo, iIndex, out piImageIndex, out _);
        }

        public int GetComboTipText(int iCombo, out string pbstrText)
        {
            pbstrText = iCombo == 0 ? "Small Basic 过程" : "当前作用域中首次使用的变量";
            return VSConstants.S_OK;
        }

        public int OnItemSelected(int iCombo, int iIndex)
        {
            this.Trace($"OnItemSelected({iCombo},{iIndex})");
            if (iCombo == 0)
            {
                this.SetSelectedScopeIndex(iIndex);
            }

            return VSConstants.S_OK;
        }

        public int OnComboGetFocus(int iCombo)
        {
            return VSConstants.S_OK;
        }

        public int OnItemChosen(int iCombo, int iIndex)
        {
            this.Trace($"OnItemChosen({iCombo},{iIndex})");
            try
            {
                this.EnsureItems();
                if (iCombo == 0)
                {
                    this.SetSelectedScopeIndex(iIndex);
                    this.dropdownBar?.RefreshCombo(1, -1);

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
            this.Trace($"GetComboWidth({iCombo}) -> {piWidthPercent}");
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

            try
            {
                this.EnsureItems();
                if (iCombo == 0 && iIndex >= 0 && iIndex <= this.procedures.Count)
                {
                    piImageIndex = iIndex == 0 ? MainProgramImageIndex : ProcedureImageIndex;
                }
                else if (iCombo == 1 && iIndex >= 0 && iIndex < this.GetCurrentMembers().Count)
                {
                    piImageIndex = VariableImageIndex;
                }
                else
                {
                    return VSConstants.E_INVALIDARG;
                }

                phImageList = this.GetImageList();
                if (phImageList != IntPtr.Zero)
                {
                    this.Trace($"GetEntryImage({iCombo},{iIndex}) -> image={piImageIndex} imageList=set");
                    return VSConstants.S_OK;
                }
            }
            catch (Exception ex)
            {
                this.Trace("GetEntryImage threw: " + ex.GetType().Name);
            }

            piImageIndex = -1;
            return VSConstants.E_NOTIMPL;
        }

        private IntPtr GetImageList()
        {
            try
            {
                var color = VSColorTheme.GetThemedColor(EnvironmentColors.DropDownBackgroundColorKey);
                uint background = ((uint)color.A << 24) | ((uint)color.R << 16) | ((uint)color.G << 8) | color.B;
                var presentationSource = System.Windows.PresentationSource.FromVisual(this.textView.VisualElement);
                int dpi = (int)Math.Round(96 * (presentationSource?.CompositionTarget?.TransformToDevice.M11 ?? 1));
                if (this.imageListObject != null && this.imageListHandle != IntPtr.Zero
                    && this.imageListBackground == background && this.imageListDpi == dpi)
                {
                    return this.imageListHandle;
                }

                if (Package.GetGlobalService(typeof(SVsImageService)) is IVsImageService2 imageService)
                {
                    var attributes = new ImageAttributes
                    {
                        StructSize = Marshal.SizeOf(typeof(ImageAttributes)),
                        ImageType = (uint)_UIImageType.IT_ImageList,
                        Format = (uint)_UIDataFormat.DF_Win32,
                        LogicalWidth = 16,
                        LogicalHeight = 16,
                        Dpi = dpi,
                        Background = background,
                        Flags = unchecked((uint)(_ImageAttributesFlags.IAF_RequiredFlags | _ImageAttributesFlags.IAF_Background)),
                    };

                    IVsUIObject image = imageService.GetImage(NavigationIcons, attributes);
                    if (image != null && ErrorHandler.Succeeded(image.get_Data(out object data))
                        && data is IVsUIWin32ImageList imageList
                        && ErrorHandler.Succeeded(imageList.GetHIMAGELIST(out IntPtr handle))
                        && handle != IntPtr.Zero)
                    {
                        this.imageListObject = image;
                        this.imageListHandle = handle;
                        this.imageListBackground = background;
                        this.imageListDpi = dpi;
                        return handle;
                    }
                }

                this.Trace("GetImageList: navigation icons unavailable");
            }
            catch (Exception ex)
            {
                this.Trace("GetImageList threw: " + ex.GetType().Name);
            }

            return IntPtr.Zero;
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
            this.selectedScopeIndex = this.NormalizeScopeIndex(this.selectedScopeIndex);
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

        /// <summary>
        /// Logs the first few calls the editor makes into this client. Whether the
        /// bar asks for entries at all (and how many) is what tells an empty
        /// navigation bar apart from a data problem.
        /// </summary>
        private void Trace(string message)
        {
            if (this.traceBudget <= 0)
            {
                return;
            }

            this.traceBudget--;
            SmallBasicDiagnostics.Write("[navbar] " + message);
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

            this.currentMembers = this.GetMembersForScope(this.selectedScopeIndex);
            return this.currentMembers;
        }

        private List<OutlineItem> GetMembersForScope(int scopeIndex)
        {
            scopeIndex = this.NormalizeScopeIndex(scopeIndex);
            if (scopeIndex == this.selectedScopeIndex && this.currentMembers != null)
            {
                return this.currentMembers;
            }

            OutlineItem procedure = this.GetProcedureAt(scopeIndex);
            return procedure != null
                ? new List<OutlineItem>(procedure.Children)
                : new List<OutlineItem>(this.mainVariables);
        }

        private int NormalizeScopeIndex(int scopeIndex)
        {
            return scopeIndex >= 0 && scopeIndex <= this.procedures.Count ? scopeIndex : 0;
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
