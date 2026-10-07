import { describe, expect, it } from "vitest";
import { Compilation, ErrorCode } from "../src/index";
import { verifyRuntimeResult, verifyUnhandledRuntimeError } from "../../../vendor/SmallBasicOnline/tests/compiler/helpers";

describe("SmallBasic language extension v1", () => {
  it("executes functions with parameters and return values", () => {
    verifyRuntimeResult([
      "Function MyFun(Arg1, Arg2, Arg3)",
      "  Dim Local1, Local2",
      "  Local1 = Arg2 + Arg3",
      "  Return Arg1 + Local1",
      "EndFunction",
      "TextWindow.WriteLine(MyFun(1, 2, 3))"
    ].join("\n"), [], ["6"]);
  });

  it("uses an independent local frame for recursive functions", () => {
    verifyRuntimeResult([
      "Function Factorial(N)",
      "  Dim Next",
      "  If N <= 1 Then",
      "    Return 1",
      "  EndIf",
      "  Next = N - 1",
      "  Return N * Factorial(Next)",
      "EndFunction",
      "TextWindow.WriteLine(Factorial(6))"
    ].join("\n"), [], ["720"]);
  });

  it("keeps undeclared procedure variables global and Dim variables local", () => {
    verifyRuntimeResult([
      "Counter = 0",
      "Increment()",
      "TextWindow.WriteLine(Counter)",
      "TextWindow.WriteLine(LocalOnly)",
      "Sub Increment",
      "  Dim LocalOnly",
      "  Counter = Counter + 1",
      "  LocalOnly = 99",
      "EndSub"
    ].join("\n"), [], ["1", ""]);
  });

  it("returns an empty string when a function reaches EndFunction", () => {
    verifyRuntimeResult([
      "Function EmptyResult()",
      "  Dim Local",
      "  Local = 1",
      "EndFunction",
      "TextWindow.WriteLine(\"[\" + EmptyResult() + \"]\")"
    ].join("\n"), [], ["[]"]);
  });

  it("passes arrays by value while preserving their referenced contents", () => {
    verifyRuntimeResult([
      "Function Update(Item)",
      "  Item[\"x\"] = 3",
      "  Item = 5",
      "  Return Item",
      "EndFunction",
      "Data[\"x\"] = 1",
      "TextWindow.WriteLine(Update(Data))",
      "TextWindow.WriteLine(Data[\"x\"])",
      "TextWindow.WriteLine(Data)"
    ].join("\n"), [], ["5", "3", "x=3;"]);
  });

  it("reports invalid scope and declaration usage", () => {
    const compilation = new Compilation([
      "Return 1",
      "Function Bad(A, a)",
      "  Dim A",
      "  If A Then",
      "    Dim Nested",
      "  EndIf",
      "  Return A",
      "EndFunction"
    ].join("\n"));

    expect(compilation.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      ErrorCode.ReturnOutsideFunction,
      ErrorCode.DuplicateParameter,
      ErrorCode.DuplicateLocalVariable,
      ErrorCode.DimMustBeAtProcedureLevel
    ]));
  });

  it("rejects parameter count mismatches and functions used as event handlers", () => {
    const compilation = new Compilation([
      "Function Handler(Value)",
      "  Return Value",
      "EndFunction",
      "Result = Handler()",
      "GraphicsWindow.KeyDown = Handler"
    ].join("\n"));

    expect(compilation.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      ErrorCode.UnexpectedArgumentsCount,
      ErrorCode.FunctionCannotBeEventHandler
    ]));
  });

  it("rejects nested procedures and names that conflict with libraries", () => {
    const nested = new Compilation([
      "Sub Outer",
      "  Function Inner()",
      "    Return 1",
      "  EndFunction",
      "EndSub"
    ].join("\n"));
    const conflict = new Compilation("Function Math()\n  Return 1\nEndFunction");

    expect(nested.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.CannotDefineProcedureInsideProcedure);
    expect(conflict.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.ProcedureConflictsWithLibrary);
  });

  it("executes subroutines with parameters", () => {
    verifyRuntimeResult([
      "Sub Greet(Name)",
      '  TextWindow.WriteLine("Hi " + Name)',
      "EndSub",
      'Greet("Ada")',
      'Greet("Lin")'
    ].join("\n"), [], ["Hi Ada", "Hi Lin"]);
  });

  it("keeps subroutine parameters and Dim locals in the call frame", () => {
    verifyRuntimeResult([
      "Total = 0",
      "Sub Accumulate(Value)",
      "  Dim Doubled",
      "  Doubled = Value * 2",
      "  Total = Total + Doubled",
      "EndSub",
      "Accumulate(3)",
      "Accumulate(4)",
      'TextWindow.WriteLine("[" + Doubled + "]")',
      "TextWindow.WriteLine(Total)"
    ].join("\n"), [], ["[]", "14"]);
  });

  it("calls a no-argument subroutine without parentheses", () => {
    verifyRuntimeResult([
      "Counter = 0",
      "Sub Increment",
      "  Counter = Counter + 1",
      "EndSub",
      "Increment",
      "Increment()",
      "TextWindow.WriteLine(Counter)"
    ].join("\n"), [], ["2"]);
  });

  it("declares and calls a no-argument function without parentheses", () => {
    verifyRuntimeResult([
      "Function Answer",
      "  Return 42",
      "EndFunction",
      "TextWindow.WriteLine(Answer)",
      "TextWindow.WriteLine(Answer())"
    ].join("\n"), [], ["42", "42"]);
  });

  it("accepts empty parentheses on procedure declarations", () => {
    verifyRuntimeResult([
      "Sub Ping()",
      '  TextWindow.WriteLine("pong")',
      "EndSub",
      "Function Zero()",
      "  Return 0",
      "EndFunction",
      "Ping()",
      "TextWindow.WriteLine(Zero())"
    ].join("\n"), [], ["pong", "0"]);
  });

  it("reports a subroutine argument count mismatch", () => {
    const compilation = new Compilation([
      "Sub Show(Value)",
      "  TextWindow.WriteLine(Value)",
      "EndSub",
      "Show(1, 2)"
    ].join("\n"));

    expect(compilation.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.UnexpectedArgumentsCount);
  });
});

