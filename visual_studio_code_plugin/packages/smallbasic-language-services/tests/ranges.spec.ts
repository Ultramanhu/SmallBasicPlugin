import { describe, expect, it } from "vitest";
import { lineTextAt, offsetAt, textBeforePosition } from "../src/ranges";

describe("language range helpers", () => {
  const source = "first\r\nsecond\r\nthird";

  it("computes offsets correctly across CRLF boundaries", () => {
    expect(offsetAt(source, { line: 0, column: 0 })).toBe(0);
    expect(offsetAt(source, { line: 1, column: 3 })).toBe("first\r\nsec".length);
    expect(offsetAt(source, { line: 2, column: 5 })).toBe("first\r\nsecond\r\nthird".length);
  });

  it("returns the text before a position without normalizing line endings", () => {
    expect(textBeforePosition(source, { line: 1, column: 6 })).toBe("first\r\nsecond");
  });

  it("clamps line lookups to the available source lines", () => {
    expect(lineTextAt(source, -1)).toBe("first");
    expect(lineTextAt(source, 99)).toBe("third");
  });
});
