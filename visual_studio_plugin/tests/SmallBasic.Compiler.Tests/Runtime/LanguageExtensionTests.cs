namespace SmallBasic.Tests.Runtime
{
    using System.Globalization;
    using System.IO;
    using System.Linq;
    using System.Threading.Tasks;
    using FluentAssertions;
    using SmallBasic.Compiler;
    using SmallBasic.Compiler.Diagnostics;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Compiler.Services;
    using SmallBasic.RunHost.Libraries;
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
        [InlineData("Sub S(A, A)\nEndSub", DiagnosticCode.DuplicateParameter)]
        [InlineData("Sub S(A)\nEndSub\nS(1, 2)", DiagnosticCode.UnexpectedArgumentsCount)]
        public void ItReportsInvalidFunctionAndScopeUsage(string source, DiagnosticCode expected)
        {
            var compilation = new SmallBasicCompilation(source);

            compilation.Diagnostics.Select(diagnostic => diagnostic.Code).Should().Contain(expected);
        }

        [Fact]
        public async Task ItExecutesSubroutinesWithParameters()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Sub Accumulate(Value)
  Dim Doubled
  Doubled = Value * 2
  Total = Total + Doubled
EndSub

Total = 0
Accumulate(3)
Accumulate(4)").VerifyRealRuntime().ConfigureAwait(false);

            DebuggerSnapshot snapshot = engine.GetSnapshot();
            snapshot.Memory["Total"].ToDisplayString().Should().Be("14");
            snapshot.Memory.Keys.Should().NotContain(new[] { "Value", "Doubled" });
        }

        [Fact]
        public async Task ItCallsNoArgumentProceduresWithoutParentheses()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Counter = 0
Sub Increment
  Counter = Counter + 1
EndSub

Function Answer
  Return 42
EndFunction

Increment
Increment()
result = Answer").VerifyRealRuntime().ConfigureAwait(false);

            DebuggerSnapshot snapshot = engine.GetSnapshot();
            snapshot.Memory["Counter"].ToDisplayString().Should().Be("2");
            snapshot.Memory["result"].ToDisplayString().Should().Be("42");
        }

        [Fact]
        public async Task ItAcceptsEmptyParenthesesOnProcedureDeclarations()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Sub Ping()
  Pinged = ""yes""
EndSub

Function Zero()
  Return 0
EndFunction

Ping()
result = Zero()").VerifyRealRuntime().ConfigureAwait(false);

            DebuggerSnapshot snapshot = engine.GetSnapshot();
            snapshot.Memory["Pinged"].ToDisplayString().Should().Be("yes");
            snapshot.Memory["result"].ToDisplayString().Should().Be("0");
        }

        [Fact]
        public void ItProvidesSubroutineCompletionSignatureAndOutlineInformation()
        {
            string source = "Sub Show(Value)\n  Dim Copy\n  Copy = Value\nEndSub\nSho";
            var compilation = new SmallBasicCompilation(source);

            MonacoCompletionItem completion = compilation.ProvideCompletionItems((4, 3))
                .Single(item => item.label == "Show(Value)");
            completion.insertText.value.Should().Be("Show(${1:Value})");

            SignatureHelp signature = SignatureHelpProvider.Provide(
                "Sub Show(Value)\n  Dim Copy\n  Copy = Value\nEndSub\nShow(",
                (4, 5));
            signature.Signatures.Single().Label.Should().Be("Show(Value)");
            signature.ActiveParameter.Should().Be(0);

            OutlineItem sub = compilation.GetOutlineItems().Single(item => item.Name == "Show");
            sub.Kind.Should().Be(OutlineItemKind.Procedure);
            sub.Detail.Should().Be("Sub Show(Value)");
            sub.Children.Select(child => child.Name).Should().Equal("Value", "Copy");
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

        [Fact]
        public async Task ContinueStillRunsTheForIncrement()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Sum = 0
For I = 1 To 5
  If I = 3 Then
    Continue
  EndIf
  Sum = Sum + I
EndFor").VerifyRealRuntime().ConfigureAwait(false);

            DebuggerSnapshot snapshot = engine.GetSnapshot();
            snapshot.Memory["Sum"].ToDisplayString().Should().Be("12");
            snapshot.Memory["I"].ToDisplayString().Should().Be("6");
        }

        [Fact]
        public async Task BreakLeavesTheLoopWithoutRunningTheIncrement()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
For I = 1 To 10
  If I = 4 Then
    Break
  EndIf