describe("SmallBasic language extension v1.2 (Break and Continue)", () => {
  it("keeps the For increment on the Continue round", () => {
    verifyRuntimeResult([
      "Sum = 0",
      "For I = 1 To 5",
      "  If I = 3 Then",
      "    Continue",
      "  EndIf",
      "  Sum = Sum + I",
      "EndFor",
      "TextWindow.WriteLine(Sum)",
      "TextWindow.WriteLine(I)"
    ].join("\n"), [], ["12", "6"]);
  });

  it("leaves the loop without running the For increment on Break", () => {
    verifyRuntimeResult([
      "For I = 1 To 10",
      "  If I = 4 Then",
      "    Break",
      "  EndIf",
      "EndFor",
      "TextWindow.WriteLine(I)"
    ].join("\n"), [], ["4"]);
  });

  it("scopes Break and Continue to the innermost loop", () => {
    verifyRuntimeResult([
      "Out = 0",
      "For I = 1 To 2",
      "  For J = 1 To 3",
      "    If J = 2 Then",
      "      Continue",
      "    EndIf",
      "    If J = 3 Then",
      "      Break",
      "    EndIf",
      "    Out = Out + I * 10 + J",
      "  EndFor",
      "  Out = Out + 1000",
      "EndFor",
      "TextWindow.WriteLine(Out)"
    ].join("\n"), [], ["2032"]);
  });

  it("reports Break and Continue outside of a loop", () => {
    expect(new Compilation("Break").diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.BreakOutsideLoop);
    expect(new Compilation("Continue").diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.ContinueOutsideLoop);
  });

  it("reports Continue after the enclosing loop has closed", () => {
    const compilation = new Compilation([
      'While "True"',
      "  Break",
      "EndWhile",
      "Continue"
    ].join("\n"));

    expect(compilation.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.ContinueOutsideLoop);
  });

  it("treats Break as a reserved word rather than a variable name", () => {
    const compilation = new Compilation("Break = 1");

    expect(compilation.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.UnexpectedToken_ExpectingEOL);
  });
});

describe("SmallBasic language extension v1.3 (integer division and modulo)", () => {
  it("executes the operators and Math methods with the same contract", () => {
    verifyRuntimeResult([
      "TextWindow.WriteLine(-7 \\ 2)",
      "TextWindow.WriteLine(7 Mod -2)",
      "TextWindow.WriteLine(Math.Div(7.9, 2.9))",
      "TextWindow.WriteLine(Math.Mod(-7, -2))"
    ].join("\n"), [], ["-3", "1", "2", "-1"]);
  });

  it("reserves Mod while still accepting Math.Mod member access", () => {
    expect(new Compilation("Mod = 1").diagnostics.length).toBeGreaterThan(0);
    expect(new Compilation("Result = Math.Mod(7, 2)").diagnostics).toEqual([]);
  });
});

