namespace SmallBasic.Tests.Runtime
{
    using System.Linq;
    using System.Threading.Tasks;
    using FluentAssertions;
    using SmallBasic.Compiler;
    using SmallBasic.Compiler.Diagnostics;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Compiler.Services;
    using Xunit;

    public sealed class LanguageExtensionTests : IClassFixture<CultureFixture>
    {
        [Fact]
        public async Task ItPassesArgumentsAndReturnsAValue()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Function Add(Left, Right)
  Dim Result
  Result = Left + Right
  Return Result
EndFunction

answer = Add(20, 22)").VerifyRealRuntime().ConfigureAwait(false);

            engine.GetSnapshot().Memory["answer"].ToDisplayString().Should().Be("42");
            engine.GetSnapshot().Memory.Keys.Should().NotContain(new[] { "Left", "Right", "Result" });
        }

        [Fact]
        public async Task ItSupportsRecursiveFunctionsWithIsolatedFrames()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Function Factorial(N)
  If N = 0 Then
    Return 1
  EndIf
  Return N * Factorial(N - 1)
EndFunction

answer = Factorial(6)").VerifyRealRuntime().ConfigureAwait(false);

            engine.GetSnapshot().Memory["answer"].ToDisplayString().Should().Be("720");
        }

        [Fact]
        public async Task ItKeepsDimVariablesLocalAndUndeclaredVariablesGlobal()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Function Next(Value)
  Dim Local
  Local = Value
  Counter = Counter + 1
  Return Local
EndFunction

first = Next(10)
second = Next(20)").VerifyRealRuntime().ConfigureAwait(false);

            DebuggerSnapshot snapshot = engine.GetSnapshot();
            snapshot.Memory["first"].ToDisplayString().Should().Be("10");
            snapshot.Memory["second"].ToDisplayString().Should().Be("20");
            snapshot.Memory["Counter"].ToDisplayString().Should().Be("2");
            snapshot.Memory.Keys.Should().NotContain(new[] { "Value", "Local" });
        }

        [Fact]
        public async Task ReachingEndFunctionProducesTheEmptyValue()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Function Empty()
  Dim Local
  Local = 1
EndFunction

answer = Empty()").VerifyRealRuntime().ConfigureAwait(false);

            engine.GetSnapshot().Memory["answer"].ToDisplayString().Should().BeEmpty();
        }

        [Fact]
        public async Task ArrayArgumentsPreserveAliasingButParameterReassignmentStaysLocal()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Function Change(Item)
  Item[""changed""] = ""yes""
  Item = ""local replacement""
  Return Item
EndFunction

source[""initial""] = ""value""
returned = Change(source)
observed = source[""changed""]").VerifyRealRuntime().ConfigureAwait(false);

            DebuggerSnapshot snapshot = engine.GetSnapshot();
            snapshot.Memory["returned"].ToDisplayString().Should().Be("local replacement");
            snapshot.Memory["observed"].ToDisplayString().Should().Be("yes");
        }

        [Theory]
        [InlineData("Return 1", DiagnosticCode.ReturnOutsideFunction)]
        [InlineData("Function F(A, A)\nReturn A\nEndFunction", DiagnosticCode.DuplicateParameter)]
        [InlineData("Function F(A)\nDim A\nReturn A\nEndFunction", DiagnosticCode.DuplicateLocalVariable)]
        [InlineData("Function F(A)\nReturn A\nEndFunction\nx = F()", DiagnosticCode.UnexpectedArgumentsCount)]
        [InlineData("Function Math()\nReturn 1\nEndFunction", DiagnosticCode.ProcedureConflictsWithLibrary)]
        [InlineData("Sub Outer\nFunction Inner()\nReturn 1\nEndFunction\nEndSub", DiagnosticCode.CannotDefineProcedureInsideProcedure)]
        public void ItReportsInvalidFunctionAndScopeUsage(string source, DiagnosticCode expected)
        {
            var compilation = new SmallBasicCompilation(source);

            compilation.Diagnostics.Select(diagnostic => diagnostic.Code).Should().Contain(expected);
        }

        [Fact]
        public void ItProvidesFunctionCompletionSignatureAndOutlineInformation()
        {
            string source = "Function Add(Left, Right)\n  Dim Result\n  Return Left + Right\nEndFunction\nanswer = Ad";
            var compilation = new SmallBasicCompilation(source);

            MonacoCompletionItem completion = compilation.ProvideCompletionItems((4, 11))
                .Single(item => item.label == "Add(Left, Right)");
            completion.insertText.value.Should().Be("Add(${1:Left}, ${2:Right})");

            SignatureHelp signature = SignatureHelpProvider.Provide(
                source.Replace("answer = Ad", "answer = Add(1, "),
                (4, 16));
            signature.Signatures.Single().Label.Should().Be("Add(Left, Right)");
            signature.ActiveParameter.Should().Be(1);

            OutlineItem function = compilation.GetOutlineItems().Single(item => item.Name == "Add");
            function.Kind.Should().Be(OutlineItemKind.Function);
            function.Detail.Should().Be("Function Add(Left, Right)");
            function.Children.Select(child => child.Name).Should().Equal("Left", "Right", "Result");
        }

        [Fact]
        public void ItProvidesFunctionAndLocalScopeHoverInformation()
        {
            var compilation = new SmallBasicCompilation(
                "Function Add(Left, Right)\n" +
                "  Dim Result\n" +
                "  Result = Left + Right\n" +
                "  Return Result\n" +
                "EndFunction\n" +
                "answer = Add(1, 2)");

            compilation.ProvideHover((5, 10)).Should().Equal(
                "Function Add(Left, Right)",
                "User-defined function");
            compilation.ProvideHover((2, 11)).Should().Equal(
                "Parameter Left",
                "Function-scoped parameter");
            compilation.ProvideHover((3, 10)).Should().Equal(
                "Local variable Result",
                "Procedure-scoped variable declared with Dim");
        }

        [Fact]
        public async Task DebugEvaluationUsesTheSelectedFunctionFrame()
        {
            var compilation = new SmallBasicCompilation(@"answer = Double(4)
Function Double(Value)
  Dim Local
  Local = Value * 2
  Return Local
EndFunction");
            var engine = new SmallBasicEngine(compilation, new SmallBasic.RunHost.Libraries.RuntimeLibrariesCollection())
            {
                Mode = ExecutionMode.NextLine,
            };

            await engine.Execute().ConfigureAwait(false);
            Frame frame = engine.GetSnapshot().ExecutionStack.Last();
            frame.Module.Name.Should().Be("Double");
            frame.Locals["Value"].ToDisplayString().Should().Be("4");
            frame.Locals["Local"].ToDisplayString().Should().BeEmpty();

            BaseValue value = await engine.EvaluateExpressionAsync(
                compilation.CompileExpression("Value + 1"),
                frame).ConfigureAwait(false);
            value.ToDisplayString().Should().Be("5");
            engine.GetSnapshot().Memory.Keys.Should().NotContain("__SmallBasicDebugExpression");
        }
    }
}
