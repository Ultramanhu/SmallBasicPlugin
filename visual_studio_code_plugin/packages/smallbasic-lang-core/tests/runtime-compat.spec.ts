import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Compilation, ErrorCode } from "../src/index";
import { verifyRuntimeResult } from "../../../vendor/SmallBasicOnline/tests/compiler/helpers";

describe("SmallBasic runtime compatibility", () => {
  it("supports Text library helpers at runtime", () => {
    verifyRuntimeResult(
      [
        'TextWindow.WriteLine(Text.Append("foo", "bar"))',
        'TextWindow.WriteLine(Text.GetSubText("12345678", 4, 4))',
        'TextWindow.WriteLine(Text.GetWord("one two three", 2))',
        'TextWindow.WriteLine(Text.GetWordCount("one two three"))'
      ].join("\n"),
      [],
      ["foobar", "4567", "two", "3"]
    );
  });

  it("binds library events case-insensitively", () => {
    const compilation = new Compilation([
      "Sub HandleKey",
      "EndSub",
      "",
      "GraphicsWindow.KEYDOWN = HandleKey",
      "GraphicsWindow.keyup = HandleKey",
      "GraphicsWindow.mouseMOVE = HandleKey"
    ].join("\n"));

    expect(compilation.diagnostics).toEqual([]);
  });

  it("reports assigning a non-submodule to an event", () => {
    const compilation = new Compilation([
      "value = 1",
      "GraphicsWindow.KeyDown = value"
    ].join("\n"));

    expect(compilation.diagnostics).toHaveLength(1);
    expect(compilation.diagnostics[0].code).toBe(ErrorCode.AssigningNonSubModuleToEvent);
  });

  it("compiles the Tetris sample without diagnostics", () => {
    const source = readFileSync(new URL("../../../../sample/tetris/tetris.sb", import.meta.url), "utf8");

    const compilation = new Compilation(source);
    expect(compilation.diagnostics).toEqual([]);
  });
});
