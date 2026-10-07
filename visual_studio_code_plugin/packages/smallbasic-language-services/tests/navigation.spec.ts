import { describe, expect, it } from "vitest";
import { Compilation } from "smallbasic-lang-core";
import { provideDefinition, provideReferences } from "../src/navigation";

const SOURCE = [
  "Sub Greet",
  '  TextWindow.WriteLine("hi")',
  "EndSub",
  "",
  "For i = 1 To 3",
  "  Greet()",
  "  total = total + i",
  "EndFor",
  "Greet()"
].join("\n");

describe("Small Basic navigation", () => {
  const compilation = new Compilation(SOURCE);

  it("resolves a sub invocation to the Sub declaration", () => {
    expect(provideDefinition(compilation, { line: 5, column: 2 })).toEqual({
      start: { line: 0, column: 4 },
      end: { line: 0, column: 9 }
    });
  });

  it("treats the Sub name token as its own definition", () => {
    expect(provideDefinition(compilation, { line: 0, column: 4 })).toEqual({
      start: { line: 0, column: 4 },
      end: { line: 0, column: 9 }
    });
  });

  it("resolves a variable use to its first occurrence (the For loop header)", () => {
    expect(provideDefinition(compilation, { line: 6, column: 18 })).toEqual({
      start: { line: 4, column: 4 },
      end: { line: 4, column: 5 }
    });
  });

  it("returns the first use of a variable as its own definition", () => {
    expect(provideDefinition(compilation, { line: 6, column: 2 })).toEqual({
      start: { line: 6, column: 2 },
      end: { line: 6, column: 7 }
    });
  });

  it("collects the declaration and every call site as sub references", () => {
    expect(provideReferences(compilation, { line: 0, column: 4 })).toEqual([
      { start: { line: 0, column: 4 }, end: { line: 0, column: 9 } },
      { start: { line: 5, column: 2 }, end: { line: 5, column: 7 } },
      { start: { line: 8, column: 0 }, end: { line: 8, column: 5 } }
    ]);
  });

  it("matches references case-insensitively in document order", () => {
    const source = ["Sub Shout", "EndSub", "shout()", "SHOUT()"].join("\n");
    expect(provideReferences(new Compilation(source), { line: 2, column: 0 })).toEqual([
      { start: { line: 0, column: 4 }, end: { line: 0, column: 9 } },
      { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
      { start: { line: 3, column: 0 }, end: { line: 3, column: 5 } }
    ]);
  });

  it("collects every use of a file-scoped variable", () => {
    expect(provideReferences(compilation, { line: 6, column: 2 })).toEqual([
      { start: { line: 6, column: 2 }, end: { line: 6, column: 7 } },
      { start: { line: 6, column: 10 }, end: { line: 6, column: 15 } }
    ]);
  });

  it("includes the For loop header in the loop variable's references", () => {
    expect(provideReferences(compilation, { line: 4, column: 4 })).toEqual([
      { start: { line: 4, column: 4 }, end: { line: 4, column: 5 } },
      { start: { line: 6, column: 18 }, end: { line: 6, column: 19 } }
    ]);
  });

  it("ignores library objects that the outline also hides", () => {
    expect(provideDefinition(compilation, { line: 1, column: 2 })).toBeUndefined();
    expect(provideReferences(compilation, { line: 1, column: 2 })).toEqual([]);
  });

  it("returns nothing for positions outside any identifier", () => {
    expect(provideDefinition(compilation, { line: 3, column: 0 })).toBeUndefined();
    expect(provideReferences(compilation, { line: 3, column: 0 })).toEqual([]);
  });

  it("navigates functions and keeps local names isolated from globals", () => {
    const source = [
      "Function Echo(Value)",
      "  Dim Local",
      "  Local = Value",
      "  Return Local",
      "EndFunction",
      "Local = 10",
      "answer = Echo(Local)"
    ].join("\n");
    const scoped = new Compilation(source);

    expect(provideDefinition(scoped, { line: 6, column: 9 })).toEqual({
      start: { line: 0, column: 9 },
      end: { line: 0, column: 13 }
    });
    expect(provideDefinition(scoped, { line: 2, column: 10 })).toEqual({
      start: { line: 0, column: 14 },
      end: { line: 0, column: 19 }
    });
    expect(provideReferences(scoped, { line: 1, column: 6 })).toEqual([
      { start: { line: 1, column: 6 }, end: { line: 1, column: 11 } },
      { start: { line: 2, column: 2 }, end: { line: 2, column: 7 } },
      { start: { line: 3, column: 9 }, end: { line: 3, column: 14 } }
    ]);
    expect(provideReferences(scoped, { line: 5, column: 0 })).toEqual([
      { start: { line: 5, column: 0 }, end: { line: 5, column: 5 } },
      { start: { line: 6, column: 14 }, end: { line: 6, column: 19 } }
    ]);
  });

  it("resolves a GoSub target to the Sub declaration", () => {
    const source = [
      "Sub Helper",
      "EndSub",
      "GoSub Helper"
    ].join("\n");
    const goSub = new Compilation(source);

    expect(provideDefinition(goSub, { line: 2, column: 7 })).toEqual({
      start: { line: 0, column: 4 },
      end: { line: 0, column: 10 }
    });
    expect(provideReferences(goSub, { line: 0, column: 5 })).toEqual([
      { start: { line: 0, column: 4 }, end: { line: 0, column: 10 } },
      { start: { line: 2, column: 6 }, end: { line: 2, column: 12 } }
    ]);
  });

  it("resolves an On Error GoSub handler to the Sub declaration", () => {
    const source = [
      "Sub Handler(Code, Message)",
      "EndSub",
      "On Error GoSub Handler",
      "value = 1 / 0"
    ].join("\n");
    const onError = new Compilation(source);

    expect(provideDefinition(onError, { line: 2, column: 15 })).toEqual({
      start: { line: 0, column: 4 },
      end: { line: 0, column: 11 }
    });
    expect(provideReferences(onError, { line: 2, column: 15 })).toEqual([
      { start: { line: 0, column: 4 }, end: { line: 0, column: 11 } },
      { start: { line: 2, column: 15 }, end: { line: 2, column: 22 } }
    ]);
  });
});
