import { describe, expect, it } from "vitest";
import { Compilation, ErrorCode } from "../src/index";
import { verifyRuntimeResult } from "../../../vendor/SmallBasicOnline/tests/compiler/helpers";

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
    ].join("\n"), [], ["5", "3", "[x=3]"]);
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
});
