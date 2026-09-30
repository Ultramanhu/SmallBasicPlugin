namespace SmallBasic.Vsix.Workspace
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
    using Microsoft.VisualStudio.Workspace;
    using Microsoft.VisualStudio.Workspace.Debug;
    using SmallBasic.Vsix.Commands;

    /// <summary>
    /// Registers the "smallbasic" launch type with the Open Folder machinery so
    /// launch.vs.json configurations of that type become launchable debug
    /// targets (mirrors Python Tools' two-provider pattern).
    /// </summary>
    [ExportLaunchConfigurationProvider(
        ConfigurationProviderType,
        new[] { ".sb" },
        "smallbasic",
        SchemaJson,
        false,
        ProviderPriority.Normal)]
    internal sealed class SmallBasicLaunchConfigurationProvider : ILaunchConfigurationProvider
    {
        private const string ConfigurationProviderType = "1A7C3E92-5B84-4D6F-A8C1-9E2D4F6B0A35";

        private const string SchemaJson = @"{
  ""definitions"": {
    ""smallbasic"": {
      ""type"": ""object"",
      ""properties"": {
        ""type"": { ""type"": ""string"", ""enum"": [ ""smallbasic"" ] },
        ""program"": { ""type"": ""string"" },
        ""target"": { ""type"": ""string"" },
        ""backend"": { ""type"": ""string"", ""enum"": [ ""csharp"", ""javascript"", ""blazor"" ] },
        ""noDebug"": { ""type"": ""boolean"" },
        ""stopOnEntry"": { ""type"": ""boolean"" }
      }
    },
    ""smallbasicFile"": {
      ""allOf"": [
        { ""$ref"": ""#/definitions/default"" },
        { ""$ref"": ""#/definitions/smallbasic"" }
      ]
    }
  },
  ""defaults"": {
    "".sb"": { ""$ref"": ""#/definitions/smallbasic"" }
  },
  ""configuration"": ""#/definitions/smallbasicFile""
}";

        public bool IsDebugLaunchActionSupported(DebugLaunchActionContext debugLaunchActionContext) => true;

        public void CustomizeLaunchConfiguration(DebugLaunchActionContext debugLaunchActionContext, IPropertySettings launchSettings)
        {
            // Do not silently inject a backend here. Visual Studio can call this
            // method for a named launch.vs.json profile after dropping some of
            // its custom fields. Injecting C# in that case turns an invalid or
            // incomplete JavaScript/Blazor profile into a different platform.
            // The target provider resolves known profile names and reports every
            // other missing/invalid backend explicitly.
        }
    }

    /// <summary>
    /// Handles Open Folder debug targets for Small Basic. Launch configurations
    /// whose type is "smallbasic" (launch.vs.json) carry the backend to use;
    /// the auto-generated "current document" target for .sb files falls back to
    /// the C# backend. Launching reuses the shared per-backend adapter launcher.
    /// </summary>
    [ExportLaunchDebugTarget(
        LaunchDebugTargetProviderOptions.IsRuntimeSupportContext | LaunchDebugTargetProviderOptions.SupportsContextRequiresProjectConfiguration,
        ProviderType,
        new[] { ".sb" },
        ProviderPriority.Normal)]
    internal sealed class SmallBasicLaunchDebugTargetProvider : ILaunchDebugTargetProvider4
    {
        private const string ProviderType = "6E4F2A91-7C3B-4D58-9A1E-2B5D8F0C3E47";

        public bool SupportsContext(IWorkspace workspaceContext, string targetFilePath)
        {
            bool supported = HasSmallBasicProgramExtension(targetFilePath);
            Services.SmallBasicDiagnostics.Write($"[launch provider] SupportsContext path='{targetFilePath}' supported={supported}");
            return supported;
        }

        public bool SupportsContext(IWorkspace workspaceContext, ProjectConfiguration? projectConfiguration, string targetFilePath)
        {
            bool supported = HasSmallBasicProgramExtension(targetFilePath)
                || IsSmallBasicLaunchConfiguration(projectConfiguration);
            return supported;
        }

        public bool SupportsTargetPath(IWorkspace workspaceContext, string targetFilePath)
        {
            return HasSmallBasicProgramExtension(targetFilePath);
        }

        public bool SupportsProjectConfiguration(IWorkspace workspace, ProjectConfiguration projectConfiguration)
        {
            string type = projectConfiguration?.LaunchSettings?.GetValue("type", string.Empty) ?? string.Empty;
            string configurationName = projectConfiguration?.LaunchSettings?.GetValue("name", string.Empty) ?? string.Empty;
            bool supported = IsSmallBasicLaunchConfiguration(projectConfiguration);
            Services.SmallBasicDiagnostics.Write($"[launch provider] SupportsProjectConfiguration type='{type}' name='{configurationName}'");
            return supported;
        }

        public void LaunchDebugTarget(IWorkspace workspaceContext, IServiceProvider serviceProvider, DebugLaunchActionContext debugLaunchActionContext)
        {
            IPropertySettings launchConfiguration = debugLaunchActionContext.LaunchConfiguration;
            string program = launchConfiguration.GetValue("program", string.Empty);
            string target = launchConfiguration.GetValue("target", string.Empty);
            bool noDebug = launchConfiguration.GetValue("noDebug", false);
            Services.SmallBasicDiagnostics.Write($"[launch provider] LaunchDebugTarget backend='{launchConfiguration.GetValue("backend", string.Empty)}' program='{program}' name='{launchConfiguration.GetValue("name", string.Empty)}' noDebug={noDebug}");

            string configurationName = launchConfiguration.GetValue("name", string.Empty);
            bool backendResolved = TryResolveBackend(
                launchConfiguration.GetValue("backend", string.Empty),
                configurationName,
                out SmallBasicBackend backend,
                out string backendError);
            bool stopOnEntry = launchConfiguration.GetValue("stopOnEntry", false);
            bool usesCurrentDocument = program.IndexOf("${file}", StringComparison.OrdinalIgnoreCase) >= 0
                || IsCurrentDocumentProfileName(configurationName);

            // The workspace machinery may invoke this on a background thread;
            // DTE access and the launch itself require the main thread.
            ThreadHelper.JoinableTaskFactory.Run(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                if (!backendResolved)
                {
                    System.Windows.MessageBox.Show(
                        backendError,
                        "Small Basic",
                        System.Windows.MessageBoxButton.OK,
                        System.Windows.MessageBoxImage.Error);
                    return;
                }

                string resolvedProgram = ResolveProgramPath(workspaceContext, program, target, usesCurrentDocument);
                if (string.IsNullOrEmpty(resolvedProgram))
                {
                    System.Windows.MessageBox.Show(
                        "无法确定要调试的 Small Basic 程序文件。请先激活一个 .sb 文件，或在 launch.vs.json 的该配置中把 program 设为 ${file} 或具体的 .sb 路径。",
                        "Small Basic",
                        System.Windows.MessageBoxButton.OK,
                        System.Windows.MessageBoxImage.Information);
                    return;
                }

                if (!HasSmallBasicProgramExtension(resolvedProgram))
                {
                    System.Windows.MessageBox.Show(
                        $"Small Basic 调试配置的 program 必须指向 .sb 文件，但当前解析到的是：{resolvedProgram}",
                        "Small Basic",
                        System.Windows.MessageBoxButton.OK,
                        System.Windows.MessageBoxImage.Information);
                    return;
                }

                if (!File.Exists(resolvedProgram))
                {
                    System.Windows.MessageBox.Show(
                        $"找不到要调试的 Small Basic 程序文件：{resolvedProgram}",
                        "Small Basic",
                        System.Windows.MessageBoxButton.OK,
                        System.Windows.MessageBoxImage.Error);
                    return;
                }

                string fullProgramPath = Path.GetFullPath(resolvedProgram);
                if (noDebug)
                {
                    SmallBasicCommandService.Run(fullProgramPath, backend);
                }
                else
                {
                    SmallBasicCommandService.Debug(fullProgramPath, backend, stopOnEntry);
                }
            });
        }

        private static bool TryResolveBackend(
            string backend,
            string configurationName,
            out SmallBasicBackend resolvedBackend,
            out string error)
        {
            error = string.Empty;

            if (string.Equals(backend, "csharp", StringComparison.OrdinalIgnoreCase))
            {
                resolvedBackend = SmallBasicBackend.CSharp;
                return true;
            }

            if (string.Equals(backend, "javascript", StringComparison.OrdinalIgnoreCase))
            {
                resolvedBackend = SmallBasicBackend.JavaScript;
                return true;
            }

            if (string.Equals(backend, "blazor", StringComparison.OrdinalIgnoreCase))
            {
                resolvedBackend = SmallBasicBackend.Blazor;
                return true;
            }

            if (!string.IsNullOrWhiteSpace(backend))
            {
                resolvedBackend = default;
                error = $"Small Basic 调试配置中的 backend 值“{backend}”无效。仅支持 csharp、javascript 或 blazor；已取消启动，不会自动切换到其他后端。";
                return false;
            }

            // Visual Studio's Open Folder pipeline can omit custom properties
            // when it materializes a named launch.vs.json profile. Recover only
            // an unambiguous backend encoded by one of our standard profile
            // names; never consult mutable global selection state as fallback.
            if (configurationName.IndexOf("javascript", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                resolvedBackend = SmallBasicBackend.JavaScript;
                return true;
            }

            if (configurationName.IndexOf("blazor", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                resolvedBackend = SmallBasicBackend.Blazor;
                return true;
            }

            if (configurationName.IndexOf("c#", StringComparison.OrdinalIgnoreCase) >= 0
                || configurationName.IndexOf("csharp", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                resolvedBackend = SmallBasicBackend.CSharp;
                return true;
            }

            if (IsSmallBasicProfileName(configurationName))
            {
                resolvedBackend = default;
                error = $"Small Basic 调试配置“{configurationName}”没有指定有效的 backend。请设置为 csharp、javascript 或 blazor；已取消启动，不会自动选择其他后端。";
                return false;
            }

            // Visual Studio's generated "Current Document" target has no named
            // Small Basic profile or backend field. Its documented fixed default
            // is C#, independent of whichever backend ran previously.
            resolvedBackend = SmallBasicBackend.CSharp;
            return true;
        }

        private static string ResolveProgramPath(
            IWorkspace workspaceContext,
            string program,
            string target,
            bool usesCurrentDocument)
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            // Visual Studio requires "project" to resolve to an existing file or
            // directory before it exposes a launch.vs.json profile. Our checked-in
            // profiles use "." as a portable workspace anchor; it must never replace
            // the active Small Basic document selected by program="${file}".
            // VS can omit custom fields such as program/backend when launching a
            // profile, so the profile name is also used to preserve this behavior.
            if (usesCurrentDocument)
            {
                return GetPreferredSmallBasicDocument();
            }

            string resolvedTarget = ResolvePathCandidate(workspaceContext, target);

            if (string.IsNullOrWhiteSpace(program))
            {
                if (HasSmallBasicProgramExtension(resolvedTarget))
                {
                    return resolvedTarget;
                }

                string activeDocument = GetPreferredSmallBasicDocument();
                if (!string.IsNullOrEmpty(activeDocument))
                {
                    return activeDocument;
                }

                return resolvedTarget;
            }

            string candidate = ResolvePathCandidate(workspaceContext, program);
            if (HasSmallBasicProgramExtension(candidate))
            {
                return candidate;
            }

            if (IsLaunchJsonPath(candidate) || IsPackageJsonPath(candidate))
            {
                string activeDocument = GetPreferredSmallBasicDocument();
                if (!string.IsNullOrEmpty(activeDocument))
                {
                    return activeDocument;
                }
            }

            if (HasSmallBasicProgramExtension(resolvedTarget))
            {
                return resolvedTarget;
            }

            return candidate;
        }

        private static string ResolvePathCandidate(IWorkspace workspaceContext, string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return string.Empty;
            }

            if (!Path.IsPathRooted(path) && workspaceContext != null)
            {
                path = workspaceContext.MakeRooted(path);
            }

            return path;
        }

        private static bool IsSmallBasicLaunchConfiguration(ProjectConfiguration? projectConfiguration)
        {
            string type = projectConfiguration?.LaunchSettings?.GetValue("type", string.Empty) ?? string.Empty;
            if (string.Equals(type, "smallbasic", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            string configurationName = projectConfiguration?.LaunchSettings?.GetValue("name", string.Empty) ?? string.Empty;
            return IsSmallBasicProfileName(configurationName);
        }

        private static bool IsSmallBasicProfileName(string configurationName)
            => configurationName.StartsWith("SmallBasic:", StringComparison.OrdinalIgnoreCase)
                || configurationName.StartsWith("SmallBasic [", StringComparison.OrdinalIgnoreCase);

        private static bool IsCurrentDocumentProfileName(string configurationName)
            => IsSmallBasicProfileName(configurationName)
                && configurationName.IndexOf("current file", StringComparison.OrdinalIgnoreCase) >= 0;

        private static bool HasSmallBasicProgramExtension(string filePath)
            => string.Equals(Path.GetExtension(filePath), ".sb", StringComparison.OrdinalIgnoreCase);

        private static bool IsLaunchJsonPath(string targetFilePath)
        {
            if (!string.Equals(Path.GetExtension(targetFilePath), ".json", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            string fileName = Path.GetFileName(targetFilePath);
            if (string.Equals(fileName, "launch.vs.json", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return string.Equals(fileName, "launch.json", StringComparison.OrdinalIgnoreCase)
                && string.Equals(Path.GetFileName(Path.GetDirectoryName(targetFilePath)), ".vscode", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsPackageJsonPath(string targetFilePath)
            => string.Equals(Path.GetFileName(targetFilePath), "package.json", StringComparison.OrdinalIgnoreCase);

        private static string GetPreferredSmallBasicDocument()
        {
            try
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                if (!(Package.GetGlobalService(typeof(SDTE)) is EnvDTE.DTE dte))
                {
                    return GetRememberedSmallBasicDocumentPath();
                }

                if (TryGetSmallBasicDocumentPath(dte.ActiveDocument, out string activeDocument))
                {
                    return activeDocument;
                }

                string rememberedDocument = GetRememberedSmallBasicDocumentPath();
                if (!string.IsNullOrEmpty(rememberedDocument))
                {
                    return rememberedDocument;
                }

                var openSmallBasicDocuments = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (EnvDTE.Document document in dte.Documents)
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
                        return documentPath;
                    }
                }
            }
            catch
            {
                // DTE unavailable or no active document: fall through with no path.
            }

            return string.Empty;
        }

        private static string GetRememberedSmallBasicDocumentPath()
        {
            string rememberedDocument = SmallBasicCommandService.LastFocusedSmallBasicDocumentPath;
            return !string.IsNullOrWhiteSpace(rememberedDocument) && File.Exists(rememberedDocument)
                ? rememberedDocument
                : string.Empty;
        }

        private static bool TryGetSmallBasicDocumentPath(EnvDTE.Document document, out string documentPath)
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
