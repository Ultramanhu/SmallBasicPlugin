namespace SmallBasic.Tests.Runtime
{
    using System;
    using System.Collections.Generic;
    using System.Globalization;
    using System.IO;
    using System.Linq;
    using System.Text.Json;
    using System.Threading.Tasks;
    using FluentAssertions;
    using SmallBasic.Compiler;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.RunHost.Libraries;
    using Xunit;

    public sealed class LanguageExtensionConformanceTests : IClassFixture<CultureFixture>
    {
        /*
         * The corpus is shared with the TypeScript runner (smallbasic-lang-core) and covers the
         * Language Extension v1 contract as well as the unified core runtime semantics
         * (text folding, operators, comparisons, arrays, Math, Text, branches, Program.End).
         */
        [Fact]
        public async Task CSharpRuntimeMatchesTheSharedConformanceCorpus()
        {
            string path = Path.Combine(AppContext.BaseDirectory, "Conformance", "cases.json");
            ConformanceCase[] cases = JsonSerializer.Deserialize<ConformanceCase[]>(
                File.ReadAllText(path),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidDataException("The shared conformance corpus is empty.");

            foreach (ConformanceCase testCase in cases)
            {
                string source = string.Join("\n", testCase.Source);
                var compilation = new SmallBasicCompilation(source);
                string[] diagnosticNames = compilation.Diagnostics
                    .Select(diagnostic => diagnostic.Code.ToString())
                    .ToArray();

                if (testCase.Diagnostics is { })
                {
                    diagnosticNames.Should().Contain(testCase.Diagnostics, testCase.Name);
                    continue;
                }

                diagnosticNames.Should().BeEmpty(testCase.Name);
                using var output = new StringWriter(CultureInfo.InvariantCulture);
                using var libraries = new RuntimeLibrariesCollection(TextReader.Null, output);
                var engine = new SmallBasicEngine(compilation, libraries);
                while (engine.State != ExecutionState.Terminated)
                {
                    await engine.Execute().ConfigureAwait(false);
                }

                string normalizedOutput = output.ToString().Replace("\r\n", "\n").TrimEnd('\n');
                string[] actualLines = normalizedOutput.Length == 0
                    ? Array.Empty<string>()
                    : normalizedOutput.Split('\n');
                actualLines.Should().Equal(testCase.Stdout, testCase.Name);

                if (testCase.RuntimeError is { } runtimeError)
                {
                    // An unhandled runtime error terminates the program; nothing
                    // else is printed (the host mirrors LastError to stderr).
                    engine.State.Should().Be(ExecutionState.Terminated, testCase.Name);
                    engine.LastError.Should().NotBeNull(testCase.Name);
                    engine.LastError.Code.Should().Be(runtimeError.Code, testCase.Name);
                    engine.LastError.Message.Should().Be(runtimeError.Message, testCase.Name);
                }
                else
                {
                    engine.LastError.Should().BeNull(testCase.Name);
                }

                DebuggerSnapshot snapshot = engine.GetSnapshot();
                foreach (KeyValuePair<string, string> expected in testCase.Globals ?? new Dictionary<string, string>())
                {
                    snapshot.Memory.Should().ContainKey(expected.Key, testCase.Name);
                    snapshot.Memory[expected.Key].ToDisplayString().Should().Be(expected.Value, testCase.Name);
                }
            }
        }

        private sealed class ConformanceCase
        {
            public string Name { get; set; } = string.Empty;

            public string[] Source { get; set; } = Array.Empty<string>();

            public List<string> Stdout { get; set; } = new List<string>();

            public Dictionary<string, string>? Globals { get; set; }

            public List<string>? Diagnostics { get; set; }

            public RuntimeErrorCase? RuntimeError { get; set; }
        }

        private sealed class RuntimeErrorCase
        {
            public int Code { get; set; }

            public string Message { get; set; } = string.Empty;
        }
    }
}
