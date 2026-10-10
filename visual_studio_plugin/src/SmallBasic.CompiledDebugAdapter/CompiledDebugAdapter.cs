namespace SmallBasic.CompiledDebugAdapter;

using System.IO;
using System.Text.Json.Nodes;
using SmallBasic.CompiledArtifacts;
using SmallBasic.RunHost.Debug;

/// <summary>
/// Dedicated DAP adapter for the compiled C# backend: it validates that the
/// generated net48 artifact exists and matches the current source, then reuses
/// the standard Small Basic source-level debugging semantics.
/// </summary>
public sealed class CompiledDebugAdapter : DebugAdapter
{
    private CompiledDebugAdapter(DapStream dap)
        : base(dap)
    {
    }

    public static async Task RunAsync()
    {
        var adapter = new CompiledDebugAdapter(new DapStream(Console.OpenStandardInput(), Console.OpenStandardOutput()));
        await adapter.MessageLoopAsync().ConfigureAwait(false);
    }

    protected override LaunchProgramDescriptor? ResolveLaunchProgram(JsonObject? arguments, out string errorMessage)
    {
        LaunchProgramDescriptor? launch = base.ResolveLaunchProgram(arguments, out errorMessage);
        if (launch is null)
        {
            return null;
        }

        // The artifact normally sits next to its source program (Visual Studio
        // compiles the open .sb in place). A host that keeps the source in its
        // own scratch directory - the desktop Playground - passes the artifact
        // directory explicitly instead.
        string? artifactDirectory = (string?)arguments?["outputDirectory"];
        CompiledProgramArtifact artifact = CompiledProgramLayout.ForSourceProgram(
            launch.ProgramPath,
            string.IsNullOrWhiteSpace(artifactDirectory) ? null : artifactDirectory);
        if (!File.Exists(artifact.ExecutablePath))
        {
            errorMessage =
                $"Compiled Small Basic executable not found: {artifact.ExecutablePath}. " +
                "Compile the program before debugging with the compiled C# backend.";
            return null;
        }

        if (!File.Exists(artifact.ManifestPath))
        {
            errorMessage =
                $"Compiled Small Basic manifest not found: {artifact.ManifestPath}. " +
                "Compile the program before debugging with the compiled C# backend.";
            return null;
        }

        CompiledProgramManifest manifest;
        try
        {
            manifest = CompiledProgramLayout.LoadManifest(artifact.ManifestPath);
        }
        catch (Exception ex)
        {
            errorMessage = $"Cannot read the compiled Small Basic manifest: {ex.Message}";
            return null;
        }

        if (!File.Exists(artifact.SourcePath))
        {
            errorMessage =
                $"Compiled Small Basic source payload not found: {artifact.SourcePath}. " +
                "Recompile the program before debugging with the compiled C# backend.";
            return null;
        }

        if (!CompiledProgramLayout.SourceMatchesManifest(launch.SourceText, manifest))
        {
            errorMessage =
                "The compiled Small Basic artifact is out of date. " +
                "Recompile the program before debugging with the compiled C# backend.";
            return null;
        }

        errorMessage = string.Empty;
        return launch;
    }
}