describe("SmallBasic language extension v1.4 (GoSub and On Error)", () => {
  it("parses GoSub and On Error clauses without diagnostics", () => {
    const compilation = new Compilation([
      "GoSub Ping",
      "On Error Resume Next",
      "On Error GoTo -1",
      "On Error GoTo 0",
      "On Error GoSub Handle",
      "",
      "Sub Ping",
      "EndSub",
      "",
      "Sub Handle(Code, Message)",
      "EndSub"
    ].join("\n"));

    expect(compilation.diagnostics).toEqual([]);
  });

  it("keeps On, Error, Resume and Next usable as variable names", () => {
    const compilation = new Compilation([
      "On = 5",
      "Error = On + 1",
      "Resume = \"word\"",
      "Next = Error",
      "TextWindow.WriteLine(Next)"
    ].join("\n"));

    expect(compilation.diagnostics).toEqual([]);
  });

  it("reports invalid On Error clauses", () => {
    const compilation = new Compilation([
      "On Error Resume Foo",
      "On Error GoTo 5",
      "On Error GoTo -2",
      "On Error GoSub 0",
      "On Error"
    ].join("\n"));

    expect(compilation.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(new Array(5).fill(ErrorCode.InvalidOnErrorClause));
  });

  it("reports GoSub targets that are missing, Functions or parameterized Subs", () => {
    const missing = new Compilation("GoSub Nowhere");
    const isFunction = new Compilation([
      "GoSub Compute",
      "Function Compute()",
      "  Return 1",
      "EndFunction"
    ].join("\n"));
    const hasParameters = new Compilation([
      "GoSub Show",
      "Sub Show(Value)",
      "EndSub"
    ].join("\n"));

    expect(missing.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.GoSubTargetMustBeSub);
    expect(isFunction.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.GoSubTargetMustBeParameterlessSub);
    expect(hasParameters.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.GoSubTargetMustBeParameterlessSub);
  });

  it("reports On Error GoSub handlers that are not two-parameter Subs", () => {
    const missing = new Compilation("On Error GoSub Nowhere");
    const isFunction = new Compilation([
      "On Error GoSub Compute",
      "Function Compute(A, B)",
      "  Return A",
      "EndFunction"
    ].join("\n"));
    const wrongArity = new Compilation([
      "On Error GoSub Handle",
      "Sub Handle(Code)",
      "EndSub"
    ].join("\n"));

    expect(missing.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.OnErrorHandlerMustBeSub);
    expect(isFunction.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.OnErrorHandlerMustBeSub);
    expect(wrongArity.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain(ErrorCode.OnErrorHandlerMustAcceptCodeAndMessage);
  });

  it("executes GoSub as a regular parameterless Sub call", () => {
    verifyRuntimeResult([
      "Count = 0",
      "GoSub Increment",
      "GoSub Increment",
      "TextWindow.WriteLine(Count)",
      "",
      "Sub Increment",
      "  Count = Count + 1",
      "EndSub"
    ].join("\n"), [], ["2"]);
  });

  it("resumes after errors with On Error Resume Next", () => {
    verifyRuntimeResult([
      "On Error Resume Next",
      "TextWindow.WriteLine(\"before\")",
      "A = 4 / 0",
      "B = 4 Mod 0",
      "C = 4 \\ 0",
      "TextWindow.WriteLine(Math.Div(9, 0))",
      "TextWindow.WriteLine(Math.Remainder(9, 0))",
      "TextWindow.WriteLine(Math.SquareRoot(-4))",
      "TextWindow.WriteLine(Math.Log(0))",
      "TextWindow.WriteLine(Math.ArcCos(2))",
      "TextWindow.WriteLine(\"A=\" + A)",
      "TextWindow.WriteLine(\"after\")"
    ].join("\n"), [], [
      "before",
      "[Runtime Error] 1001: Divide by zero.",
      "[Runtime Error] 1001: Divide by zero.",
      "[Runtime Error] 1001: Divide by zero.",
      "[Runtime Error] 1001: Divide by zero.",
      "[Runtime Error] 1001: Divide by zero.",
      "[Runtime Error] 1002: Invalid math operation.",
      "[Runtime Error] 1002: Invalid math operation.",
      "[Runtime Error] 1002: Invalid math operation.",
      "A=",
      "after"
    ]);
  });

  it("passes the error code and message to an On Error GoSub handler and resumes", () => {
    verifyRuntimeResult([
      "On Error GoSub HandleError",
      "TextWindow.WriteLine(\"start\")",
      "X = 1 / 0",
      "TextWindow.WriteLine(\"end\")",
      "",
      "Sub HandleError(Code, Message)",
      "  TextWindow.WriteLine(\"ERR=\" + Code)",
      "  TextWindow.WriteLine(Message)",
      "EndSub"
    ].join("\n"), [], [
      "start",
      "[Runtime Error] 1001: Divide by zero.",
      "ERR=1001",
      "Divide by zero.",
      "end"
    ]);
  });

  it("stack overflow of nested handled errors stays bounded via the handler frame", () => {
    // A handled error inside the handler itself must terminate (non-reentrant).
    verifyUnhandledRuntimeError([
      "On Error GoSub Handle",
      "X = 1 / 0",
      "TextWindow.WriteLine(\"unreachable\")",
      "",
      "Sub Handle(Code, Message)",
      "  Y = 1 / 0",
      "EndSub"
    ].join("\n"), 1001, "Divide by zero.");
  });

  it("clears the handler with On Error GoTo 0 and restores termination with GoTo -1", () => {
    verifyUnhandledRuntimeError([
      "On Error GoSub Handle",
      "On Error GoTo 0",
      "TextWindow.WriteLine(1 / 0)",
      "",
      "Sub Handle(Code, Message)",
      "EndSub"
    ].join("\n"), 1001, "Divide by zero.");

    verifyUnhandledRuntimeError([
      "On Error Resume Next",
      "A = 1 / 0",
      "On Error GoTo -1",
      "TextWindow.WriteLine(1 / 0)"
    ].join("\n"), 1001, "Divide by zero.");
  });

  it("terminates by default on an empty stack pop without a handler", () => {
    verifyUnhandledRuntimeError("Stack.PopValue(\"x\")", 1101, "This stack has no elements to be popped.");
  });
});
