namespace SmallBasic.Vsix.Workspace
{
    using System;
    using System.IO;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
    using Microsoft.VisualStudio.Workspace;
    using Microsoft.VisualStudio.Workspace.Debug;
    using SmallBasic.Vsix.Commands;

    /// <summary>
    /// Registers the "smallbasic" launch type with the Open Folder machinery so
    /// .vscode/launch.json configurations of that type become launchable debug
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
            if (launchSettings.GetValue("backend", string.Empty).Length == 0)
            {
                ((IDictionary<string, object>)launchSettings)["backend"] = "csharp";
            }
        }
    }

    /// <summary>
    /// Handles Open Folder debug targets for Small Basic. Launch configurations
    /// whose type is "smallbasic" (.vscode/launch.json) carry the backend to use;
    /// the auto-generated "current document" target for .sb files falls back to
    /// the C# backend. Launching reuses the shared per-backend adapter launcher.
    /// </summary>
    [ExportLaunchDebugTarget(
        LaunchDebugTargetProviderOptions.IsRuntimeSupportContext,
        ProviderType,
        new[] { ".sb" },
        ProviderPriority.Normal)]
    internal sealed class SmallBasicLaunchDebugTargetProvider : ILaunchDebugTargetProvider2
    {
        private const string ProviderType = "6E4F2A91-7C3B-4D58-9A1E-2B5D8F0C3E47";

        public bool SupportsContext(IWorkspace workspaceContext, string targetFilePath)
        {
            bool supported = string.Equals(Path.GetExtension(targetFilePath), ".sb", StringComparison.OrdinalIgnoreCase);
            Services.SmallBasicDiagnostics.Write($"[launch provider] SupportsContext path='{targetFilePath}' supported={supported}");
            return supported;
        }

        public bool SupportsProjectConfiguration(IWorkspace workspace, ProjectConfiguration projectConfiguration)
        {
            string type = projectConfiguration?.LaunchSettings?.GetValue("type", string.Empty) ?? string.Empty;
            Services.SmallBasicDiagnostics.Write($"[launch provider] SupportsProjectConfiguration type='{type}' name='{projectConfiguration?.LaunchSettings?.GetValue("name", string.Empty)}'");
            return string.Equals(type, "smallbasic", StringComparison.OrdinalIgnoreCase);
        }

        public void LaunchDebugTarget(IWorkspace workspaceContext, IServiceProvider serviceProvider, DebugLaunchActionContext debugLaunchActionContext)
        {
            IPropertySettings launchConfiguration = debugLaunchActionContext.LaunchConfiguration;
            string program = launchConfiguration.GetValue("program", string.Empty);
            Services.SmallBasicDiagnostics.Write($"[launch provider] LaunchDebugTarget backend='{launchConfiguration.GetValue("backend", string.Empty)}' program='{program}' name='{launchConfiguration.GetValue("name", string.Empty)}'");
            if (string.IsNullOrEmpty(program))
            {
                program = launchConfiguration.GetValue("target", string.Empty);
            }

            SmallBasicBackend backend = ParseBackend(launchConfiguration.GetValue("backend", string.Empty));
            bool stopOnEntry = launchConfiguration.GetValue("stopOnEntry", false);

            // The workspace machinery may invoke this on a background thread;
            // DTE access and the launch itself require the main thread.
            ThreadHelper.JoinableTaskFactory.Run(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                string resolvedProgram = this.ResolveProgramPath(workspaceContext, program);
                if (string.IsNullOrEmpty(resolvedProgram) || !File.Exists(resolvedProgram))
                {
                    System.Windows.MessageBox.Show(
                        $"找不到要调试的 Small Basic 程序文件：{resolvedProgram}",
                        "Small Basic",
                        System.Windows.MessageBoxButton.OK,
                        System.Windows.MessageBoxImage.Error);
                    return;
                }

                SmallBasicCommandService.Debug(Path.GetFullPath(resolvedProgram), backend, stopOnEntry);
            });
        }

        private static SmallBasicBackend ParseBackend(string backend)
        {
            if (string.Equals(backend, "javascript", StringComparison.OrdinalIgnoreCase))
            {
                return SmallBasicBackend.JavaScript;
            }

            if (string.Equals(backend, "blazor", StringComparison.OrdinalIgnoreCase))
            {
                return SmallBasicBackend.Blazor;
            }

            return SmallBasicBackend.CSharp;
        }

        private string ResolveProgramPath(IWorkspace workspaceContext, string program)
        {
            // "${file}" is a VS Code variable that Visual Studio's launch
            // configuration pipeline does not evaluate; resolve it against the
            // active document, matching what the configs in .vscode/launch.json
            // express.
            if (string.IsNullOrEmpty(program) || program.IndexOf("${file}", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                string activeDocument = this.GetActiveSmallBasicDocument();
                if (string.IsNullOrEmpty(program))
                {
                    return activeDocument;
                }

                program = program.Replace("${file}", activeDocument ?? string.Empty);
            }

            if (!Path.IsPathRooted(program) && workspaceContext != null)
            {
                program = workspaceContext.MakeRooted(program);
            }

            return program;
        }

        private string GetActiveSmallBasicDocument()
        {
            try
            {
                if (Package.GetGlobalService(typeof(SDTE)) is EnvDTE.DTE dte
                    && dte.ActiveDocument != null
                    && string.Equals(Path.GetExtension(dte.ActiveDocument.FullName), ".sb", StringComparison.OrdinalIgnoreCase))
                {
                    dte.ActiveDocument.Save();
                    return Path.GetFullPath(dte.ActiveDocument.FullName);
                }
            }
            catch
            {
                // DTE unavailable or no active document: fall through with no path.
            }

            return string.Empty;
        }
    }
}
