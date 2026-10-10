using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using SmallBasic.CompiledArtifacts;
using SmallBasic.Compiler;

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;

if (!TryParseArguments(args, out CompileRequest? request, out string usageOrError))
{
    Console.Error.WriteLine(usageOrError);
    Environment.Exit(1);
    return;
}

if (request is null)
{
    Console.WriteLine("{\"protocolVersion\":1,\"capabilities\":[\"compile-net48-v1\"]}");
    return;
}

try
{
    int exitCode = Compile(request);
    Environment.Exit(exitCode);
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    Environment.Exit(2);
}

static int Compile(CompileRequest request)
{
    string sourcePath = Path.GetFullPath(request.FilePath);
    if (!File.Exists(sourcePath))
    {
        Console.Error.WriteLine($"SmallBasic source file not found: {sourcePath}");
        return 1;
    }

    string source = File.ReadAllText(sourcePath, Encoding.UTF8);
    var compilation = new SmallBasicCompilation(source);
    if (compilation.Diagnostics.Count > 0)
    {
        foreach (var diagnostic in compilation.Diagnostics)
        {
            Console.Error.WriteLine(diagnostic.ToDisplayString());
        }

        return 1;
    }

    var artifact = CompiledProgramLayout.ForSourceProgram(sourcePath, request.OutputDirectory);
    string templateDirectory = ResolveTemplateDirectory();
    if (!Directory.Exists(templateDirectory))
    {
        Console.Error.WriteLine(
            $"The compiler payload template was not found: {templateDirectory}. " +
            "Build runhost\\Build-RunHost.ps1 first so runhost\\compiler\\template\\net48 is available.");
        return 2;
    }

    Directory.CreateDirectory(artifact.OutputDirectory);
    CopyTemplatePayload(templateDirectory, artifact);
    File.WriteAllText(artifact.SourcePath, source, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

    var manifest = new CompiledProgramManifest
    {
        Runtime = "net48",
        ProgramFile = Path.GetFileName(artifact.SourcePath),
        SourceHash = CompiledProgramLayout.ComputeSourceHash(source),
        UsesGraphics = compilation.Analysis.UsesGraphicsWindow,
        Debuggable = true,
        Capabilities = new[] { "function-v1", "gosub-v1", "error-handling-v1" },
    };
    CompiledProgramLayout.SaveManifest(artifact.ManifestPath, manifest);

    Console.WriteLine($"Compiled Small Basic program: {artifact.ExecutablePath}");
    Console.WriteLine($"Staged runtime support assemblies in: {Path.Combine(artifact.OutputDirectory, CompiledProgramLayout.SupportFolderName)}");
    return 0;
}

static string ResolveTemplateDirectory()
{
    return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "template", "net48"));
}

/// <summary>
/// Lays the compiler template out as the distributable artifact: the entry point
/// (renamed to the program name), its configuration - rewritten with the support
/// folder's probing path - and the program sidecars stay in the artifact root,
/// while every runtime support assembly moves into
/// <see cref="CompiledProgramLayout.SupportFolderName"/>.
/// </summary>
static void CopyTemplatePayload(string templateDirectory, CompiledProgramArtifact artifact)
{
    bool entryConfigurationStaged = false;
    foreach (string sourceFile in Directory.EnumerateFiles(templateDirectory, "*", SearchOption.AllDirectories))
    {
        if (Path.GetExtension(sourceFile).Equals(".pdb", StringComparison.OrdinalIgnoreCase))
        {
            continue;
        }

        string relativePath = MakeRelativePath(templateDirectory, sourceFile);
        if (relativePath.Equals(CompiledProgramLayout.TemplateExecutableFileName, StringComparison.OrdinalIgnoreCase))
        {
            CopyPayloadFile(sourceFile, Path.Combine(artifact.OutputDirectory, $"{artifact.ProgramBaseName}.exe"));
            continue;
        }

        if (relativePath.Equals(CompiledProgramLayout.TemplateConfigurationFileName, StringComparison.OrdinalIgnoreCase))
        {
            WriteEntryConfiguration(
                Path.Combine(artifact.OutputDirectory, $"{artifact.ProgramBaseName}.exe.config"),
                File.ReadAllText(sourceFile));
            entryConfigurationStaged = true;
            continue;
        }

        CopyPayloadFile(
            sourceFile,
            Path.Combine(artifact.OutputDirectory, DestinationRelativePath(relativePath, sourceFile)));
    }

    if (!entryConfigurationStaged)
    {
        WriteEntryConfiguration(
            Path.Combine(artifact.OutputDirectory, $"{artifact.ProgramBaseName}.exe.config"),
            "<?xml version=\"1.0\" encoding=\"utf-8\"?><configuration />");
    }

    // Support assemblies go to the support folder so the artifact root stays
    // readable; anything else keeps the template's relative path.
    static string DestinationRelativePath(string relativePath, string sourceFile)
        => Path.GetExtension(sourceFile).Equals(".dll", StringComparison.OrdinalIgnoreCase)
            ? Path.Combine(CompiledProgramLayout.SupportFolderName, Path.GetFileName(sourceFile))
            : relativePath;

    static void CopyPayloadFile(string sourceFile, string destinationPath)
    {
        string? destinationDirectory = Path.GetDirectoryName(destinationPath);
        if (!string.IsNullOrEmpty(destinationDirectory))
        {
            Directory.CreateDirectory(destinationDirectory);
        }

        File.Copy(sourceFile, destinationPath, overwrite: true);
    }

    static string MakeRelativePath(string root, string filePath)
    {
        string normalizedRoot = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var rootUri = new Uri(normalizedRoot, UriKind.Absolute);
        var fileUri = new Uri(filePath, UriKind.Absolute);
        return Uri.UnescapeDataString(rootUri.MakeRelativeUri(fileUri).ToString())
            .Replace('/', Path.DirectorySeparatorChar);
    }
}

