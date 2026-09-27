import { describe, expect, it } from "vitest";
import { selectDefaultDebugBackend } from "../src/debug/backend-selection";

describe("desktop debug backend selection", () => {
  it("uses the graphics-capable C# DAP host by default on Windows", () => {
    expect(selectDefaultDebugBackend("win32", true)).toBe("csharp");
  });

  it("falls back to JavaScript when the Windows C# host is unavailable", () => {
    expect(selectDefaultDebugBackend("win32", false)).toBe("javascript");
  });

  it("keeps JavaScript as the default on non-Windows desktops", () => {
    expect(selectDefaultDebugBackend("linux", true)).toBe("javascript");
    expect(selectDefaultDebugBackend("darwin", true)).toBe("javascript");
  });
});
