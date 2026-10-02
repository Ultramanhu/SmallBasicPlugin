/**
 * Typed frontend bridge to the Tauri desktop shell of the local playground
 * (design doc 10, §17.3 / §19.1).
 *
 * The Rust side exposes a deliberately narrow command surface: the page can
 * start sessions for whitelisted CLI backends, stream their output through an
 * ordered channel, write TextWindow input and drive the DAP bridge - but it
 * can never name an executable, argument list, environment or working
 * directory. All of those are derived from the backend enum inside Rust.
 *
 * This module is only bundled into the desktop build (`desktop.js`, staged by
 * `stage-playground.mjs`); the browser build of `runhost/web` must not
 * include it (doc 10, §19.4).
 */
import { invoke, Channel } from "@tauri-apps/api/core";

/** Session event stream pushed from Rust through a Tauri `Channel`. */
export type SessionEvent =
  | { kind: "status"; status: string; name?: string }
  | { kind: "stdout"; text: string }
  | { kind: "stderr"; text: string }
  | { kind: "log"; text: string }
  /** One decoded DAP message (request/response/event) from the CLI adapter. */
  | { kind: "dap"; message: Record<string, unknown> }
  | { kind: "exited"; exitCode: number | null };

/**
 * The CLI backends offered by the desktop shell: the two .NET RunHost flavours.
 * The Node and Blazor sidecars were removed on 2026-10-03 (doc 10, §17.2).
 *
 * - `cli-csharp-net8`  - self-contained .NET 8 single-file sidecar.
 * - `cli-csharp-net48` - .NET Framework 4.8 folder host (Windows only).
 */
export type CliBackendId = "cli-csharp-net48" | "cli-csharp-net8";

export interface DesktopCapabilities {
  /** Rust build target triple, e.g. `x86_64-pc-windows-msvc`. */
  platform: string;
  backends: {
    cliCsharpNet48: boolean;
    cliCsharpNet8: boolean;
  };
  graphics: {
    /** Native GraphicsWindow host (the Windows net48 / net8.0-windows hosts). */
    cliCsharpNet48: boolean;
    cliCsharpNet8: boolean;
  };
}

export interface SessionStartInfo {
  sessionId: string;
  /** Directory that holds `program.sb` for this session (cleanup is automatic). */
  sessionDir: string;
  /** Absolute path of the session program file, e.g. for DAP `launch.program`. */
  programPath: string;
}

export interface SessionRequest {
  backend: CliBackendId;
  name: string;
  source: string;
  onEvent: (event: SessionEvent) => void;
}

export interface DesktopBridge {
  capabilities(): Promise<DesktopCapabilities>;
  runProgram(request: SessionRequest): Promise<SessionStartInfo>;
  startDebug(request: SessionRequest): Promise<SessionStartInfo>;
  sendInput(sessionId: string, text: string): Promise<void>;
  /** Returns the DAP sequence number assigned by the Rust framer. */
  debugRequest(sessionId: string, command: string, args?: unknown): Promise<number>;
  terminateSession(sessionId: string): Promise<void>;
  pickProgramFile(): Promise<{ name: string; content: string } | null>;
  saveProgramFile(defaultName: string, source: string): Promise<string | null>;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function createTauriBridge(): DesktopBridge {
  return new TauriDesktopBridge();
}

class TauriDesktopBridge implements DesktopBridge {
  public async capabilities(): Promise<DesktopCapabilities> {
    return invoke("desktop_capabilities") as Promise<DesktopCapabilities>;
  }

  public async runProgram(request: SessionRequest): Promise<SessionStartInfo> {
    return this.startSession("run_program", request);
  }

  public async startDebug(request: SessionRequest): Promise<SessionStartInfo> {
    return this.startSession("start_debug", request);
  }

  private async startSession(command: string, request: SessionRequest): Promise<SessionStartInfo> {
    const channel = new Channel<SessionEvent>();
    channel.onmessage = (message) => request.onEvent(message);
    return invoke(command, {
      backend: request.backend,
      name: request.name,
      source: request.source,
      onEvent: channel
    }) as Promise<SessionStartInfo>;
  }

  public async sendInput(sessionId: string, text: string): Promise<void> {
    await invoke("send_input", { sessionId, text });
  }

  public async debugRequest(sessionId: string, command: string, args?: unknown): Promise<number> {
    return invoke("debug_request", { sessionId, command, args: args ?? {} }) as Promise<number>;
  }

  public async terminateSession(sessionId: string): Promise<void> {
    await invoke("terminate_session", { sessionId });
  }

  public async pickProgramFile(): Promise<{ name: string; content: string } | null> {
    return invoke("pick_program_file") as Promise<{ name: string; content: string } | null>;
  }

  public async saveProgramFile(defaultName: string, source: string): Promise<string | null> {
    return invoke("save_program_file", { defaultName, source }) as Promise<string | null>;
  }
}
