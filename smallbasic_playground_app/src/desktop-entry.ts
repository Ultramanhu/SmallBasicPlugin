/**
 * Desktop activation of the shared Playground page (doc 10, §19.3 phase 1-4).
 *
 * `playground.js` (web build) exposes the `window.SmallBasicPlayground`
 * extension surface; this entry - bundled separately as `desktop.js` and only
 * staged into the Tauri app - registers the CLI sidecar backends, the local
 * DAP debug transports, the native file dialogs and the compiler backend's
 * artifact directory. Without this script (or outside Tauri) the page keeps the
 * pure Web JavaScript / Web Blazor pair.
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
import { describeError } from "../../visual_studio_code_plugin/packages/smallbasic-vscode/src/common/errors";
import { echoToConsole } from "../../visual_studio_code_plugin/packages/smallbasic-vscode/src/playground/console-echo";
import type {
  PlaygroundContext,
  PlaygroundGlobalApi,
  PlaygroundStatusText,
  ProgramSnapshot
} from "../../visual_studio_code_plugin/packages/smallbasic-vscode/src/playground/entry";

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
    context.controller.setStatus(context.status.desktopBackendsUnavailable);
    return;
  }

  // The compiler backend writes its EXE into a directory the user picks once;
  // the page reveals the compile-directory field while that backend is
  // selected and asks for the directory before the first Run/Debug (doc 10,
  // §19.5). Cancelling the picker leaves the value unset, so the next Run/Debug
  // asks again.
  const compileBackend = available.find((backend) => backend.requiresOutputDirectory);
  let compileDirectory: string | null = null;

  const sessions = new Map<CliBackendId, CliRunSession>();
  // Every closure below reads `compileDirectory` when it runs, so a directory
  // chosen later (or changed through the 更改 button) reaches the next session
  // without re-registering anything. The page has already settled the directory
  // before Run/Debug, including on the debug controller's restart path.
  for (const backend of available) {
    const session = new CliRunSession(bridge, context, backend);
    sessions.set(backend.id, session);
    api.registerBackend(backend.id, {
      label: backend.label,
      run: (snapshot) => session.run(snapshot, compileDirectory),
      stop: () => session.stop(),
      onInput: (text) => session.sendInput(text)
    });
    api.registerDebugBackend(backend.id, () =>
      Promise.resolve(new LocalCliDebugTransport(bridge, backend.id, {
        // Route protocol events through the shared notification path so the
        // CLI sessions drive the same status bar as the Web sessions.
        emit: (event) => context.notify(event),
        onOutput: (text) => echoToConsole(context.controller, text)
      }, compileDirectory))
    );
  }

  api.registerCompileDirectory(compileBackend
    ? {
        backend: compileBackend.id,
        getDirectory: () => compileDirectory,
        chooseDirectory: async () => {
          try {
            const chosen = await bridge.pickCompileDirectory();
            if (chosen) {
              compileDirectory = chosen;
            }
            return chosen;
          } catch (error) {
            context.controller.showRuntimeDiagnostics(describeError(error));
            return null;
          }
        }
      }
    : null);

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
      context.controller.setStatus(context.status.saved(saved));
    }
    return saved;
  });

  // Graphics programs prefer a native GraphicsWindow host: the self-contained
  // .NET 8 host first (no OS runtime prerequisite), then the .NET Framework 4.8
  // host. Otherwise the page keeps its default Web Blazor backend, which renders
  // graphics in the browser. The compiler backend draws natively too, but it is
  // never auto-selected - compiling on every graphics run would be a surprise.
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

  public async run(snapshot: ProgramSnapshot, outputDirectory: string | null): Promise<void> {
    await this.endActive();
    this.stopping = false;

    const controller = this.context.controller;
    controller.setRunning(true);
    controller.setStatus(this.context.status.backendStarting(this.descriptor.label));
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
        outputDirectory,
        onEvent: (event) => this.onEvent(event)
      });
      controller.setStatus(this.context.status.backendRunning(snapshot.name));
    } catch (error) {
      this.info = null;
      controller.setSessionInputVisible(false);
      controller.setRunning(false);
      controller.setStatus(this.context.status.failed);
      controller.showRuntimeDiagnostics(describeError(error));
    }
  }

  public async stop(): Promise<void> {
    if (!this.info) {
      return;
    }

    this.stopping = true;
    this.context.controller.setStatus(this.context.status.stopping);
    await this.terminate(this.info.sessionId);
  }

  public sendInput(text: string): void {
    if (!this.info) {
      return;
    }

    void this.bridge.sendInput(this.info.sessionId, text).catch((error: unknown) => {
      this.context.controller.showRuntimeDiagnostics(describeError(error));
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
    this.context.controller.setStatus(this.context.status.editingEndedCliSession);
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
        echoToConsole(controller, event.text);
        break;
      case "stderr":
        controller.appendConsole(event.text, 15, 0);
        console.error(event.text.replace(/\n$/, ""));
        break;
      case "exited": {
        this.info = null;
        controller.setSessionInputVisible(false);
        controller.setRunning(false);
        controller.setStatus(sessionExitStatus(this.context.status, event.exitCode, this.stopping));
        break;
      }
      default:
        break;
    }
  }
}

function sessionExitStatus(status: PlaygroundStatusText, exitCode: number | null, stopped: boolean): string {
  if (stopped || exitCode === null) {
    return status.stopped;
  }

  return exitCode === 0 ? status.completed : status.exitedWithCode(exitCode);
}

function usesGraphics(source: string): boolean {
  return /\b(GraphicsWindow|Shapes|Turtle)\s*[\.(]/i.test(source || "");
}

void activateDesktopPlayground();
