namespace SmallBasic.Vsix.ToolWindows.Outline
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Threading;
    using System.Threading.Tasks;
    using EnvDTE;
    using EnvDTE80;
    using Microsoft.VisualStudio.Shell;
    using SmallBasic.Vsix.Commands;
    using SDTE = EnvDTE.DTE;

    internal static class SmallBasicOutlineDocumentService
    {
        public static async Task<(string? FilePath, string? SourceText, string? ErrorMessage)> TryReadPreferredDocumentAsync(CancellationToken cancellationToken)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            if (!(Package.GetGlobalService(typeof(SDTE)) is DTE2 dte))
            {
                return (null, null, "无法取得 Visual Studio 自动化服务。请先打开一个 Small Basic 文档。");
            }

            if (TryGetSmallBasicDocumentPath(dte.ActiveDocument, out string activeDocumentPath))
            {
                return ReadDocument(activeDocumentPath);
            }

            string rememberedDocument = GetRememberedSmallBasicDocumentPath();
            if (!string.IsNullOrEmpty(rememberedDocument))
            {
                return ReadDocument(rememberedDocument);
            }

            var openSmallBasicDocuments = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Document document in dte.Documents)
            {
                if (TryGetSmallBasicDocumentPath(document, out string documentPath))
                {
                    openSmallBasicDocuments.Add(documentPath);
                }
            }

            if (openSmallBasicDocuments.Count == 1)
            {
                foreach (string documentPath in openSmallBasicDocuments)
                {
                    return ReadDocument(documentPath);
                }
            }

            return (null, null, "请先激活一个 .sb 文件，或保持仅打开一个 Small Basic 文档后再刷新大纲。");
        }

        public static async Task NavigateAsync(string filePath, int line, int column, CancellationToken cancellationToken)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            if (!(Package.GetGlobalService(typeof(SDTE)) is DTE2 dte))
            {
                return;
            }

            Window window = dte.ItemOperations.OpenFile(filePath);
            window.Activate();

            if (dte.ActiveDocument?.Selection is TextSelection selection)
            {
                selection.MoveToLineAndOffset(Math.Max(line + 1, 1), Math.Max(column + 1, 1), Extend: false);
            }
        }

        private static (string? FilePath, string? SourceText, string? ErrorMessage) ReadDocument(string filePath)
        {
            if (!File.Exists(filePath))
            {
                return (null, null, $"找不到 Small Basic 程序文件：{filePath}");
            }

            return (filePath, File.ReadAllText(filePath), null);
        }

        private static string GetRememberedSmallBasicDocumentPath()
        {
            string rememberedDocument = SmallBasicCommandService.LastFocusedSmallBasicDocumentPath;
            return !string.IsNullOrWhiteSpace(rememberedDocument) && File.Exists(rememberedDocument)
                ? rememberedDocument
                : string.Empty;
        }

        private static bool TryGetSmallBasicDocumentPath(Document document, out string documentPath)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            documentPath = string.Empty;
            if (document == null
                || string.IsNullOrWhiteSpace(document.FullName)
                || !string.Equals(Path.GetExtension(document.FullName), ".sb", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            document.Save();
            documentPath = Path.GetFullPath(document.FullName);
            SmallBasicCommandService.RememberSmallBasicDocument(documentPath);
            return true;
        }
    }
}