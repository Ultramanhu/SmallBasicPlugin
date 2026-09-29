import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface LanguageConfiguration {
  indentationRules: {
    increaseIndentPattern: string;
    decreaseIndentPattern: string;
  };
  wordPattern: string;
}

describe("SmallBasic language configuration", () => {
  const configurationPath = path.resolve(__dirname, "..", "language-configuration.json");
  const configuration = JSON.parse(fs.readFileSync(configurationPath, "utf8")) as LanguageConfiguration;

  it("contains JavaScript-compatible regular expressions", () => {
    expect(() => new RegExp(configuration.indentationRules.increaseIndentPattern)).not.toThrow();
    expect(() => new RegExp(configuration.indentationRules.decreaseIndentPattern)).not.toThrow();
    expect(() => new RegExp(configuration.wordPattern)).not.toThrow();
  });

  it("indents case-insensitive block statements", () => {
    const increase = new RegExp(configuration.indentationRules.increaseIndentPattern);
    const decrease = new RegExp(configuration.indentationRules.decreaseIndentPattern);

    expect(increase.test("If value > 0 Then")).toBe(true);
    expect(increase.test("  FOR i = 1 TO 10")).toBe(true);
    expect(increase.test("sub DrawShape")).toBe(true);
    expect(decrease.test("EndIf")).toBe(true);
    expect(decrease.test("  ELSEIF value = 0 THEN")).toBe(true);
    expect(decrease.test("endSub")).toBe(true);
  });
});
