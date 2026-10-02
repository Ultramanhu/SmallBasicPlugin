/**
 * DebugTransport over the CLI DAP adapters (doc 10, §18.3).
 *
 * The Rust process layer owns the stdio pipe, the Content-Length framing and
 * DAP sequence numbers; this transport maps the page's web debug protocol
 * (0-based lines, `PlaygroundDebugController` command shapes) onto DAP
 * requests and DAP events back onto the controller's event model. The shared
 * debug UI cannot tell a Web session from a CLI session - only this
 * transport and the capability matrix differ.
 *
 * Line conversions are centralised here: the web protocol is 0-based, DAP is
 * 1-based (both CLI adapters run with linesStartAt1).
 */
import type { CliBackendId, DesktopBridge, SessionEvent, SessionStartInfo } from "./desktop-bridge";
import type {
  DebugCommand,
  DebugEvent,
  DebugStackFrame,
  DebugTransport,
  DebugVariable
} from "../../smallbasic-vscode/src/playground/debug-controller";

export interface CliDebugSinks {
  /** Protocol-shaped events for `PlaygroundDebugController`. */
  emit(event: DebugEvent): void;
  /** Adapter console output (TextWindow writes, host banners). */
  onOutput(text: string): void;
}

interface DapMessage {
  seq?: number;
  type?: "request" | "response" | "event";
  request_seq?: number;
  success?: boolean;
  command?: string;
  message?: string;
  event?: string;
  body?: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (body: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

const REQUEST_TIMEOUT_MS = 10_000;
const VARIABLE_CHILDREN_LIMIT = 100;

/**
 * The CLI adapter announces a pending `TextWindow.ReadNumber` only through an
 * `output` line (the DAP `stopped` event itself carries no value kind):
 * `[Input] Type a number in the Debug Console...`. Anchor on the Debug Console
 * banner plus the number keyword so ordinary program output cannot flip the
 * prompt into ReadNumber mode.
 */
const NUMBER_INPUT_HINT = /debug console/i;
const NUMBER_INPUT_KEYWORD = /number|数字/i;

export class LocalCliDebugTransport implements DebugTransport {
  private readonly pending = new Map<number, PendingRequest>();
  /** Responses that arrived before `debug_request` resolved its seq number. */
  private readonly earlyResponses = new Map<number, { success: boolean; message: DapMessage }>();
  private started = false;
  private disposed = false;
  private session: SessionStartInfo | undefined;
  private programName = "program.sb";
  private exitCode: number | undefined;
  /** Last output hint about numeric input, used for the input-row prompt. */
  private numberInputHint = false;

  public constructor(
    private readonly bridge: DesktopBridge,
    private readonly backend: CliBackendId,
    private readonly sinks: CliDebugSinks
  ) {}

  public async launch(payload: { sessionId: string; name: string; source: string }): Promise<void> {
    this.programName = payload.name || this.programName;
    // Rust sends the DAP `initialize` request right after spawning the
    // adapter; the adapter's `initialized` event (relayed below) is what
    // makes the controller send setBreakpoints + start.
    this.session = await this.bridge.startDebug({
      backend: this.backend,
      name: payload.name,
      source: payload.source,
      onEvent: (event) => this.onSessionEvent(event)
    });
    this.started = true;
  }

  public async send(command: DebugCommand): Promise<void> {
    if (!this.started || this.disposed) {
      return;
    }

    try {
      switch (command.type) {
        case "setBreakpoints":
          await this.setBreakpoints(command.breakpoints);
          break;
        case "start":
          await this.launchProgram();
          break;
        case "control":
          await this.sendControl(command.control, command.depth);
          break;
        case "input":
          // The C# adapter uses `evaluate` as the Debug Console input channel
          // while the engine waits on TextWindow (see its HandleEvaluate
          // implementation); frameId is ignored there.
          await this.request("evaluate", { expression: command.text, context: "repl" });
          break;
        case "stop":
          // Protocol-level disconnect first; the Rust shell terminates the
          // child tree after a grace period (doc 10, §18.2).
          await this.bridge.debugRequest(this.sessionId(), "disconnect", {}).catch(() => undefined);
          await this.bridge.terminateSession(this.sessionId()).catch(() => undefined);
          break;
      }
    } catch (error) {
      if (!this.disposed) {
        this.sinks.emit({ type: "error", message: describe(error) });
      }
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Debug session ended."));
    }
    this.pending.clear();

    if (this.started) {
      void this.bridge.terminateSession(this.sessionId()).catch(() => undefined);
    }
  }

  private sessionId(): string {
    if (!this.session) {
      throw new Error("The CLI debug session has not started.");
    }

    return this.session.sessionId;
  }

  private async setBreakpoints(breakpoints: readonly number[]): Promise<void> {
    const body = await this.request("setBreakpoints", {
      source: { name: this.programName, path: this.session?.programPath ?? this.programName },
      lines: breakpoints.map((line) => line + 1),
      breakpoints: breakpoints.map((line) => ({ line: line + 1 }))
    });

    const declared = Array.isArray((body as { breakpoints?: unknown }).breakpoints)
      ? ((body as { breakpoints: Array<Record<string, unknown>> }).breakpoints)
      : [];
    const validated = declared
      .filter((item) => item.verified === true && typeof item.line === "number")
      .map((item) => (item.line as number) - 1);
    if (validated.length > 0) {
      this.sinks.emit({ type: "breakpointsValidated", breakpoints: validated });
    }
  }

  private async launchProgram(): Promise<void> {
    if (!this.session) {
      throw new Error("The CLI debug session has not started.");
    }

    const body = await this.request("launch", {
      program: this.session.programPath,
      name: this.programName,
      stopOnEntry: false
    }).catch(async (error: Error) => {
      this.sinks.emit({ type: "error", message: error.message });
      throw error;
    });
    void body;
    await this.request("configurationDone", {});
  }

  private async sendControl(control: "pause" | "next" | "stepIn" | "stepOut" | "continue", depth?: number): Promise<void> {
    // The web protocol carries the paused stack depth for the web engine's
    // own step implementation; the CLI adapters track depth internally and
    // only need the thread id.
    void depth;
    switch (control) {
      case "pause":
        await this.request("pause", { threadId: 1 });
        break;
      case "continue":
        await this.request("continue", { threadId: 1 });
        break;
      case "next":
        await this.request("next", { threadId: 1 });
        break;
      case "stepIn":
        await this.request("stepIn", { threadId: 1 });
        break;
      case "stepOut":
        await this.request("stepOut", { threadId: 1 });
        break;
    }
  }

  private onSessionEvent(event: SessionEvent): void {
    if (event.kind !== "dap") {
      return;
    }

    const message = event.message as DapMessage;
    if (message.type === "response") {
      const requestSeq = message.request_seq ?? -1;
      const pending = this.pending.get(requestSeq);
      const success = message.success === true;
      if (!pending) {
        // The channel event may beat the `debug_request` invoke result;
        // remember the response so registration can pick it up.
        this.earlyResponses.set(requestSeq, { success, message });
        return;
      }

      this.pending.delete(requestSeq);
      if (success) {
        pending.resolve(message.body ?? {});
      } else {
        pending.reject(new Error(formatDapError(message)));
      }
      return;
    }

    if (message.type === "event") {
      this.onDapEvent(message);
    }
  }

  private onDapEvent(message: DapMessage): void {
    if (this.disposed) {
      return;
    }

    const body = message.body ?? {};
    switch (message.event) {
      case "initialized":
        this.sinks.emit({ type: "ready" });
        break;
      case "output": {
        const text = typeof body.output === "string" ? body.output : "";
        if (text) {
          if (NUMBER_INPUT_HINT.test(text) && NUMBER_INPUT_KEYWORD.test(text)) {
            this.numberInputHint = true;
          }
          this.sinks.onOutput(text);
        }
        break;
      }
      case "stopped":
        void this.onStopped(body);
        break;
      case "breakpoint": {
        const breakpoint = (body.breakpoint ?? {}) as Record<string, unknown>;
        if (breakpoint.verified === true && typeof breakpoint.line === "number" && breakpoint.line > 0) {
          this.sinks.emit({ type: "breakpointsValidated", breakpoints: [breakpoint.line - 1] });
        }
        break;
      }
      case "exited":
        if (typeof body.exitCode === "number") {
          this.exitCode = body.exitCode;
        }
        break;
      case "terminated":
        this.sinks.emit({ type: "terminated", exitCode: this.exitCode ?? 0 });
        break;
      default:
        break;
    }
  }

  /** DAP `stopped` -> web `stopped`/`input`, fetching stack and variables. */
  private async onStopped(body: Record<string, unknown>): Promise<void> {
    const description = `${String(body.description ?? "")} ${String(body.text ?? "")}`;
    const waitingForInput = /input/i.test(description);

    let frames: DebugStackFrame[] = [];
    let variables: DebugVariable[] = [];
    try {
      const stack = await this.request("stackTrace", { threadId: 1, levels: 20 });
      frames = this.toFrames(stack);
      variables = await this.collectVariables(frames);
    } catch {
      // A paused program without inspectable state still shows the current line.
    }

    const line = typeof body.line === "number" && body.line > 0
      ? body.line - 1
      : frames[0]?.line ?? 0;

    if (waitingForInput) {
      this.sinks.emit({
        type: "input",
        line,
        frames,
        variables,
        numberInput: this.numberInputHint
      });
      this.numberInputHint = false;
      return;
    }

    this.sinks.emit({
      type: "stopped",
      reason: typeof body.reason === "string" ? body.reason : undefined,
      line,
      frames,
      variables
    });
  }

  private toFrames(stack: Record<string, unknown>): DebugStackFrame[] {
    const declared = Array.isArray(stack.stackFrames) ? (stack.stackFrames as Array<Record<string, unknown>>) : [];
    const frames: DebugStackFrame[] = [];
    for (const frame of declared) {
      if (typeof frame.line !== "number" || frame.line <= 0) {
        continue;
      }

      frames.push({
        name: typeof frame.name === "string" ? frame.name : "Main",
        line: frame.line - 1
      });
    }
    return frames;
  }

  private async collectVariables(frames: readonly DebugStackFrame[]): Promise<DebugVariable[]> {
    if (frames.length === 0) {
      return [];
    }

    const scopes = await this.request("scopes", { frameId: 1 });
    const declared = Array.isArray(scopes.scopes) ? (scopes.scopes as Array<Record<string, unknown>>) : [];
    const globals = declared.find((scope) => String(scope.name ?? "").toLowerCase() === "globals")
      ?? declared[0];
    if (!globals || typeof globals.variablesReference !== "number" || globals.variablesReference <= 0) {
      return [];
    }

    const rootVariables = await this.request("variables", { variablesReference: globals.variablesReference });
    return this.toVariableTree(rootVariables, 0);
  }

  private async toVariableTree(body: Record<string, unknown>, depth: number): Promise<DebugVariable[]> {
    const declared = Array.isArray(body.variables) ? (body.variables as Array<Record<string, unknown>>) : [];
    const variables: DebugVariable[] = [];
    for (const item of declared.slice(0, VARIABLE_CHILDREN_LIMIT)) {
      const variable: DebugVariable = {
        name: String(item.name ?? ""),
        value: String(item.value ?? "")
      };

      const reference = typeof item.variablesReference === "number" ? item.variablesReference : 0;
      if (reference > 0 && depth < 1) {
        try {
          const children = await this.request("variables", { variablesReference: reference });
          variable.children = await this.toVariableTree(children, depth + 1);
        } catch {
          // Leave the childless entry; the value text still renders.
        }
      }

      variables.push(variable);
    }
    return variables;
  }

  private request(command: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.started || this.disposed) {
      return Promise.reject(new Error("The CLI debug session has ended."));
    }

    // `debug_request` resolves with the DAP sequence number the Rust framer
    // assigned; responses are correlated through that number.
    const registration: { seq?: number; timedOut: boolean } = { timedOut: false };
    const registered = this.bridge.debugRequest(this.sessionId(), command, args);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        registration.timedOut = true;
        if (registration.seq !== undefined) {
          this.pending.delete(registration.seq);
        }
        reject(new Error(`DAP request '${command}' timed out.`));
      }, REQUEST_TIMEOUT_MS);

      const settleResolve = (body: Record<string, unknown>) => {
        window.clearTimeout(timer);
        resolve(body);
      };
      const settleReject = (error: Error) => {
        window.clearTimeout(timer);
        reject(error);
      };

      registered.then((seq) => {
        if (registration.timedOut) {
          return;
        }

        const early = this.earlyResponses.get(seq);
        if (early) {
          this.earlyResponses.delete(seq);
          if (early.success) {
            settleResolve(early.message.body ?? {});
          } else {
            settleReject(new Error(formatDapError(early.message)));
          }
          return;
        }

        registration.seq = seq;
        this.pending.set(seq, { resolve: settleResolve, reject: settleReject });
      }, (error: unknown) => {
        settleReject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

function formatDapError(message: DapMessage): string {
  const body = (message.body ?? {}) as { error?: { format?: string } };
  return body.error?.format || message.message || "The CLI debug adapter rejected the request.";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
