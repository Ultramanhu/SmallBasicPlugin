namespace SmallBasic.Tests
{
    using System.IO;
    using System.Threading.Tasks;
    using FluentAssertions;
    using SmallBasic.Compiler;
    using SmallBasic.RunHost.Libraries;
    using Xunit;

    // Conditional breakpoints are evaluated by compiling a standalone expression
    // and running it against the paused engine, so these tests exercise the
    // compiler API that makes that possible.
    public sealed class CompilerConditionalExpressionTests
    {
        [Fact]
        public void RejectsExpressionsThatDoNotCompile()
        {
            var compilation = new SmallBasicCompilation("i = 5\n");

            compilation.CompileExpression("i = = 5").Should().BeNull();
            compilation.CompileExpression(string.Empty).Should().BeNull();
            compilation.CompileExpression("   ").Should().BeNull();
        }

        [Fact]
        public async Task EvaluatesConditionsAgainstCurrentMemory()
        {
            var compilation = new SmallBasicCompilation("i = 5\nx = i > 3\n");
            SmallBasicEngine engine = await PauseOnSecondLineAsync(compilation).ConfigureAwait(false);

            (await engine.EvaluateConditionAsync(compilation.CompileExpression("i = 5")).ConfigureAwait(false)).Should().Be(true);
            (await engine.EvaluateConditionAsync(compilation.CompileExpression("i > 10")).ConfigureAwait(false)).Should().Be(false);
        }

        [Fact]
        public async Task EvaluatesCompoundConditions()
        {
            var compilation = new SmallBasicCompilation("i = 5\nx = i > 3\n");
            SmallBasicEngine engine = await PauseOnSecondLineAsync(compilation).ConfigureAwait(false);

            (await engine.EvaluateConditionAsync(compilation.CompileExpression("i >= 5 And i <= 5")).ConfigureAwait(false)).Should().Be(true);
            (await engine.EvaluateConditionAsync(compilation.CompileExpression("i < 1 Or i = 5")).ConfigureAwait(false)).Should().Be(true);
            (await engine.EvaluateConditionAsync(compilation.CompileExpression("i < 1 And i = 5")).ConfigureAwait(false)).Should().Be(false);
        }

        [Fact]
        public async Task UndefinedVariablesEvaluateToEmptyString()
        {
            var compilation = new SmallBasicCompilation("i = 5\nx = i > 3\n");
            SmallBasicEngine engine = await PauseOnSecondLineAsync(compilation).ConfigureAwait(false);

            (await engine.EvaluateConditionAsync(compilation.CompileExpression("missing = 5")).ConfigureAwait(false)).Should().Be(false);
        }

        [Fact]
        public async Task EvaluationLeavesEngineStateUntouched()
        {
            var compilation = new SmallBasicCompilation("i = 5\nx = i > 3\n");
            SmallBasicEngine engine = await PauseOnSecondLineAsync(compilation).ConfigureAwait(false);

            int memoryBefore = engine.GetSnapshot().Memory.Count;
            int stackBefore = engine.GetSnapshot().ExecutionStack.Count;

            await engine.EvaluateConditionAsync(compilation.CompileExpression("i = 5")).ConfigureAwait(false);

            var snapshot = engine.GetSnapshot();
            engine.State.Should().Be(ExecutionState.Paused);
            snapshot.Memory.Count.Should().Be(memoryBefore, "the synthetic result variable must be cleaned up");
            snapshot.Memory.Should().ContainKey("i");
            snapshot.ExecutionStack.Count.Should().Be(stackBefore);
        }

        private static async Task<SmallBasicEngine> PauseOnSecondLineAsync(SmallBasicCompilation compilation)
        {
            compilation.Diagnostics.Should().BeEmpty();

            var engine = new SmallBasicEngine(compilation, new RuntimeLibrariesCollection(TextReader.Null, TextWriter.Null))
            {
                Mode = ExecutionMode.NextLine,
            };

            await engine.Execute().ConfigureAwait(false);
            engine.State.Should().Be(ExecutionState.Paused);
            return engine;
        }
    }
}