EndFor").VerifyRealRuntime().ConfigureAwait(false);

            engine.GetSnapshot().Memory["I"].ToDisplayString().Should().Be("4");
        }

        [Theory]
        [InlineData("Break", DiagnosticCode.BreakOutsideLoop)]
        [InlineData("Continue", DiagnosticCode.ContinueOutsideLoop)]
        [InlineData("Sub Work\nBreak\nEndSub\nWork()", DiagnosticCode.BreakOutsideLoop)]
        [InlineData("While \"True\"\nBreak\nEndWhile\nContinue", DiagnosticCode.ContinueOutsideLoop)]
        public void ItReportsLoopControlOutsideOfALoop(string source, DiagnosticCode expected)
        {
            var compilation = new SmallBasicCompilation(source);

            compilation.Diagnostics.Select(diagnostic => diagnostic.Code).Should().Contain(expected);
        }

        [Fact]
        public void BreakAndContinueLinesAreExecutableForTheDebugger()
        {
            var compilation = new SmallBasicCompilation(
                "While \"True\"\n" +
                "  Break\n" +
                "EndWhile\n" +
                "For I = 1 To 3\n" +
                "  Continue\n" +
                "EndFor");

            compilation.Diagnostics.Should().BeEmpty();
            compilation.GetExecutableLines().Should().Contain(1).And.Contain(4);
        }

        [Fact]
        public void ItTreatsBreakAndContinueAsReservedWords()
        {
            var compilation = new SmallBasicCompilation("Break = 1");

            compilation.Diagnostics.Select(diagnostic => diagnostic.Code)
                .Should().Contain(DiagnosticCode.UnexpectedStatementInsteadOfNewLine);
        }

        [Fact]
        public void ItProvidesHoverForLoopControlKeywords()
        {
            var compilation = new SmallBasicCompilation(
                "While \"True\"\n" +
                "  Break\n" +
                "EndWhile\n" +
                "For I = 1 To 3\n" +
                "  Continue\n" +
                "EndFor");

            compilation.ProvideHover((1, 4)).Should().Equal("Break", "Exits the innermost While or For loop.");
            compilation.ProvideHover((4, 5)).Should().Equal(
                "Continue",
                "Skips to the next iteration of the innermost While or For loop. In a For loop the increment or Step still runs.");
        }

        [Fact]
        public async Task GoSubCallsAParameterlessSub()
        {
            SmallBasicEngine engine = await new SmallBasicCompilation(@"
Count = 0
GoSub Increment
GoSub Increment

Sub Increment
  Count = Count + 1
EndSub").VerifyRealRuntime().ConfigureAwait(false);

            engine.GetSnapshot().Memory["Count"].ToDisplayString().Should().Be("2");
        }

        [Theory]
        [InlineData("GoSub Nowhere", DiagnosticCode.GoSubTargetMustBeSub)]
        [InlineData("GoSub Compute\nFunction Compute()\nReturn 1\nEndFunction", DiagnosticCode.GoSubTargetMustBeParameterlessSub)]
        [InlineData("GoSub Show\nSub Show(Value)\nEndSub", DiagnosticCode.GoSubTargetMustBeParameterlessSub)]
        [InlineData("On Error GoSub Nowhere", DiagnosticCode.OnErrorHandlerMustBeSub)]
        [InlineData("On Error GoSub Handle\nSub Handle(Code)\nEndSub", DiagnosticCode.OnErrorHandlerMustAcceptCodeAndMessage)]
        [InlineData("On Error Resume Foo", DiagnosticCode.InvalidOnErrorClause)]
        [InlineData("On Error GoTo 5", DiagnosticCode.InvalidOnErrorClause)]
        [InlineData("On Error GoTo -2", DiagnosticCode.InvalidOnErrorClause)]
        [InlineData("On Error GoSub 0", DiagnosticCode.InvalidOnErrorClause)]
        [InlineData("On Error", DiagnosticCode.InvalidOnErrorClause)]
        public void ItReportsInvalidGoSubAndOnErrorTargets(string source, DiagnosticCode expected)
        {
            var compilation = new SmallBasicCompilation(source);

            compilation.Diagnostics.Select(diagnostic => diagnostic.Code).Should().Contain(expected);
        }

        [Fact]
        public void ItAcceptsAllOnErrorClausesAndKeepsOnAndErrorUsableAsNames()
        {
            var compilation = new SmallBasicCompilation(
                "GoSub Ping\n" +
                "On Error Resume Next\n" +
                "On Error GoTo -1\n" +
                "On Error GoTo 0\n" +
                "On Error GoSub Handle\n" +
                "\n" +
                "Sub Ping\n" +
                "EndSub\n" +
                "\n" +
                "Sub Handle(Code, Message)\n" +
                "EndSub");

            compilation.Diagnostics.Should().BeEmpty();

            var names = new SmallBasicCompilation(
                "On = 5\n" +
                "Error = On + 1\n" +
                "Resume = \"word\"\n" +
                "Next = Error");

            names.Diagnostics.Should().BeEmpty();
        }

        [Fact]
        public async Task OnErrorResumeNextSkipsFailingStatementsAndMirrorsThemToTheConsole()
        {
            (SmallBasicEngine engine, string output) = await RunWithConsoleAsync(@"
On Error Resume Next
TextWindow.WriteLine(""before"")
A = 4 / 0
B = 4 Mod 0
C = 4 \ 0
TextWindow.WriteLine(Math.SquareRoot(-4))
TextWindow.WriteLine(""A="" + A)
TextWindow.WriteLine(""after"")").ConfigureAwait(false);

            output.Should().Be(string.Join("\n",
                "before",
                "[Runtime Error] 1001: Divide by zero.",
                "[Runtime Error] 1001: Divide by zero.",
                "[Runtime Error] 1001: Divide by zero.",
                "[Runtime Error] 1002: Invalid math operation.",
                "A=",
                "after"));
            engine.LastError.Should().BeNull();
        }

        [Fact]
        public async Task OnErrorGoSubPassesCodeAndMessageToTheHandlerAndResumes()
        {
            (SmallBasicEngine _, string output) = await RunWithConsoleAsync(@"
On Error GoSub HandleError
TextWindow.WriteLine(""start"")
X = 1 / 0
TextWindow.WriteLine(""end"")

Sub HandleError(Code, Message)
  TextWindow.WriteLine(""ERR="" + Code)
  TextWindow.WriteLine(Message)
EndSub").ConfigureAwait(false);

            output.Should().Be(string.Join("\n",
                "start",
                "[Runtime Error] 1001: Divide by zero.",
                "ERR=1001",
                "Divide by zero.",
                "end"));
        }

        [Fact]
        public async Task OnErrorGoToZeroAndGoToMinusOneRestoreTermination()
        {
            await new SmallBasicCompilation(@"
On Error GoSub Handle
On Error GoTo 0
TextWindow.WriteLine(1 / 0)

Sub Handle(Code, Message)
EndSub").VerifyUnhandledRuntimeError(1001, "Divide by zero.").ConfigureAwait(false);

            await new SmallBasicCompilation(@"
On Error Resume Next
A = 1 / 0
On Error GoTo -1
TextWindow.WriteLine(1 / 0)").VerifyUnhandledRuntimeError(1001, "Divide by zero.").ConfigureAwait(false);
        }

        [Fact]
        public async Task ErrorsInsideTheHandlerTerminateTheProgram()
        {
            (SmallBasicEngine engine, string output) = await RunWithConsoleAsync(@"
On Error GoSub Handle
X = 1 / 0
TextWindow.WriteLine(""unreachable"")

Sub Handle(Code, Message)
  Y = 1 / 0
EndSub").ConfigureAwait(false);

            engine.LastError.Should().NotBeNull();
            engine.LastError.Code.Should().Be(1001);
            output.Should().Be("[Runtime Error] 1001: Divide by zero.");
        }

        [Fact]
        public void ItProvidesGoSubAndOnErrorCompletionsAndHovers()
        {
            var goSubCompletion = new SmallBasicCompilation("GoSu");
            goSubCompletion.ProvideCompletionItems((0, 4))
                .Single(item => item.label == "GoSub")
                .insertText.value.Should().Be("GoSub ${1:name}");

            var onErrorCompletion = new SmallBasicCompilation("On");
            string[] labels = onErrorCompletion.ProvideCompletionItems((0, 2))
                .Select(item => item.label)
                .Where(label => label.StartsWith("On Error", StringComparison.Ordinal))
                .ToArray();
            labels.Should().Contain(new[]
            {
                "On Error Resume Next",
                "On Error GoTo -1",
                "On Error GoTo 0",
                "On Error GoSub",
            });

            var compilation = new SmallBasicCompilation(
                "On Error GoSub Handle\n" +
                "GoSub Ping\n" +
                "\n" +
                "Sub Ping\n" +
                "EndSub\n" +
                "\n" +
                "Sub Handle(Code, Message)\n" +
                "EndSub");

            compilation.ProvideHover((0, 1)).Should().Equal(
                "On Error GoSub",
                "When a runtime error occurs, mirrors it to the console and calls the handler Sub with the error code and message; execution then resumes after the failed statement.");
            compilation.ProvideHover((0, 16)).Should().Equal(
                "Sub Handle(Code, Message)",
                "User-defined subroutine");
            compilation.ProvideHover((1, 1)).Should().Equal(
                "GoSub",
                "Calls a parameterless Sub and returns to the statement after the call.");
            compilation.ProvideHover((1, 7)).Should().Equal(
                "Sub Ping",
                "User-defined subroutine");
        }

        [Fact]
        public void GoSubAndOnErrorLinesAreExecutableForTheDebugger()
        {
            var compilation = new SmallBasicCompilation(
                "On Error GoSub Handle\n" +
                "GoSub Ping\n" +
                "\n" +
                "Sub Ping\n" +
                "EndSub\n" +
                "\n" +
                "Sub Handle(Code, Message)\n" +
                "EndSub");

            compilation.Diagnostics.Should().BeEmpty();
            compilation.GetExecutableLines().Should().Contain(0).And.Contain(1);
        }

        private static async Task<(SmallBasicEngine Engine, string Output)> RunWithConsoleAsync(string source)
        {
            using var output = new StringWriter(CultureInfo.InvariantCulture);
            using var libraries = new RuntimeLibrariesCollection(TextReader.Null, output);
            var engine = new SmallBasicEngine(new SmallBasicCompilation(source), libraries);
            while (engine.State != ExecutionState.Terminated)
            {
                await engine.Execute().ConfigureAwait(false);
            }

            return (engine, output.ToString().Replace("\r\n", "\n").TrimEnd('\n'));
        }
    }
}