/// <summary>
/// Writes the entry point's configuration, adding the private probing path that
/// makes the support assemblies in <see cref="CompiledProgramLayout.SupportFolderName"/>
/// resolvable. The template's binding redirects and startup settings are kept.
/// </summary>
static void WriteEntryConfiguration(string destinationPath, string configurationText)
{
    XDocument document = XDocument.Parse(configurationText);
    XElement root = document.Root
        ?? throw new InvalidDataException("The compiler template entry configuration has no root element.");

    XElement runtime = root.Element("runtime") ?? new XElement("runtime");
    if (runtime.Parent is null)
    {
        root.Add(runtime);
    }

    // <probing> is only honored inside <assemblyBinding> (the namespace matches
    // the binding redirects below); a probing element directly under <runtime>
    // is accepted by the parser but ignored by the loader, which then fails to
    // find every support assembly.
    XNamespace bindingNamespace = "urn:schemas-microsoft-com:asm.v1";
    XElement? probing = runtime.Descendants(bindingNamespace + "probing").FirstOrDefault();
    if (probing is null)
    {
        runtime.AddFirst(
            new XElement(
                bindingNamespace + "assemblyBinding",
                new XElement(
                    bindingNamespace + "probing",
                    new XAttribute("privatePath", CompiledProgramLayout.SupportFolderName))));
    }
    else
    {
        probing.SetAttributeValue("privatePath", CompiledProgramLayout.SupportFolderName);
    }

    string? destinationDirectory = Path.GetDirectoryName(destinationPath);
    if (!string.IsNullOrEmpty(destinationDirectory))
    {
        Directory.CreateDirectory(destinationDirectory);
    }

    var settings = new XmlWriterSettings
    {
        Indent = true,
        Encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
    };
    using FileStream stream = File.Create(destinationPath);
    using XmlWriter writer = XmlWriter.Create(stream, settings);
    document.Save(writer);
}

static bool TryParseArguments(string[] args, out CompileRequest? request, out string usageOrError)
{
    request = null;
    usageOrError =
        "Usage: SmallBasic.Compiler.Tool compile --file <program.sb> [--outputDir <directory>] | " +
        "SmallBasic.Compiler.Tool --capabilities";

    if (args.Length == 1 && string.Equals(args[0], "--capabilities", StringComparison.OrdinalIgnoreCase))
    {
        usageOrError = string.Empty;
        return true;
    }

    if (args.Length < 3 || !string.Equals(args[0], "compile", StringComparison.OrdinalIgnoreCase))
    {
        return false;
    }

    string? file = null;
    string? outputDirectory = null;
    for (int i = 1; i < args.Length; i++)
    {
        string current = args[i];
        if (string.Equals(current, "--file", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
        {
            file = args[++i];
            continue;
        }

        if ((string.Equals(current, "--outputDir", StringComparison.OrdinalIgnoreCase)
                || string.Equals(current, "--output", StringComparison.OrdinalIgnoreCase))
            && i + 1 < args.Length)
        {
            outputDirectory = args[++i];
            continue;
        }
    }

    if (string.IsNullOrWhiteSpace(file))
    {
        usageOrError = "Missing required --file <program.sb> argument.";
        return false;
    }

    request = new CompileRequest(file, outputDirectory);
    usageOrError = string.Empty;
    return true;
}

sealed class CompileRequest
{
    public CompileRequest(string filePath, string? outputDirectory)
    {
        this.FilePath = filePath;
        this.OutputDirectory = string.IsNullOrWhiteSpace(outputDirectory)
            ? null
            : Path.GetFullPath(outputDirectory);
    }

    public string FilePath { get; }

    public string? OutputDirectory { get; }
}
