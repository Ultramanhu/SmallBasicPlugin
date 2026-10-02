import { describe, expect, it } from "vitest";
import { resolveCliBackends } from "../src/backend-capabilities";
import type { DesktopCapabilities } from "../src/desktop-bridge";

function capabilities(overrides: Partial<DesktopCapabilities> = {}): DesktopCapabilities {
  return {
    platform: "x86_64-pc-windows-msvc",
    backends: { cliCsharpNet48: false, cliCsharpNet8: false },
    graphics: { cliCsharpNet48: false, cliCsharpNet8: false },
    ...overrides
  };
}

describe("desktop CLI backend matrix", () => {
  it("offers the two .NET RunHost flavours in platform order", () => {
    // The Node and Blazor CLI backends were removed on 2026-10-03 (doc 10, §17.2).
    expect(resolveCliBackends(capabilities()).map((backend) => backend.id)).toEqual([
      "cli-csharp-net48",
      "cli-csharp-net8"
    ]);
  });

  it("hides every flavour when nothing was staged", () => {
    expect(resolveCliBackends(capabilities()).map((backend) => backend.available)).toEqual([false, false]);
  });

  it("enables exactly the flavour whose payload is present", () => {
    const backends = resolveCliBackends(capabilities({
      backends: { cliCsharpNet48: true, cliCsharpNet8: false }
    }));

    expect(backends.map((backend) => [backend.id, backend.available])).toEqual([
      ["cli-csharp-net48", true],
      ["cli-csharp-net8", false]
    ]);
  });

  it("labels both flavours and keeps the stdin row available", () => {
    const backends = resolveCliBackends(capabilities({
      backends: { cliCsharpNet48: true, cliCsharpNet8: true }
    }));

    expect(backends.map((backend) => backend.label)).toEqual([
      "C# (.NET Framework 4.8)",
      "C# (.NET 8.0)"
    ]);
    expect(backends.every((backend) => backend.supportsStdin)).toBe(true);
  });

  it("reports the native graphics host per platform", () => {
    // Windows: both hosts draw in a native GraphicsWindow.
    const windows = resolveCliBackends(capabilities({
      backends: { cliCsharpNet48: true, cliCsharpNet8: true },
      graphics: { cliCsharpNet48: true, cliCsharpNet8: true }
    }));
    expect(windows.map((backend) => backend.supportsGraphics)).toEqual([true, true]);

    // Portable .NET 8 host (other platforms): text only, and no net48 host at
    // all, so the flags must follow the capability query, not the backend id.
    const portable = resolveCliBackends(capabilities({
      backends: { cliCsharpNet48: false, cliCsharpNet8: true }
    }));
    expect(portable.map((backend) => backend.supportsGraphics)).toEqual([false, false]);
  });
});
