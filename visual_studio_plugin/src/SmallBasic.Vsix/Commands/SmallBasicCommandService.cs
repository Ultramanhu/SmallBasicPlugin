namespace SmallBasic.Vsix.Commands
{
    using System;
    using System.Diagnostics;
    using System.IO;
    using System.Linq;
    using System.Windows;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
    using SmallBasic.Compiler;

    /// <summary>
    /// Shared run/debug entry points used by the editor key filter and the
    /// explicit Tools menu commands.
    /// </summary>
    internal static class SmallBasicCommandService
    {
        // Visual Studio's standard F5/Ctrl+F5 commands and Open Folder launch
        // profiles can both reach this shared service. Remember the most recent
        // backend request so subsequent Ctrl+F5 runs, plus classic solution-mode
        // F5/F10/F11 launches, keep using the same runtime instead of silently
        // falling back to C#.
        public static SmallBasicBackend SelectedBackend { get; private set; } = SmallBasicBackend.CSharp;

        public static string LastFocusedSmallBasicDocumentPath { get; private set; } = string.Empty;

        public static void RememberSmallBasicDocument(string? filePath)
        {
            if (string.IsNullOrWhiteSpace(filePath)
                || !string.Equals(Path.GetExtension(filePath), ".sb", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            LastFocusedSmallBasicDocumentPath = Path.GetFullPath(filePath);
        }

        public static void RunActiveDocument(SmallBasicBackend backend)
        {
            SelectedBackend = backend;
            if (TrySaveActiveDocument(out string? filePath))
            {
                Run(filePath!, backend);
            }
        }

        public static void DebugActiveDocument(SmallBasicBackend backend)
        {
            SelectedBackend = backend;
            if (TrySaveActiveDocument(out string? filePath))
            {
                Debug(filePath!, backend, stopOnEntry: false);
            }
        }

        public static void Run(string filePath, SmallBasicBackend backend)
        {
            SelectedBackend = backend;
            RememberSmallBasicDocument(filePath);

            try
            {
                if (!TryCompile(filePath, out SmallBasicCompilation? compilation)
                    || !ValidateBackend(compilation!, backend))
                {
                    return;
                }

                string extensionDirectory = GetExtensionDirectory();
                ProcessStartInfo startInfo;
                switch (backend)
                {
                    case SmallBasicBackend.CSharp:
                        startInfo = CreateCSharpRunStartInfo(extensionDirectory, filePath);
                        break;
                    case SmallBasicBackend.Blazor:
                        startInfo = CreateBlazorRunStartInfo(extensionDirectory, filePath);
                        break;
                    default:
                        startInfo = CreateJavaScriptRunStartInfo(extensionDirectory, filePath);
                        break;
                }

                Process.Start(startInfo);
            }
            catch (Exception ex)
            {
                ShowError($"运行失败：{ex.Message}");
            }
        }

        public static void Debug(string filePath, SmallBasicBackend backend, bool stopOnEntry)
        {
            SelectedBackend = backend;
            RememberSmallBasicDocument(filePath);

            try
            {
                if (!TryCompile(filePath, out SmallBasicCompilation? compilation)
                    || !ValidateBackend(compilation!, backend))
                {
                    return;
                }

                SmallBasicDebugLauncher.Launch(filePath, backend, stopOnEntry);
            }
            catch (Exception ex)
            {
                ShowError($"启动调试失败：{ex.Message}");
            }
        }

        private static ProcessStartInfo CreateCSharpRunStartInfo(string extensionDirectory, string filePath)
        {
            string runHostPath = Path.Combine(extensionDirectory, "runhost", "csharp", "SmallBasic.RunHost.exe");
            if (!File.Exists(runHostPath))
            {
                throw new FileNotFoundException("未找到 Small Basic C# 运行宿主。请重新安装完整的 VSIX。", runHostPath);
            }

            return new ProcessStartInfo
            {
                FileName = runHostPath,
                Arguments = $"run --file {QuoteArgument(filePath)} --pause",
                WorkingDirectory = Path.GetDirectoryName(filePath) ?? extensionDirectory,
                UseShellExecute = true,
            };
        }

        private static ProcessStartInfo CreateJavaScriptRunStartInfo(string extensionDirectory, string filePath)
        {
            string runHostPath = Path.Combine(extensionDirectory, "runhost", "javascript", "smallbasic-runhost.js");
            if (!File.Exists(runHostPath))
            {
                throw new FileNotFoundException("未找到 Small Basic JavaScript 运行宿主。请重新安装完整的 VSIX。", runHostPath);
            }

            string nodePath = SmallBasicDebugLauncher.RequireNodeExecutable();
            return new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = $"{QuoteArgument(runHostPath)} run --file {QuoteArgument(filePath)} --pause",
                WorkingDirectory = Path.GetDirectoryName(filePath) ?? extensionDirectory,
                UseShellExecute = true,
            };
        }

        private static ProcessStartInfo CreateBlazorRunStartInfo(string extensionDirectory, string filePath)
        {
            string runHostPath = Path.Combine(extensionDirectory, "runhost", "blazor", "SmallBasic.Blazor.RunHost.dll");
            if (!File.Exists(runHostPath))
            {
                throw new FileNotFoundException("未找到 Small Basic Blazor RunHost。请重新安装完整的 VSIX。", runHostPath);
            }

            return new ProcessStartInfo
            {
                FileName = SmallBasicDebugLauncher.RequireDotNetExecutable(),
                Arguments = $"{QuoteArgument(runHostPath)} run --file {QuoteArgument(filePath)} --pause",
                WorkingDirectory = Path.GetDirectoryName(filePath) ?? extensionDirectory,
                UseShellExecute = true,
            };
        }

        private static bool TryCompile(string filePath, out SmallBasicCompilation? compilation)
        {
            compilation = null;
            if (!File.Exists(filePath))
            {
                ShowError($"找不到 Small Basic 程序文件：{filePath}");
                return false;
            }

            compilation = new SmallBasicCompilation(File.ReadAllText(filePath));
            if (compilation.Diagnostics.Count == 0)
            {
                return true;
            }

            string errors = string.Join(
                Environment.NewLine,
                compilation.Diagnostics.Take(10).Select(diagnostic => diagnostic.ToDisplayString()));
            ShowError($"程序包含错误：{Environment.NewLine}{errors}");
            return false;
        }

        private static bool ValidateBackend(SmallBasicCompilation compilation, SmallBasicBackend backend)
        {
            if (backend != SmallBasicBackend.JavaScript || !compilation.Analysis.UsesGraphicsWindow)
            {
                return true;
            }

            MessageBox.Show(
                "JavaScript 后端不支持 GraphicsWindow、Shapes、Turtle 或其他图形库。请改用 C# 后端。",
                "Small Basic",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return false;
        }

        private static bool TrySaveActiveDocument(out string? filePath)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            filePath = null;
            if (!(Package.GetGlobalService(typeof(SDTE)) is EnvDTE.DTE dte)
                || dte.ActiveDocument == null
                || string.IsNullOrWhiteSpace(dte.ActiveDocument.FullName)
                || !string.Equals(Path.GetExtension(dte.ActiveDocument.FullName), ".sb", StringComparison.OrdinalIgnoreCase))
            {
                MessageBox.Show(
                    "请先打开一个 Small Basic (.sb) 文件。",
                    "Small Basic",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
                return false;
            }

            dte.ActiveDocument.Save();
            filePath = Path.GetFullPath(dte.ActiveDocument.FullName);
            RememberSmallBasicDocument(filePath);
            return true;
        }

        private static string GetExtensionDirectory()
            => Path.GetDirectoryName(typeof(SmallBasicCommandService).Assembly.Location) ?? string.Empty;

        private static string QuoteArgument(string value) => $"\"{value.Replace("\"", "\\\"")}\"";

        private static void ShowError(string message)
        {
            MessageBox.Show(
                message,
                "Small Basic",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }
}
