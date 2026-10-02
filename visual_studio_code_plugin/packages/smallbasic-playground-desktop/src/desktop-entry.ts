/**
 * Desktop activation of the shared Playground page (doc 10, §19.3 phase 1-4).
 *
 * `playground.js` (web build) exposes the `window.SmallBasicPlayground`
 * extension surface; this entry - bundled separately as `desktop.js` and only
 * staged into the Tauri app - registers the CLI sidecar backends, the local
 * DAP debug transports and the native file dialogs. Without this script (or
 * outside Tauri) the page keeps the pure Web JavaScript / Web Blazor pair.
 */
import {
  createTauriBridge,
  isTauriRuntime,
  type CliBackendId,
  type DesktopBridge,
  type SessionEvent,
  type SessionStartInfo
} from "./desktop-bridge";
import { resolveCliBackends, type CliBackendDescriptor } from "./backend-capabilities";
import { LocalCliDebugTransport } from "./local-cli-debug-transport";
import type {
  PlaygroundContext,
  PlaygroundGlobalApi,
  ProgramSnapshot
} from "../../smallbasic-vscode/src/playground/entry";

export async function activateDesktopPlayground(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const api = (window as typeof window & { SmallBasicPlayground?: PlaygroundGlobalApi }).SmallBasicPlayground;
  if (!api) {
    console.warn("SmallBasicPlayground bootstrap API is missing; desktop backends stay disabled.");
    return;
  }

  const context = await api.whenReady;
  const bridge = createTauriBridge();
  const capabilities = await bridge.capabilities();
  const available = resolveCliBackends(capabilities).filter((backend) => backend.available);
  if (available.length === 0) {
    context.controller.setStatus("Desktop backends unavailable");
    return;
  }

  const sessions = new Map<CliBackendId, CliRunSession>();
  for (const backend of available) {
    const session = new CliRunSession(bridge, context, backend);
    sessions.set(backend.id, session);
    api.registerBackend(backend.id, {
      label: backend.label,
      run: (snapshot) => session.run(snapshot),
      stop: () => session.stop(),
      onInput: (text) => session.sendInput(text)
    });
    api.registerDebugBackend(backend.id, () =>
      Promise.resolve(new LocalCliDebugTransport(bridge, backend.id, {
        // Route protocol events through the shared notification path so the
        // CLI sessions drive the same status bar as the Web sessions.
        emit: (event) => context.notify(event),
        onOutput: (text) => {
          context.controller.appendConsole(text, 15, 0);
          context.controller.mirrorToConsole(text);
        }
      }))
    );
  }

  // The first edit while a CLI run session is active ends it, mirroring the
  // debug controller's rule: line numbers keep pointing at the executed source.
  api.addModelChangedListener(() => {
    for (const session of sessions.values()) {
      session.endFromEdit();
    }
  });

  api.registerSaveHandler(async (name, source) => {
    const saved = await bridge.saveProgramFile(name, source);
    if (saved) {
      context.controller.setStatus(`Saved ${saved}`);
    }
    return saved;
  });

  // Graphics programs prefer a native GraphicsWindow host: the self-contained
  // .NET 8 host first (no OS runtime prerequisite), then the .NET Framework 4.8
  // host. Otherwise the page keeps its default Web Blazor backend, which renders
  // graphics in the browser.
  const graphicsBackend = available.find(
    (backend) => backend.id === "cli-csharp-net8" && backend.supportsGraphics
  ) ?? available.find(
    (backend) => backend.id === "cli-csharp-net48" && backend.supportsGraphics
  );
  api.setGraphicsBackendResolver(() => graphicsBackend?.id ?? null);
}

/** One active CLI run session: output, stdin and lifecycle. */
class CliRunSession {
  private info: SessionStartInfo | null = null;
  private stopping = false;

  public constructor(
    private readonly bridge: DesktopBridge,
    private readonly context: PlaygroundContext,
    private readonly descriptor: CliBackendDescriptor
  ) {}

  public async run(snapshot: ProgramSnapshot): Promise<void> {
    await this.endActive();
    this.stopping = false;

    const controller = this.context.controller;
    controller.setRunning(true);
    controller.setStatus(`Starting ${this.descriptor.label}…`);
    // Text programs read stdin through the shared input row; graphics
    // sessions take TextWindow input inside the graphics window instead.
    if (this.descriptor.supportsGraphics && usesGraphics(snapshot.source)) {
      controller.setSessionInputVisible(false);
    } else {
      controller.setSessionInputVisible(true);
    }

    try {
      this.info = await this.bridge.runProgram({
        backend: this.descriptor.id,
        name: snapshot.name,
        source: snapshot.source,
        onEvent: (event) => this.onEvent(event)
      });
      controller.setStatus(`Running ${snapshot.name}…`);
    } catch (error) {
      this.info = null;
      controller.setSessionInputVisible(false);
      controller.setRunning(false);
      controller.setStatus("Failed");
      controller.showRuntimeDiagnostics(describe(error));
    }
  }

  public async stop(): Promise<void> {
    if (!this.info) {
      return;
    }

    this.stopping = true;
    this.context.controller.setStatus("Stopping…");
    await this.terminate(this.info.sessionId);
  }

  public sendInput(text: string): void {
    if (!this.info) {
      return;
    }

    void this.bridge.sendInput(this.info.sessionId, text).catch((error: unknown) => {
      this.context.controller.showRuntimeDiagnostics(describe(error));
    });
  }

  /** First edit during a session terminates it (same rule as debugging). */
  public endFromEdit(): void {
    if (!this.info || this.stopping) {
      return;
    }

    this.stopping = true;
    this.context.controller.setSessionInputVisible(false);
    this.context.controller.setRunning(false);
    this.context.controller.setStatus("Editing ended the CLI session.");
    void this.terminate(this.info.sessionId);
  }

  private async endActive(): Promise<void> {
    const current = this.info;
    if (!current) {
      return;
    }

    this.stopping = true;
    this.info = null;
    await this.terminate(current.sessionId);
  }

  private async terminate(sessionId: string): Promise<void> {
    try {
      await this.bridge.terminateSession(sessionId);
    } catch {
      // The session may already be gone; teardown failures are not errors.
    }
  }

  private onEvent(event: SessionEvent): void {
    const controller = this.context.controller;
    switch (event.kind) {
      case "stdout":
        controller.appendConsole(event.text, 15, 0);
        controller.mirrorToConsole(event.text);
        break;
      case "stderr":
        controller.appendConsole(event.text, 15, 0);
        console.error(event.text.replace(/\n$/, ""));
        break;
      case "exited": {
        this.info = null;
        controller.setSessionInputVisible(false);
        controller.setRunning(false);
        controller.setStatus(sessionExitStatus(event.exitCode, this.stopping));
        break;
      }
      default:
        break;
    }
  }
}

function sessionExitStatus(exitCode: number | null, stopped: boolean): string {
  if (stopped || exitCode === null) {
    return "Stopped";
  }

  return exitCode === 0 ? "Completed" : `Exited with code ${exitCode}`;
}

function usesGraphics(source: string): boolean {
  return /\b(GraphicsWindow|Shapes|Turtle)\s*[\.(]/i.test(source || "");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void activateDesktopPlayground();
