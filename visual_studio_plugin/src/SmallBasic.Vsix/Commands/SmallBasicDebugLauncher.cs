namespace SmallBasic.Vsix.Commands
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.Globalization;
    using System.IO;
    using System.Text;
    using System.Threading.Tasks;
    using System.Windows;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
    using Microsoft.VisualStudio.Threading;

    /// <summary>
    /// Bridges Visual Studio's F5 command to the Debug Adapter Host. The same
    /// DAP implementation is shared with the VS Code extension, so breakpoints,
    /// stepping, stacks and variables have one runtime implementation.
    /// </summary>
    internal static class SmallBasicDebugLauncher
    {
        private static bool launchInProgress;

        public static void Launch(string programPath, SmallBasicBackend backend, bool stopOnEntry = false)
        {
            // Rapid F5 presses (or a second F5 while the Debug Adapter Host is
            // still taking over) must not stack multiple launches.
            if (launchInProgress)
            {
                return;
            }

            string extensionDirectory = ExtensionPayloadDirectory.Resolve();
            ResolveAdapter(extensionDirectory, backend, out string adapterPath, out string adapterArguments);
            string launchPath = WriteLaunchConfiguration(programPath, backend, adapterPath, adapterArguments, stopOnEntry);
            launchInProgress = true;

            // The current F5 command is still on Visual Studio's command stack.
            // Yield once so DebugAdapterHost.Launch is not invoked re-entrantly.
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                try
                {
                    await Task.Yield();
                    await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                    ExecuteLaunchCommand(launchPath);
                }
                finally
                {
                    launchInProgress = false;
                }
            }).FileAndForget("SmallBasic/LaunchDebugAdapter");
        }

        private static void ExecuteLaunchCommand(string launchPath)
        {
            try
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                var dte = Package.GetGlobalService(typeof(SDTE)) as EnvDTE.DTE;
                if (dte == null)
                {
                    throw new InvalidOperationException("无法取得 Visual Studio 自动化服务。");
                }

                dte.ExecuteCommand("DebugAdapterHost.Launch", $"/LaunchJson:\"{launchPath}\"");
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Visual Studio Debug Adapter Host 启动失败：{ex.Message}",
                    "Small Basic",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
            }
        }

        internal static string RequireNodeExecutable()
        {
            string? nodePath = FindNodeExecutable();
            if (nodePath == null)
            {
                throw new FileNotFoundException(
                    "未找到外部 node.exe。Small Basic JavaScript 后端需要 Node.js 20 或更高版本；VSIX 不会内置 Node.js。");
            }

            int? majorVersion = TryGetNodeMajorVersion(nodePath);
            if (majorVersion.HasValue && majorVersion.Value < 20)
            {
                throw new InvalidOperationException(
                    $"检测到 Node.js {majorVersion.Value}，JavaScript 后端需要 Node.js 20 或更高版本。");
            }

            return nodePath;
        }

        internal static string RequireDotNetExecutable()
        {
            string? dotnetPath = FindExecutableOnPath("dotnet.exe");
            if (dotnetPath == null)
            {
                string candidate = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "dotnet", "dotnet.exe");
                dotnetPath = File.Exists(candidate) ? candidate : null;
            }

            if (dotnetPath == null)
            {
                throw new FileNotFoundException("未找到 dotnet.exe。Small Basic Blazor 后端需要 .NET 8 Runtime。");
            }

            return dotnetPath;
        }

        private static void ResolveAdapter(
            string extensionDirectory,
            SmallBasicBackend backend,
            out string adapterPath,
            out string adapterArguments)
        {
            if (backend == SmallBasicBackend.CSharp)
            {
                adapterPath = Path.Combine(extensionDirectory, "runhost", "csharp", "SmallBasic.RunHost.exe");
                adapterArguments = "debug";
                if (!File.Exists(adapterPath))
                {
                    throw new FileNotFoundException("未找到 Small Basic C# 调试适配器。请重新安装完整的 VSIX。", adapterPath);
                }

                return;
            }

            if (backend == SmallBasicBackend.Blazor)
            {
                string hostPath = Path.Combine(extensionDirectory, "runhost", "blazor", "SmallBasic.Blazor.RunHost.dll");
                if (!File.Exists(hostPath))
                {
                    throw new FileNotFoundException("未找到 Small Basic Blazor 调试宿主。请重新安装完整的 VSIX。", hostPath);
                }

                adapterPath = RequireDotNetExecutable();
                adapterArguments = $"\"{hostPath}\" debug";
                return;
            }

            string scriptPath = Path.Combine(extensionDirectory, "debugadapter", "adapter.js");
            if (!File.Exists(scriptPath))
            {
                throw new FileNotFoundException("未找到 Small Basic JavaScript 调试适配器。请重新安装完整的 VSIX。", scriptPath);
            }

            adapterPath = RequireNodeExecutable();
            adapterArguments = $"\"{scriptPath}\"";
        }

        private static string WriteLaunchConfiguration(
            string programPath,
            SmallBasicBackend backend,
            string adapterPath,
            string adapterArguments,
            bool stopOnEntry)
        {
            string directory = Path.Combine(Path.GetTempPath(), "SmallBasicPlugin", "Debug");
            Directory.CreateDirectory(directory);
            DeleteLegacyLaunchConfigurations(directory);

            string backendName = backend == SmallBasicBackend.CSharp
                ? "C#"
                : backend == SmallBasicBackend.Blazor ? "Blazor" : "JavaScript";
            string launchFileName = backend == SmallBasicBackend.CSharp
                ? "launch-csharp.json"
                : backend == SmallBasicBackend.Blazor ? "launch-blazor.json" : "launch-javascript.json";
            string launchPath = Path.Combine(directory, launchFileName);

            var properties = new List<KeyValuePair<string, object>>
            {
                new KeyValuePair<string, object>("$adapter", adapterPath),
                new KeyValuePair<string, object>("$adapterArgs", adapterArguments),
                new KeyValuePair<string, object>("name", $"Small Basic: Debug current file ({backendName} backend)"),
                new KeyValuePair<string, object>("type", "smallbasic"),
                new KeyValuePair<string, object>("request", "launch"),
                new KeyValuePair<string, object>("program", Path.GetFullPath(programPath)),
                new KeyValuePair<string, object>("stopOnEntry", stopOnEntry),
            };

            var json = new StringBuilder();
            json.AppendLine("{");
            for (int i = 0; i < properties.Count; i++)
            {
                KeyValuePair<string, object> property = properties[i];
                json.Append("  ").Append(ToJsonString(property.Key)).Append(": ");
                json.Append(property.Value is bool flag ? (flag ? "true" : "false") : ToJsonString((string)property.Value));
                json.AppendLine(i == properties.Count - 1 ? string.Empty : ",");
            }

            json.AppendLine("}");
            File.WriteAllText(launchPath, json.ToString(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            return launchPath;
        }

        private static void DeleteLegacyLaunchConfigurations(string directory)
        {
            foreach (string path in Directory.EnumerateFiles(directory, "launch-*.json"))
            {
                string fileNameWithoutExtension = Path.GetFileNameWithoutExtension(path);
                const string prefix = "launch-";
                if (fileNameWithoutExtension.Length <= prefix.Length ||
                    !Guid.TryParseExact(fileNameWithoutExtension.Substring(prefix.Length), "N", out _))
                {
                    continue;
                }

                try
                {
                    File.Delete(path);
                }
                catch (IOException)
                {
                    // A running Visual Studio instance may still be reading an old launch file.
                }
                catch (UnauthorizedAccessException)
                {
                    // Cleanup is best-effort and must never prevent a new debug session.
                }
            }
        }

        private static string? FindNodeExecutable()
        {
            string executableName = "node.exe";
            string pathValue = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (string pathEntry in pathValue.Split(Path.PathSeparator))
            {
                string directory = pathEntry.Trim().Trim('"');
                if (directory.Length == 0)
                {
                    continue;
                }

                string candidate = Path.Combine(directory, executableName);
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            string[] candidates =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", executableName),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", executableName),
            };

            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static string? FindExecutableOnPath(string executableName)
        {
            string pathValue = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (string pathEntry in pathValue.Split(Path.PathSeparator))
            {
                string directory = pathEntry.Trim().Trim('"');
                if (directory.Length == 0)
                {
                    continue;
                }

                string candidate = Path.Combine(directory, executableName);
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static int? TryGetNodeMajorVersion(string nodePath)
        {
            try
            {
                using (var process = Process.Start(new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "--version",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true,
                }))
                {
                    if (process == null || !process.WaitForExit(3000))
                    {
                        return null;
                    }

                    string version = process.StandardOutput.ReadToEnd().Trim().TrimStart('v', 'V');
                    string major = version.Split('.')[0];
                    return int.TryParse(major, NumberStyles.None, CultureInfo.InvariantCulture, out int parsed)
                        ? parsed
                        : (int?)null;
                }
            }
            catch
            {
                return null;
            }
        }

        private static string ToJsonString(string value)
        {
            var result = new StringBuilder(value.Length + 2);
            result.Append('"');
            foreach (char character in value)
            {
                switch (character)
                {
                    case '"':
                        result.Append("\\\"");
                        break;
                    case '\\':
                        result.Append("\\\\");
                        break;
                    case '\b':
                        result.Append("\\b");
                        break;
                    case '\f':
                        result.Append("\\f");
                        break;
                    case '\n':
                        result.Append("\\n");
                        break;
                    case '\r':
                        result.Append("\\r");
                        break;
                    case '\t':
                        result.Append("\\t");
                        break;
                    default:
                        if (character < 0x20)
                        {
                            result.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            result.Append(character);
                        }

                        break;
                }
            }

            return result.Append('"').ToString();
        }
    }
}
