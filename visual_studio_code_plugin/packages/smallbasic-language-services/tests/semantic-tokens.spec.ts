import { describe, expect, it } from "vitest";
import { SmallBasicLanguageService } from "../src/service";

const URI = "file:///semantic-tokens.sb";

function tokenTypeAt(service: SmallBasicLanguageService, source: string, line: number, column: number) {
  const tokens = service.provideSemanticTokens(URI, source, 1);
  return tokens.find((token) => token.line === line && token.column === column)?.type;
}

describe("semantic token coloring for scoped variables", () => {
  const service = new SmallBasicLanguageService();
  const source = [
    "Dim Global",
    "Global = 1",
    "Sub Show(Arg)",
    "  Dim Local",
    "  Local = Arg",
    "  Plain = Local",
    "EndSub",
    "Show(2)"
  ].join("\n");

  it("colors subroutine parameters as parameters", () => {
    expect(tokenTypeAt(service, source, 2, 9)).toBe("parameter");
  });

  it("colors Dim-declared variables as parameters", () => {
    expect(tokenTypeAt(service, source, 0, 4)).toBe("parameter");
    expect(tokenTypeAt(service, source, 3, 6)).toBe("parameter");
  });

  it("colors parameter and Dim references the same as their declarations", () => {
    expect(tokenTypeAt(service, source, 1, 0)).toBe("parameter");
    expect(tokenTypeAt(service, source, 4, 2)).toBe("parameter");
    expect(tokenTypeAt(service, source, 4, 10)).toBe("parameter");
    expect(tokenTypeAt(service, source, 5, 10)).toBe("parameter");
  });

  it("keeps undeclared variables and procedure names distinct", () => {
    expect(tokenTypeAt(service, source, 5, 2)).toBe("variable");
    expect(tokenTypeAt(service, source, 2, 4)).toBe("function");
    expect(tokenTypeAt(service, source, 7, 0)).toBe("function");
  });
});

describe("semantic token coloring for loop control keywords", () => {
  const service = new SmallBasicLanguageService();
  const source = [
    "While \"True\"",
    "  Break",
    "EndWhile",
    "For I = 1 To 3",
    "  Continue",
    "EndFor"
  ].join("\n");

  it("colors Break and Continue as keywords", () => {
    expect(tokenTypeAt(service, source, 1, 2)).toBe("keyword");
    expect(tokenTypeAt(service, source, 4, 2)).toBe("keyword");
  });

  it("keeps the surrounding loop keywords unchanged", () => {
    expect(tokenTypeAt(service, source, 0, 0)).toBe("keyword");
    expect(tokenTypeAt(service, source, 5, 0)).toBe("keyword");
  });
});

describe("semantic token coloring for the Mod operator keyword", () => {
  const service = new SmallBasicLanguageService();
  const source = [
    "TextWindow.WriteLine(7 Mod 2)",
    "Answer = Math.Mod(7, 2)"
  ].join("\n");

  it("colors Mod as a keyword", () => {
    expect(tokenTypeAt(service, source, 0, 23)).toBe("keyword");
  });

  it("colors Math.Mod as a library method rather than an operator keyword", () => {
    expect(tokenTypeAt(service, source, 1, 14)).toBe("function");
  });
});

describe("semantic token coloring for GoSub and On Error", () => {
  const service = new SmallBasicLanguageService();
  const source = [
    "On Error Resume Next",
    "On Error GoTo 0",
    "On Error GoSub Handler",
    "GoSub Helper",
    "Sub Handler(Code, Message)",
    "EndSub",
    "Sub Helper",
    "EndSub"
  ].join("\n");

  it("colors GoSub as a keyword and its target as a function", () => {
    expect(tokenTypeAt(service, source, 3, 0)).toBe("keyword");
    expect(tokenTypeAt(service, source, 3, 6)).toBe("function");
  });

  it("colors On Error clause words as contextual keywords", () => {
    expect(tokenTypeAt(service, source, 0, 0)).toBe("keyword");
    expect(tokenTypeAt(service, source, 0, 3)).toBe("keyword");
    expect(tokenTypeAt(service, source, 0, 9)).toBe("keyword");
    expect(tokenTypeAt(service, source, 0, 16)).toBe("keyword");
    expect(tokenTypeAt(service, source, 1, 9)).toBe("keyword");
  });

  it("colors the On Error GoSub handler as a function", () => {
    expect(tokenTypeAt(service, source, 2, 0)).toBe("keyword");
    expect(tokenTypeAt(service, source, 2, 9)).toBe("keyword");
    expect(tokenTypeAt(service, source, 2, 15)).toBe("function");
  });
});
