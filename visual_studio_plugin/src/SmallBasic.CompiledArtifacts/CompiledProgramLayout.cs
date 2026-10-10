namespace SmallBasic.CompiledArtifacts;

using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public sealed class CompiledProgramManifest
{
    public int SchemaVersion { get; set; } = CompiledProgramLayout.CurrentSchemaVersion;

    public string Runtime { get; set; } = string.Empty;

    public string ProgramFile { get; set; } = string.Empty;

    public string SourceHash { get; set; } = string.Empty;

    public bool UsesGraphics { get; set; }

    public bool Debuggable { get; set; } = true;

    public string[] Capabilities { get; set; } = System.Array.Empty<string>();
}

public sealed class CompiledProgramArtifact
{
    public CompiledProgramArtifact(string executablePath, string manifestPath, string sourcePath)
    {
        this.ExecutablePath = Path.GetFullPath(executablePath);
        this.ManifestPath = Path.GetFullPath(manifestPath);
        this.SourcePath = Path.GetFullPath(sourcePath);
    }

    public string ExecutablePath { get; }

    public string ManifestPath { get; }

    public string SourcePath { get; }

    public string OutputDirectory => Path.GetDirectoryName(this.ExecutablePath) ?? string.Empty;

    public string ProgramBaseName => Path.GetFileNameWithoutExtension(this.ExecutablePath);
}

public static class CompiledProgramLayout
{
    public const int CurrentSchemaVersion = 1;

    public const string ManifestSuffix = ".smallbasic.json";

    public const string SourceSuffix = ".smallbasic.source";

    /// <summary>
    /// Subfolder of an artifact that holds the runtime support assemblies. The
    /// entry point resolves them through the 'probing privatePath' that the
    /// generated entry configuration declares, so the artifact root only shows
    /// the entry point, its configuration and the program sidecars.
    /// </summary>
    public const string SupportFolderName = "lib";

    /// <summary>
    /// Name of the template's entry point and entry configuration inside the
    /// compiler payload (<c>runhost\compiler\template\net48</c>).
    /// </summary>
    public const string TemplateExecutableFileName = "SmallBasic.RunHost.exe";

    /// <summary>
    /// Name of the template's entry configuration; it is renamed next to
    /// <see cref="TemplateExecutableFileName"/> and gains the support-folder
    /// probing path.
    /// </summary>
    public const string TemplateConfigurationFileName = "SmallBasic.RunHost.exe.config";

    public static CompiledProgramArtifact ForSourceProgram(string sourcePath, string? outputDirectory = null)
    {
        string fullSourcePath = Path.GetFullPath(sourcePath);
        string targetDirectory = Path.GetFullPath(outputDirectory ?? (Path.GetDirectoryName(fullSourcePath) ?? string.Empty));
        string baseName = Path.GetFileNameWithoutExtension(fullSourcePath);
        return new CompiledProgramArtifact(
            Path.Combine(targetDirectory, $"{baseName}.exe"),
            Path.Combine(targetDirectory, $"{baseName}{ManifestSuffix}"),
            Path.Combine(targetDirectory, $"{baseName}{SourceSuffix}"));
    }

    public static CompiledProgramArtifact ForExecutable(string executablePath)
    {
        string fullExecutablePath = Path.GetFullPath(executablePath);
        string directory = Path.GetDirectoryName(fullExecutablePath) ?? string.Empty;
        string baseName = Path.GetFileNameWithoutExtension(fullExecutablePath);
        return new CompiledProgramArtifact(
            fullExecutablePath,
            Path.Combine(directory, $"{baseName}{ManifestSuffix}"),
            Path.Combine(directory, $"{baseName}{SourceSuffix}"));
    }

    public static CompiledProgramManifest LoadManifest(string manifestPath)
    {
        string json = File.ReadAllText(manifestPath, Encoding.UTF8);
        CompiledProgramManifest? manifest = JsonSerializer.Deserialize<CompiledProgramManifest>(json);
        if (manifest is null)
        {
            throw new InvalidDataException($"Compiled program manifest is empty: {manifestPath}");
        }

        if (manifest.SchemaVersion != CurrentSchemaVersion)
        {
            throw new InvalidDataException(
                $"Unsupported compiled program manifest schema {manifest.SchemaVersion} in {manifestPath}. " +
                $"Expected {CurrentSchemaVersion}.");
        }

        if (string.IsNullOrWhiteSpace(manifest.ProgramFile))
        {
            throw new InvalidDataException($"Compiled program manifest has no programFile: {manifestPath}");
        }

        if (string.IsNullOrWhiteSpace(manifest.SourceHash))
        {
            throw new InvalidDataException($"Compiled program manifest has no sourceHash: {manifestPath}");
        }

        return manifest;
    }

    public static void SaveManifest(string manifestPath, CompiledProgramManifest manifest)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(manifestPath)) ?? string.Empty);
        string json = JsonSerializer.Serialize(
            manifest,
            new JsonSerializerOptions
            {
                WriteIndented = true,
            });
        File.WriteAllText(manifestPath, json, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    public static string ComputeSourceHash(string sourceText)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(sourceText);
        using var sha256 = SHA256.Create();
        byte[] hash = sha256.ComputeHash(bytes);
        return string.Concat(hash.Select(value => value.ToString("x2")));
    }

    public static bool SourceMatchesManifest(string sourceText, CompiledProgramManifest manifest)
        => string.Equals(ComputeSourceHash(sourceText), manifest.SourceHash, StringComparison.OrdinalIgnoreCase);
}
