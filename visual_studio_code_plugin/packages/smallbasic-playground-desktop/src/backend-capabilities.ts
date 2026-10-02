/**
 * Backend capability matrix for the desktop playground (doc 10, §17.2).
 *
 * The browser static site shows only the two Web backends; the Tauri build
 * incrementally enables the CLI backends. Availability comes from a runtime
 * capability query against the Rust shell (staged sidecar presence), never from
 * user-agent sniffing.
 *
 * Two .NET RunHost flavours remain: the self-contained .NET 8 single-file
 * sidecar and the .NET Framework 4.8 folder host (Windows only). The Node and
 * Blazor CLI backends were removed on 2026-10-03.
 */
import type { CliBackendId, DesktopCapabilities } from "./desktop-bridge";

export interface CliBackendDescriptor {
  id: CliBackendId;
  label: string;
  available: boolean;
  supportsGraphics: boolean;
  /** Text programs read stdin, so the page keeps the input row available. */
  supportsStdin: boolean;
}

export function resolveCliBackends(capabilities: DesktopCapabilities): CliBackendDescriptor[] {
  // Order mirrors Build-RunHost.ps1's platform list: .NET Framework first, then
  // .NET 8. Graphics availability is a platform property (Windows hosts draw
  // natively, the portable .NET 8 host stays text-only), so it always comes from
  // the capability query rather than from the backend id (doc 10, §17.2).
  return [
    {
      id: "cli-csharp-net48",
      label: "C# (.NET Framework 4.8)",
      available: capabilities.backends.cliCsharpNet48,
      supportsGraphics: capabilities.graphics.cliCsharpNet48,
      supportsStdin: true
    },
    {
      id: "cli-csharp-net8",
      label: "C# (.NET 8.0)",
      available: capabilities.backends.cliCsharpNet8,
      supportsGraphics: capabilities.graphics.cliCsharpNet8,
      supportsStdin: true
    }
  ];
}
