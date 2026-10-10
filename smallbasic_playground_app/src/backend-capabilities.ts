/**
 * Backend capability matrix for the desktop playground (doc 10, §17.2 / §19.5).
 *
 * The browser static site shows only the two Web backends; the Tauri build
 * incrementally enables the CLI backends. Availability comes from a runtime
 * capability query against the Rust shell (staged payload presence), never from
 * user-agent sniffing.
 *
 * Three .NET backends remain: the self-contained .NET 8 single-file sidecar,
 * the .NET Framework 4.8 folder host and the .NET Framework 4.8 compiler
 * backend (Windows only). The Node and Blazor CLI backends were removed on
 * 2026-10-03.
 */
import type { CliBackendId, DesktopCapabilities } from "./desktop-bridge";

export interface CliBackendDescriptor {
  id: CliBackendId;
  label: string;
  available: boolean;
  supportsGraphics: boolean;
  /** Text programs read stdin, so the page keeps the input row available. */
  supportsStdin: boolean;
  /**
   * Run and Debug need the compiled-artifact output directory up front; the
   * page shows the compile-directory field while such a backend is selected
   * and asks for the directory before the first run (doc 10, §19.5).
   */
  requiresOutputDirectory: boolean;
}

export function resolveCliBackends(capabilities: DesktopCapabilities): CliBackendDescriptor[] {
  // Order mirrors Build-RunHost.ps1's platform list: .NET Framework first, then
  // .NET 8, with the compiler backend last (it is an action, not another host).
  // Graphics availability is a platform property (Windows hosts draw natively,
  // the portable .NET 8 host stays text-only), so it always comes from the
  // capability query rather than from the backend id (doc 10, §17.2).
  //
  // Labels spell the framework ".net": the product name is the only
  // capitalization the dropdown keeps consistent across all three entries.
  return [
    {
      id: "cli-csharp-net48",
      label: "C# (.net Framework 4.8)",
      available: capabilities.backends.cliCsharpNet48,
      supportsGraphics: capabilities.graphics.cliCsharpNet48,
      supportsStdin: true,
      requiresOutputDirectory: false
    },
    {
      id: "cli-csharp-net8",
      label: "C# (.net 8.0)",
      available: capabilities.backends.cliCsharpNet8,
      supportsGraphics: capabilities.graphics.cliCsharpNet8,
      supportsStdin: true,
      requiresOutputDirectory: false
    },
    {
      // The compiled artifact is a net48 template deployment, so it inherits
      // the Windows GraphicsWindow host (doc 10, §19.5).
      id: "cli-compiler-net48",
      label: "Compiler (.net Framework 4.8)",
      available: capabilities.backends.cliCompilerNet48,
      supportsGraphics: capabilities.graphics.cliCsharpNet48,
      supportsStdin: true,
      requiresOutputDirectory: true
    }
  ];
}
