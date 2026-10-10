namespace SmallBasic.Compiler.Runtime;

using FluentAssertions;
using SmallBasic.CompiledArtifacts;
using Xunit;

public sealed class CompiledProgramLayoutTests
{
    [Fact]
    public void SourceProgramLayoutUsesProgramBaseName()
    {
        CompiledProgramArtifact artifact = CompiledProgramLayout.ForSourceProgram(
            @"C:\work\demo\hello.sb",
            @"C:\out");

        artifact.ExecutablePath.Should().Be(@"C:\out\hello.exe");
        artifact.ManifestPath.Should().Be(@"C:\out\hello.smallbasic.json");
        artifact.SourcePath.Should().Be(@"C:\out\hello.smallbasic.source");
    }

    [Fact]
    public void ExecutableLayoutUsesSiblingManifestAndSourceFiles()
    {
        CompiledProgramArtifact artifact = CompiledProgramLayout.ForExecutable(
            @"C:\out\hello.exe");

        artifact.ManifestPath.Should().Be(@"C:\out\hello.smallbasic.json");
        artifact.SourcePath.Should().Be(@"C:\out\hello.smallbasic.source");
    }

    [Fact]
    public void SourceHashRoundTripsThroughManifestComparison()
    {
        const string source = "TextWindow.WriteLine(\"Hello\")\n";
        var manifest = new CompiledProgramManifest
        {
            Runtime = "net48",
            ProgramFile = "hello.smallbasic.source",
            SourceHash = CompiledProgramLayout.ComputeSourceHash(source),
            UsesGraphics = false,
            Debuggable = true,
        };

        CompiledProgramLayout.SourceMatchesManifest(source, manifest).Should().BeTrue();
        CompiledProgramLayout.SourceMatchesManifest(source + "'", manifest).Should().BeFalse();
    }
}
