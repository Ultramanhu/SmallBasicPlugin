import { describe, expect, it } from "vitest";
import { getContextualCompletions } from "../src/language/contextual-completions";

describe("contextual completions", () => {
  it("suggests If-block continuations on a new line", () => {
    const items = getContextualCompletions("If value = 1 Then\n", "").map((entry) => entry.item.title);
    expect(items).toEqual(["EndIf", "ElseIf", "Else"]);
  });

  it("filters context suggestions by the current prefix", () => {
    const items = getContextualCompletions("If value = 1 Then\nEn", "En").map((entry) => entry.item.title);
    expect(items).toEqual(["EndIf"]);
  });

  it("suggests EndSub inside a sub body", () => {
    const items = getContextualCompletions("Sub MainLoop\n", "").map((entry) => entry.item.title);
    expect(items[0]).toBe("EndSub");
  });

  it("suggests Break and Continue inside a For loop", () => {
    const items = getContextualCompletions("For i = 1 To 10\n", "").map((entry) => entry.item.title);
    expect(items).toEqual(["EndFor", "Continue", "Break"]);
  });

  it("suggests Break and Continue inside a While loop", () => {
    const items = getContextualCompletions("While \"True\"\n", "").map((entry) => entry.item.title);
    expect(items).toEqual(["EndWhile", "Continue", "Break"]);
  });

  it("describes loop control suggestions", () => {
    const items = getContextualCompletions("While \"True\"\n", "").map((entry) => entry.item.description);
    expect(items).toContain("Exit this While loop");
  });

  it("does not suggest Break or Continue outside of a loop", () => {
    const items = getContextualCompletions("TextWindow.WriteLine(\"x\")\n", "").map((entry) => entry.item.title);
    expect(items).not.toContain("Break");
    expect(items).not.toContain("Continue");
  });
});
