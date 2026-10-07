namespace SmallBasic.LanguageServices
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Text.Json;
    using FluentAssertions;
    using Xunit;

    /// <summary>
    /// Guards the checked-in Open Folder targets that Visual Studio filters before
    /// invoking the Small Basic launch provider.
    /// </summary>
    public sealed class LaunchConfigurationTests
    {
        [Theory]
        [InlineData("launch.vs.json")]
        [InlineData("sample/launch.vs.json")]
        public void CheckedInTargetsUseExistingSmallBasicAnchors(string relativeConfigurationPath)
        {
            string repositoryRoot = FindRepositoryRoot();
            string configurationPath = Path.Combine(repositoryRoot, relativeConfigurationPath);
            using JsonDocument document = JsonDocument.Parse(File.ReadAllText(configurationPath));
            JsonElement configurations = document.RootElement.GetProperty("configurations");
            var backends = new List<string>();
            var projectTargets = new List<string>();
            string? defaultBackend = null;

            configurations.GetArrayLength().Should().Be(3);
            foreach (JsonElement configuration in configurations.EnumerateArray())
            {
                configuration.GetProperty("type").GetString().Should().Be("smallbasic");
                configuration.GetProperty("program").GetString().Should().Be("${file}");

                // Visual Studio requires "project" to resolve to an existing file
                // before it exposes a launch.vs.json profile, so the checked-in
                // profiles anchor on a real sample program and identify themselves
                // through distinct projectTarget values.
                string project = configuration.GetProperty("project").GetString()
                    ?? throw new InvalidDataException("The launch target is missing its project anchor.");
                Path.GetExtension(project).Should().Be(".sb");

                string configurationDirectory = Path.GetDirectoryName(configurationPath)
                    ?? throw new InvalidDataException("The launch configuration has no parent directory.");
                string anchor = Path.GetFullPath(Path.Combine(configurationDirectory, project));
                File.Exists(anchor).Should().BeTrue(
                    $"Visual Studio requires the project anchor '{project}' to exist");

                string backend = configuration.GetProperty("backend").GetString()
                    ?? throw new InvalidDataException("The launch target is missing its backend.");
                string projectTarget = configuration.GetProperty("projectTarget").GetString()
                    ?? throw new InvalidDataException("The launch target is missing its projectTarget identity.");
                projectTarget.Should().Be(backend);
                if (configuration.TryGetProperty("isDefaultConfiguration", out JsonElement isDefault)
                    && isDefault.GetBoolean())
                {
                    defaultBackend.Should().BeNull("only one checked-in launch target may be the default");
                    defaultBackend = backend;
                }

                backends.Add(backend);
                projectTargets.Add(projectTarget);
            }

            backends.Should().BeEquivalentTo("javascript", "csharp", "blazor");
            defaultBackend.Should().Be("csharp");
            projectTargets.Should().OnlyHaveUniqueItems(
                "Visual Studio identifies targets by project and projectTarget, not by configuration name");
        }

        private static string FindRepositoryRoot()
        {
            for (var directory = new DirectoryInfo(AppContext.BaseDirectory);
                directory != null;
                directory = directory.Parent)
            {
                if (File.Exists(Path.Combine(directory.FullName, "launch.vs.json"))
                    && File.Exists(Path.Combine(directory.FullName, "sample", "launch.vs.json")))
                {
                    return directory.FullName;
                }
            }

            throw new DirectoryNotFoundException("Could not locate the SmallBasicPlugin repository root.");
        }
    }
}
