import { describe, expect, it } from "vitest";
import { resolveDocumentationLocale, setDocumentationLocale } from "smallbasic-lang-core";
import { SmallBasicLanguageService } from "../src/service";

const URI = "file:///program.sb";
const INVALID_SOURCE = "If Then";
const VALID_SOURCE = 'TextWindow.WriteLine("x")';

describe("SmallBasicLanguageService document state", () => {
  it("computes diagnostics from the uri + version + source the request carries", () => {
    const service = new SmallBasicLanguageService();

    const first = service.syncDocument(URI, INVALID_SOURCE, 1);
    expect(first.version).toBe(1);
    expect(first.diagnostics.length).toBeGreaterThan(0);

    const second = service.syncDocument(URI, VALID_SOURCE, 2);
    expect(second.diagnostics).toEqual([]);

    // An out-of-order request must compute from its own payload, not the
    // newest cached state.
    const stale = service.syncDocument(URI, INVALID_SOURCE, 1);
    expect(stale.diagnostics.length).toBeGreaterThan(0);

    // ...and the newer state is still served on the next request.
    const latest = service.syncDocument(URI, VALID_SOURCE, 2);
    expect(latest.diagnostics).toEqual([]);
  });

  it("rebuilds the document when the source changes under an unchanged version", () => {
    const service = new SmallBasicLanguageService();

    const before = service.syncDocument(URI, INVALID_SOURCE, 1);
    expect(before.diagnostics.length).toBeGreaterThan(0);

    const after = service.syncDocument(URI, VALID_SOURCE, 1);
    expect(after.diagnostics).toEqual([]);
  });

  it("exposes navigation through the neutral DTO surface", () => {
    const service = new SmallBasicLanguageService();
    const source = ["Sub Greet", "EndSub", "Greet()"].join("\n");

    service.syncDocument(URI, source, 1);
    expect(service.provideDefinition(URI, source, 1, { line: 2, column: 0 })).toEqual({
      start: { line: 0, column: 4 },
      end: { line: 0, column: 9 }
    });
    expect(service.provideReferences(URI, source, 1, { line: 0, column: 4 })).toHaveLength(2);

    service.disposeDocument(URI);
    // A disposed document still answers because each request is self-describing.
    expect(service.provideReferences(URI, source, 1, { line: 0, column: 4 })).toHaveLength(2);
  });

  it("serves hover documentation in the configured compiler locale", () => {
    // The playground worker applies the page's UI-language decision through
    // setDocumentationLocale before any analysis; pin that the shared service
    // honors it end to end.
    setDocumentationLocale(resolveDocumentationLocale("zh-CN"));
    try {
      const service = new SmallBasicLanguageService();
      const source = 'TextWindow.WriteLine("x")';
      service.syncDocument(URI, source, 1);

      const hover = service.provideHover(URI, source, 1, { line: 0, column: 16 });
      expect(hover).toBeDefined();
      expect(hover!.contents[1]).toBe("在文本窗口中写文本或数字。一行新的字符会被附加到输出，因此下一次当新的内容写入文本窗口时会出现在新的一行中。");
    } finally {
      setDocumentationLocale(undefined);
    }
  });

  it("describes Break and Continue on hover", () => {
    const service = new SmallBasicLanguageService();
    const source = [
      'While "True"',
      "  Break",
      "EndWhile",
      "For I = 1 To 3",
      "  Continue",
      "EndFor"
    ].join("\n");

    expect(service.provideHover(URI, source, 1, { line: 1, column: 4 })?.contents).toEqual([
      "Break",
      "Exits the innermost While or For loop."
    ]);
    expect(service.provideHover(URI, source, 1, { line: 4, column: 5 })?.contents).toEqual([
      "Continue",
      "Skips to the next iteration of the innermost While or For loop. In a For loop the increment or Step still runs."
    ]);
  });

  it("distinguishes arithmetic operator hover from the Math.Mod method hover", () => {
    const service = new SmallBasicLanguageService();
    const source = [
      "A = 7 Mod 2",
      "B = 7 \\ 2",
      "C = Math.Mod(7, 2)"
    ].join("\n");

    expect(service.provideHover(URI, source, 1, { line: 0, column: 7 })?.contents).toEqual([
      "Mod",
      "Returns the remainder of dividing the left number by the right one, with the same sign as the dividend. Dividing by zero returns 0."
    ]);
    expect(service.provideHover(URI, source, 1, { line: 1, column: 6 })?.contents).toEqual([
      "\\",
      "Integer division: divides the left number by the right one and truncates the quotient toward zero. Dividing by zero returns 0."
    ]);
    expect(service.provideHover(URI, source, 1, { line: 2, column: 10 })?.contents).toEqual([
      "Math.Mod(dividend, divisor)",
      "Divides the first number by the second and returns the remainder, with the same sign as the dividend. For example, Math.Mod(7, 2) returns 1 and Math.Mod(-7, 2) returns -1. Dividing by zero returns 0.",
      "- **dividend**: The number to divide.",
      "- **divisor**: The number that divides."
    ]);
  });

  it("offers Function completions with argument placeholders and signature help", () => {
    const service = new SmallBasicLanguageService();
    const source = [
      "Function Add(Left, Right)",
      "  Return Left + Right",
      "EndFunction",
      "answer = Ad"
    ].join("\n");

    const completions = service.provideCompletionItems(URI, source, 1, { line: 3, column: 11 });
    const add = completions.items.find((item) => item.filterText === "Add");
    expect(add?.label).toBe("Add(Left, Right)");
    expect(add?.insertText).toBe("Add(${1:Left}, ${2:Right})");

    const callSource = source.replace("answer = Ad", "answer = Add(1, ");
    const help = service.provideSignatureHelp(URI, callSource, 2, { line: 3, column: 16 });
    expect(help?.signatures[0].label).toBe("Add(Left, Right)");
    expect(help?.activeParameter).toBe(1);
  });

  it("describes user functions, parameters, and Dim locals on hover", () => {
    const service = new SmallBasicLanguageService();
    const source = [
      "Function Add(Left, Right)",
      "  Dim Result",
      "  Result = Left + Right",
      "  Return Result",
      "EndFunction",
      "answer = Add(1, 2)"
    ].join("\n");

    expect(service.provideHover(URI, source, 1, { line: 5, column: 10 })?.contents).toEqual([
      "Function Add(Left, Right)",
      "User-defined function"
    ]);
    expect(service.provideHover(URI, source, 1, { line: 2, column: 11 })?.contents).toEqual([
      "Parameter Left",
      "Function-scoped parameter"
    ]);
    expect(service.provideHover(URI, source, 1, { line: 3, column: 10 })?.contents).toEqual([
      "Local variable Result",
      "Procedure-scoped variable declared with Dim"
    ]);

    const tokens = service.provideSemanticTokens(URI, source, 1);
    expect(tokens.find((token) => token.line === 0 && token.column === 13)?.type).toBe("parameter");
    expect(tokens.find((token) => token.line === 2 && token.column === 11)?.type).toBe("parameter");
    // `Dim` locals share the parameter color so scoped variables are consistent.
    expect(tokens.find((token) => token.line === 1 && token.column === 6)?.type).toBe("parameter");
  });
});
