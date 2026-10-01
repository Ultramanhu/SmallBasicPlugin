import { describe, expect, it } from "vitest";
import { getSnippetCompletionItems } from "../src/monaco/snippets";

describe("Monaco snippet completion adapter", () => {
  it("returns matching snippet completions with Monaco-ready ranges", () => {
    const items = getSnippetCompletionItems("he", 4, 2);
    const hello = items.find((item) => item.label === "hello");

    expect(hello).toBeDefined();
    expect(hello?.insertTextIsSnippet).toBe(true);
    expect(hello?.insertText).toContain('TextWindow.WriteLine("Hello World")');
    expect(hello?.ranges.inserting).toEqual({
      start: { line: 4, column: 0 },
      end: { line: 4, column: 2 }
    });
    expect(hello?.ranges.replacing).toEqual({
      start: { line: 4, column: 0 },
      end: { line: 4, column: 2 }
    });
  });

  it("preserves placeholder-rich control-flow snippets", () => {
    const items = getSnippetCompletionItems("if", 0, 2);
    const snippet = items.find((item) => item.label === "if");

    expect(snippet?.insertText).toContain("If ${1:condition} Then");
    expect(snippet?.insertText).toContain("${0}");
    expect(snippet?.insertText).toContain("EndIf");
  });
});
