namespace SmallBasic.Vsix.Commands
{
    using System;
    using System.Diagnostics;
    using System.IO;

    internal static class SmallBasicCompilerTool
    {
        private const string CompilerExecutableName = "SmallBasic.Compiler.Tool.exe";

        public static string CompileToSourceDirectory(string filePath)
        {
            if (string.IsNullOrWhiteSpace(filePath))
            {
                throw new ArgumentException("A Small Basic source file path is required.", nameof(filePath));
            }

            string fullSourcePath = Path.GetFullPath(filePath);
            string outputDirectory = Path.GetDirectoryName(fullSourcePath)
                ?? throw new InvalidOperationException("无法确定 Small Basic 程序文件的目录。");
            string compilerPath = ResolveCompilerToolPath();

            var startInfo = new ProcessStartInfo
            {
                FileName = compilerPath,
                Arguments = $"compile --file {QuoteArgument(fullSourcePath)} --outputDir {QuoteArgument(outputDirectory)}",
                WorkingDirectory = Path.GetDirectoryName(compilerPath) ?? outputDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException("无法启动 Small Basic 编译工具。");
            string stdout = process.StandardOutput.ReadToEnd();
            string stderr = process.StandardError.ReadToEnd();
            process.WaitForExit();

            if (process.ExitCode != 0)
            {
                string details = string.IsNullOrWhiteSpace(stderr)
                    ? stdout
                    : string.IsNullOrWhiteSpace(stdout)
                        ? stderr
                        : $"{stderr}{Environment.NewLine}{stdout}";
                throw new InvalidOperationException(
                    $"Small Basic 编译工具执行失败（退出码 {process.ExitCode}）。{Environment.NewLine}{details.Trim()}");
            }

            string executablePath = Path.Combine(
                outputDirectory,
                Path.GetFileNameWithoutExtension(fullSourcePath) + ".exe");
            if (!File.Exists(executablePath))
            {
                throw new FileNotFoundException(
                    "编译工具没有生成预期的 EXE 输出。",
                    executablePath);
            }

            return executablePath;
        }

        private static string ResolveCompilerToolPath()
        {
            string extensionDirectory = ExtensionPayloadDirectory.Resolve();
            foreach (string candidate in EnumerateCompilerToolCandidates(extensionDirectory))
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            throw new FileNotFoundException(
                "未找到 Small Basic 编译工具。请重新安装完整的 VSIX，或先运行 runhost\\Build-RunHost.ps1 构建编译器载荷。");
        }

        private static string[] EnumerateCompilerToolCandidates(string extensionDirectory)
        {
            string marker = Path.Combine("runhost", "compiler", CompilerExecutableName);
            var ancestorCandidates = FindCandidatesInAncestors(extensionDirectory, marker);
            var candidates = new string[ancestorCandidates.Length + 1];
            candidates[0] = Path.Combine(extensionDirectory, "runhost", "compiler", CompilerExecutableName);
            Array.Copy(ancestorCandidates, 0, candidates, 1, ancestorCandidates.Length);
            return candidates;
        }

        private static string[] FindCandidatesInAncestors(string startDirectory, string relativePath)
        {
            var results = new System.Collections.Generic.List<string>();
            string? current = startDirectory;
            for (int depth = 0; depth < 8 && !string.IsNullOrEmpty(current); depth++)
            {
                results.Add(Path.Combine(current, relativePath));
                current = Path.GetDirectoryName(current);
            }

            return results.ToArray();
        }

        private static string QuoteArgument(string value) => $"\"{value.Replace("\"", "\\\"")}\"";
    }
}
