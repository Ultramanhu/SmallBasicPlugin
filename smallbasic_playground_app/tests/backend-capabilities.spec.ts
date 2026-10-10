import { describe, expect, it } from "vitest";
import { resolveCliBackends } from "../src/backend-capabilities";
import type { DesktopCapabilities } from "../src/desktop-bridge";

function capabilities(overrides: Partial<DesktopCapabilities> = {}): DesktopCapabilities {
  return {
    platform: "x86_64-pc-windows-msvc",
    backends: { cliCsharpNet48: false, cliCsharpNet8: false, cliCompilerNet48: false },
    graphics: { cliCsharpNet48: false, cliCsharpNet8: false },
    ...overrides
  };
}

function allStaged(): DesktopCapabilities {
  return capabilities({
    backends: { cliCsharpNet48: true, cliCsharpNet8: true, cliCompilerNet48: true },
    graphics: { cliCsharpNet48: true, cliCsharpNet8: true }
  });
}

describe("desktop CLI backend matrix", () => {
  it("offers the three .NET backends in platform order", () => {
    // The Node and Blazor CLI backends were removed on 2026-10-03 (doc 10, §17.2).
    expect(resolveCliBackends(capabilities()).map((backend) => backend.id)).toEqual([
      "cli-csharp-net48",
      "cli-csharp-net8",
      "cli-compiler-net48"
    ]);
  });

  it("hides every flavour when nothing was staged", () => {
    expect(resolveCliBackends(capabilities()).map((backend) => backend.available)).toEqual([false, false, false]);
  });

  it("enables exactly the flavour whose payload is present", () => {
    const backends = resolveCliBackends(capabilities({
      backends: { cliCsharpNet48: true, cliCsharpNet8: false, cliCompilerNet48: false }
    }));

    expect(backends.map((backend) => [backend.id, backend.available])).toEqual([
      ["cli-csharp-net48", true],
      ["cli-csharp-net8", false],
      ["cli-compiler-net48", false]
    ]);
  });

  it("labels every flavour with the lowercase .net spelling and keeps the stdin row available", () => {
    const backends = resolveCliBackends(allStaged());

    expect(backends.map((backend) => backend.label)).toEqual([
      "C# (.net Framework 4.8)",
      "C# (.net 8.0)",
      "Compiler (.net Framework 4.8)"
    ]);
    expect(backends.every((backend) => backend.supportsStdin)).toBe(true);
  });

  it("only the compiler backend asks for an artifact directory", () => {
    // Run/Debug gate on the output directory for this one backend; the two
    // RunHost flavours interpret the program directly (doc 10, §19.5).
    expect(resolveCliBackends(allStaged()).map((backend) => backend.requiresOutputDirectory)).toEqual([
      false,
      false,
      true
    ]);
  });

  it("reports the native graphics host per platform", () => {
    // Windows: both hosts draw in a native GraphicsWindow, and the compiled
    // artifact is built from the same net48 template.
    const windows = resolveCliBackends(allStaged());
    expect(windows.map((backend) => backend.supportsGraphics)).toEqual([true, true, true]);

    // Portable .NET 8 host (other platforms): text only, and no net48 host or
    // compiler backend at all, so the flags must follow the capability query,
    // not the backend id.
    const portable = resolveCliBackends(capabilities({
      backends: { cliCsharpNet48: false, cliCsharpNet8: true, cliCompilerNet48: false }
    }));
    expect(portable.map((backend) => backend.supportsGraphics)).toEqual([false, false, false]);
  });
});
