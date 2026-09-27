namespace SmallBasic.Vsix.Editor.Outline
{
    using System;
    using System.Runtime.InteropServices;
    using Microsoft.VisualStudio.Shell;

    /// <summary>
    /// Hosts the SmallBasic document outline ("大纲"): every <c>Sub</c> declaration
    /// and the first use of every variable, mirroring the VS Code outline view.
    /// </summary>
    /// <remarks>
    /// Visual Studio's "文档大纲" window only serves designer views (XAML/WinForms)
    /// and HTML documents, and the editor navigation bar can only be reached from a
    /// legacy language service, so a dedicated tool window is the only supported way
    /// to surface a document outline for a MEF based language extension.
    /// </remarks>
    [Guid(SmallBasicOutlineToolWindow.ToolWindowGuidString)]
    public sealed class SmallBasicOutlineToolWindow : ToolWindowPane
    {
        public const string ToolWindowGuidString = "1E4B2F8C-9A3D-4C57-8F2E-6B1D0A7C5E93";

        public SmallBasicOutlineToolWindow()
            : base(null)
        {
            this.Caption = "Small Basic 大纲";
            this.Content = new SmallBasicOutlineControl();
        }
    }
}
