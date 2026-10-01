import { describe, expect, it } from "vitest";
import { provideFoldingRanges } from "../src/folding";

describe("Small Basic folding ranges", () => {
  it("folds If/For/While/Sub blocks", () => {
    const source = [
      "Sub Main",
      "  If value > 0 Then",
      "    For i = 1 To 3",
      "      While i < 3",
      '        TextWindow.WriteLine("loop")',
      "      EndWhile",
      "    EndFor",
      "  EndIf",
      "EndSub"
    ].join("\n");

    expect(provideFoldingRanges(source)).toEqual([
      { startLine: 3, endLine: 5, kind: "region" },
      { startLine: 2, endLine: 6, kind: "region" },
      { startLine: 1, endLine: 7, kind: "region" },
      { startLine: 0, endLine: 8, kind: "region" }
    ]);
  });

  it("ignores apostrophes inside strings and strips trailing comments", () => {
    const source = [
      "If value > 0 Then ' trailing comment",
      "  TextWindow.WriteLine(\"it's fine\")",
      "EndIf"
    ].join("\n");

    expect(provideFoldingRanges(source)).toEqual([
      { startLine: 0, endLine: 2, kind: "region" }
    ]);
  });
});
