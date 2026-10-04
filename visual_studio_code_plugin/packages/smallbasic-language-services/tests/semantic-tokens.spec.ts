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
