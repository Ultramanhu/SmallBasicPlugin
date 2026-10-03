import { ValueKind } from "smallbasic-lang-core";
import { DebugEngineDriver, type DebugSnapshot } from "../debug/engine-driver";
import { DEBUG_PROTOCOL_VERSION } from "../web/debug-protocol";

/**
 * Browser-side debug session of the JavaScript backend for `mode: "web"`.
 *
 * It is the JavaScript counterpart of the Blazor WebAssembly
 * `BrowserEngineSession`: the webview drives it with the very same web debug
 * protocol (`debug-protocol.ts`), so the two web-mode backends behave the same
 * - both render into the page and both are debuggable from the VS Code debug UI.
 *
 * All engine semantics come from {@link DebugEngineDriver}; this file only
 * translates between the protocol and the driver, exactly like
 * `src/debug/session.ts` translates between DAP and the driver.
 */

/** Matches `EXIT_UNSUPPORTED_LIBRARY`/compile failures of the other backends. */
const EXIT_COMPILE_ERROR = 2;

/** Version of the web debug protocol (mirrors `debug-protocol.ts`). */
const PROTOCOL_VERSION = DEBUG_PROTOCOL_VERSION;

/** The browser session hosts exactly one program; its path is symbolic. */
const PROGRAM_PATH = "program.sb";

/** Where runtime events and TextWindow output go (the page's `SmallBasicWebHost`). */
export interface DebugEventSink {
  /** Publishes a `BrowserMessage`-shaped JSON event. */
  notify(json: string): void;
  /** Publishes TextWindow text (the page mirrors it into the output panel). */
  write(text: string): void;
}

interface LaunchRequest {
  sessionId?: string;
  name?: string;
  source?: string;
  stopOnEntry?: boolean;
}

interface WireCommand {
  protocolVersion?: number;
  sessionId?: string;
  requestId?: string;
  type?: string;
  control?: string;
  depth?: number;
  breakpoints?: number[];
  conditions?: string[];
  text?: string;
}

export class BrowserDebugSession {
  private driver: DebugEngineDriver | undefined;
  private sessionId = "";
  private stopOnEntry = false;
  private ended = false;
  /** True once the client configured breakpoints, so `start` must not clobber them. */
  private breakpointsConfigured = false;

  public constructor(private readonly sink: DebugEventSink) {}

  /** Boots a session from the `debug-launch` payload; emits `ready` when it can run. */
  public start(json: string): void {
    const request = parseJson<LaunchRequest>(json);
    if (!request || typeof request.source !== "string") {
      this.emit({ type: "error", message: "无效的调试启动请求。" });
      this.emit({ type: "terminated", exitCode: EXIT_COMPILE_ERROR });
      return;
    }

    this.sessionId = typeof request.sessionId === "string" ? request.sessionId : "";
    this.stopOnEntry = request.stopOnEntry === true;
    const source = request.source;

    this.driver = new DebugEngineDriver(
      {
        onOutput: (text) => this.sink.write(text),
        onStopped: (reason, snapshot) => this.emit({ type: "stopped", reason, ...this.snapshotFields(snapshot) }),
        onInputRequested: (kind, snapshot) => this.emit({
          type: "input",
          numberInput: kind === ValueKind.Number,
          ...this.snapshotFields(snapshot)
        }),
        onTerminated: (exitCode) => {
          this.ended = true;
          this.emit({ type: "terminated", exitCode });
        }
      },
      {
        readFile: (filePath) => {
          if (filePath !== PROGRAM_PATH) {
            throw new Error(`Unknown program: ${filePath}`);
          }

          return source;
        }
      }
    );

    try {
      this.driver.load(PROGRAM_PATH);
    } catch (error) {
      this.emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
      this.emit({ type: "terminated", exitCode: EXIT_COMPILE_ERROR });
      return;
    }

    this.emit({ type: "ready" });
  }

  /** Applies one web debug command; unknown/foreign/malformed commands are dropped. */
  public dispatch(json: string): void {
    const command = parseJson<WireCommand>(json);
    const driver = this.driver;
    if (!command || !driver || this.ended) {
      return;
    }

    if (command.protocolVersion !== undefined && command.protocolVersion !== PROTOCOL_VERSION) {
      return;
    }

    if (command.sessionId && this.sessionId && command.sessionId !== this.sessionId) {
      return;
    }

    switch (command.type) {
      case "setBreakpoints": {
        this.breakpointsConfigured = true;
        const lines = toLines(command.breakpoints);
        const conditions = Array.isArray(command.conditions) ? command.conditions : [];
        const verified = driver.setBreakpoints(
          PROGRAM_PATH,
          lines.map((line, index) => {
            const condition = typeof conditions[index] === "string" ? conditions[index].trim() : "";
            return condition ? { line, condition } : { line };
          })
        );
        this.emit({
          type: "breakpointsValidated",
          requestId: command.requestId,
          breakpoints: verified
            .filter((breakpoint) => breakpoint.verified && breakpoint.actualLine !== undefined)
            .map((breakpoint) => breakpoint.actualLine as number)
        });
        return;
      }
      case "start": {
        // `start` may carry already-validated lines (the Blazor CLI flow). When
        // the client configured breakpoints itself, keeping them preserves
        // conditions, which the `start` payload cannot express.
        const lines = toLines(command.breakpoints);
        if (!this.breakpointsConfigured && lines.length > 0) {
          driver.setBreakpoints(PROGRAM_PATH, lines.map((line) => ({ line })));
        }

        driver.begin(this.stopOnEntry);
        return;
      }
      case "control": {
        // The DAP adapter steps from the paused stack depth (session.ts passes
        // `driver.frames().length`); web commands may omit the depth, and 0
        // would make "next"/"stepOut" never stop, so fall back to the current
        // stack.
        const depth = typeof command.depth === "number" ? command.depth : driver.frames().length;
        switch (command.control) {
          case "pause":
            driver.pause();
            return;
          case "next":
            driver.step(depth, "next");
            return;
          case "stepIn":
            driver.step(depth, "stepIn");
            return;
          case "stepOut":
            driver.step(depth, "stepOut");
            return;
          default:
            driver.continueExecution();
            return;
        }
      }
      case "input":
        driver.submitInput(typeof command.text === "string" ? command.text : "");
        return;
      case "stop":
        driver.terminate();
        return;
      default:
        return;
    }
  }

  /** Ends the session (page closed or the extension disposed the broker). */
  public stop(): void {
    this.driver?.terminate();
  }

  private snapshotFields(snapshot: DebugSnapshot): Record<string, unknown> {
    return {
      line: snapshot.frames[0]?.line ?? 0,
      frames: snapshot.frames.map((frame) => ({
        name: frame.name,
        line: frame.line,
        variables: this.driver ? frame.variables.map((variable) => this.driver!.toVariableTree(variable)) : []
      })),
      variables: this.driver ? snapshot.variables.map((variable) => this.driver!.toVariableTree(variable)) : []
    };
  }

  private emit(message: Record<string, unknown>): void {
    this.sink.notify(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, sessionId: this.sessionId, ...message }));
  }
}

function toLines(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    .map((entry) => Math.max(0, Math.trunc(entry)));
}

function parseJson<T>(json: string): T | undefined {
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}
