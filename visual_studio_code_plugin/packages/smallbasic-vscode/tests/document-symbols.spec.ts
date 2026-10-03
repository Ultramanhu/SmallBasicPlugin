import { describe, expect, it } from "vitest";
import { Compilation } from "smallbasic-lang-core";
import { collectOutlineSymbols, type OutlineSymbol } from "../src/language/document-symbols";

function outline(text: string): OutlineSymbol[] {
  return collectOutlineSymbols(new Compilation(text));
}

function render(symbol: OutlineSymbol): string {
  const kind = symbol.kind === "sub" ? "Sub" : symbol.kind === "function" ? "Function" : "Var";
  return `${kind} ${symbol.name}@${symbol.selectionRange.start.line}:${symbol.selectionRange.start.column}`;
}

describe("document outline", () => {
  it("lists procedures and variable first uses in document order", () => {
    const symbols = outline([
      "count = 1",
      "Sub Greet",
      '  TextWindow.WriteLine("hi")',
      "EndSub",
      "total = count + 1"
    ].join("\n"));

    expect(symbols.map(render)).toEqual(["Var count@0:0", "Sub Greet@1:4", "Var total@4:0"]);
    expect(symbols.map((symbol) => symbol.kind)).toEqual(["variable", "sub", "variable"]);
  });

  it("nests a variable under the procedure that owns its first use", () => {
    const symbols = outline([
      "count = 1",
      "Sub Greet",
      "  name = count",
      "EndSub"
    ].join("\n"));

    const greet = symbols.find((symbol) => symbol.kind === "sub");
    expect(greet?.name).toBe("Greet");
    // `name` first appears inside the procedure, `count` first appears above it.
    expect(greet?.children.map(render)).toEqual(["Var name@2:2"]);
    expect(symbols.map(render)).toEqual(["Var count@0:0", "Sub Greet@1:4"]);
  });

  it("ignores library names and procedure names", () => {
    const symbols = outline([
      "Sub Greet",
      '  TextWindow.WriteLine("hi")',
      "EndSub",
      "Greet()",
      "value = Math.Abs(-3)"
    ].join("\n"));

    expect(symbols.map(render)).toEqual(["Sub Greet@0:4", "Var value@4:0"]);
    expect(symbols[0].children).toEqual([]);
  });

  it("reports a For loop variable as a variable", () => {
    const symbols = outline([
      "For i = 1 To 3",
      "  total = total + i",
      "EndFor"
    ].join("\n"));

    expect(symbols.map(render)).toEqual(["Var i@0:4", "Var total@1:2"]);
  });

  it("keeps only the earliest occurrence of each variable", () => {
    const symbols = outline(["x = 1", "x = 2", "y = x"].join("\n"));

    expect(symbols.map(render)).toEqual(["Var x@0:0", "Var y@2:0"]);
  });

  it("lists functions and nests parameters and Dim variables", () => {
    const symbols = outline([
      "Function Add(Left, Right)",
      "  Dim Result",
      "  Result = Left + Right",
      "  Return Result",
      "EndFunction",
      "answer = Add(1, 2)"
    ].join("\n"));

    expect(symbols.map(render)).toEqual(["Function Add@0:9", "Var answer@5:0"]);
    expect(symbols[0].children.map(render)).toEqual([
      "Var Left@0:13",
      "Var Right@0:19",
      "Var Result@1:6"
    ]);
    expect(symbols[0].detail).toBe("Function Add(Left, Right)");
  });
});
