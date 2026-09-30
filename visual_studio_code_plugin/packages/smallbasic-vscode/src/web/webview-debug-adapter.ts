import {
  ExitedEvent,
  Handles,
  InitializedEvent,
  LoggingDebugSession,
  OutputEvent,
  Scope,
  Source,
  StackFrame,
  TerminatedEvent,
  Thread
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import type { DebugSourceAccessor } from "../debug/session";
import type { WebDebugEvent, WebDebugVariable } from "./debug-protocol";
import type { WebDebugSessionBroker } from "./debug-broker";

const THREAD_ID = 1;

export type WebviewDebugBackend = "javascript" | "blazor";

export interface WebviewDebugOptions {
  /** Which in-page engine the broker drives; only affects labels and capabilities. */
  backend: WebviewDebugBackend;
  /** Closes the webview panel / output channel owned by the factory. */
  close?: () => void;
}

/**
 * Browser-compatible DAP adapter for both webview backends.
 *
 * It contains no runtime logic: every request is translated into a wire command
 * of `debug-protocol.ts` and forwarded to the in-page engine (the JavaScript
 * runtime or Blazor WebAssembly) by {@link WebDebugSessionBroker}; the runtime's
 * events are translated back into DAP events. This is why the two `mode: "web"`
 * backends behave the same - they are driven by one adapter over one protocol.
 *
 * The engine semantics themselves live once in `../debug/engine-driver.ts` and
 * `SmallBasic.Blazor.Client/Runtime/BrowserEngineSession.cs`.
 *
 * All runtime lines are 0-based; the DAP boundary converts to/from 1-based.
 */
export class WebviewDebugSession extends LoggingDebugSession {
  private programPath = "";
  private breakpoints: number[] = [];
  private snapshot: { line: number; frames: ReadonlyArray<{ name: string; line: number }>; variables: readonly WebDebugVariable[] } | undefined;
  private readonly variableHandles = new Handles<readonly WebDebugVariable[]>();
  private readonly subscription: { dispose(): void };
  private waitingForInput = false;
  private terminated = false;

  public constructor(
    private readonly broker: WebDebugSessionBroker,
    private readonly sources: DebugSourceAccessor,
    private readonly options: WebviewDebugOptions
  ) {
    super("smallbasic-web-debug.log");
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
    this.subscription = broker.onEvent((event) => this.onRuntimeEvent(event));
  }

  protected override initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments
  ): void {
    response.body = {
      supportsConfigurationDoneRequest: true,
      // The JavaScript runtime evaluates conditions (`DebugEngineDriver`);
      // the Blazor runtime aligns with SmallBasic.Blazor.RunHost, which has none.
      supportsConditionalBreakpoints: this.options.backend === "javascript",
      supportsEvaluateForHovers: false,
      supportsStepBack: false,
      supportsRestartRequest: false
    };

    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected override launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: DebugProtocol.LaunchRequestArguments & { program?: string; stopOnEntry?: boolean }
  ): void {
    // The broker was already launched by the shared inline factory (the webview
    // has to boot before the first command); this only records the source for
    // stack frames and replies to the client.
    if (typeof args.program === "string" && args.program.length > 0) {
      this.programPath = this.sources.resolvePath(args.program);
    }

    this.sendResponse(response);
  }

  protected override async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): Promise<void> {
    const requested = args.breakpoints
      ? args.breakpoints.map((breakpoint) => ({
          line: Math.max(0, breakpoint.line - 1),
          condition: breakpoint.condition?.trim() || undefined
        }))
      : (args.lines ?? []).map((line) => ({ line: Math.max(0, line - 1), condition: undefined }));

    try {
      const validated = await this.broker.setBreakpoints(
        requested.map((entry) => entry.line),
        requested.map((entry) => entry.condition)
      );
      this.breakpoints = validated;
      response.body = {
        breakpoints: requested.map((entry) => {
          const actual = validated.find((candidate) => candidate >= entry.line);
          const result: DebugProtocol.Breakpoint = {
            verified: actual !== undefined,
            line: (actual ?? entry.line) + 1
          };
          if (actual === undefined) {
            result.message = entry.condition
              ? `无法编译条件: ${entry.condition}`
              : "该行及之后没有可执行的 Small Basic 语句。";
          }

          return result;
        })
      };
    } catch (error) {
      response.body = {
        breakpoints: requested.map((entry) => ({ verified: false, line: entry.line + 1 }))
      };
      this.emitDiagnostic(error);
    }

    this.sendResponse(response);
  }

  protected override configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    _args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    this.sendResponse(response);
    this.broker.start(this.breakpoints);
  }

  protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = {
      threads: [new Thread(THREAD_ID, this.options.backend === "javascript" ? "JavaScript" : "Blazor WASM")]
    };
    this.sendResponse(response);
  }

  protected override stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    _args: DebugProtocol.StackTraceArguments
  ): void {
    const snapshot = this.snapshot;
    const rawFrames = snapshot && snapshot.frames.length > 0
      ? snapshot.frames
      : snapshot ? [{ name: "Program", line: snapshot.line }] : [];
    const frames = rawFrames.map((frame, index) => {
      const source = new Source(this.sources.basename(this.programPath || "program.sb"), this.programPath);
      return new StackFrame(index + 1, frame.name || "Program", source, frame.line + 1, 1);
    });

    response.body = { stackFrames: frames, totalFrames: frames.length };
    this.sendResponse(response);
  }

  protected override scopesRequest(
    response: DebugProtocol.ScopesResponse,
    _args: DebugProtocol.ScopesArguments
  ): void {
    response.body = {
      scopes: [new Scope("Globals", this.variableHandles.create(this.snapshot?.variables ?? []), false)]
    };
    this.sendResponse(response);
  }

  protected override variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    const container = this.variableHandles.get(args.variablesReference);
    response.body = { variables: (container ?? []).map((variable) => this.toVariable(variable)) };
    this.sendResponse(response);
  }

  protected override continueRequest(
    response: DebugProtocol.ContinueResponse,
    _args: DebugProtocol.ContinueArguments
  ): void {
    this.waitingForInput = false;
    this.sendResponse(response);
    this.broker.control("continue", this.currentDepth());
  }

  protected override nextRequest(
    response: DebugProtocol.NextResponse,
    _args: DebugProtocol.NextArguments
  ): void {
    this.waitingForInput = false;
    this.sendResponse(response);
    this.broker.control("next", this.currentDepth());
  }

  protected override stepInRequest(
    response: DebugProtocol.StepInResponse,
    _args: DebugProtocol.StepInArguments
  ): void {
    this.waitingForInput = false;
    this.sendResponse(response);
    this.broker.control("stepIn", this.currentDepth());
  }

  protected override stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    _args: DebugProtocol.StepOutArguments
  ): void {
    this.waitingForInput = false;
    this.sendResponse(response);
    this.broker.control("stepOut", this.currentDepth());
  }

  protected override pauseRequest(
    response: DebugProtocol.PauseResponse,
    _args: DebugProtocol.PauseArguments
  ): void {
    this.sendResponse(response);
    this.broker.control("pause", this.currentDepth());
  }

  protected override evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): void {
    const expression = (args.expression ?? "").trim();

    if (this.waitingForInput) {
      this.waitingForInput = false;
      this.broker.input(expression);
      response.body = { result: expression, variablesReference: 0 };
      this.sendResponse(response);
      return;
    }

    const value = this.findVariable(expression);
    if (value) {
      response.body = {
        result: value.value,
        variablesReference: value.children.length > 0 ? this.variableHandles.create(value.children) : 0
      };
      this.sendResponse(response);
      return;
    }

    this.sendErrorResponse(response, 2002, `无法计算表达式: ${expression}`);
  }

  protected override async disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    _args: DebugProtocol.DisconnectArguments
  ): Promise<void> {
    await this.broker.terminate().catch(() => undefined);
    this.broker.dispose();
    this.subscription.dispose();
    this.options.close?.();
    this.sendResponse(response);
    this.endSession(0);
  }

  private onRuntimeEvent(event: WebDebugEvent): void {
    switch (event.kind) {
      case "output":
        this.sendEvent(new OutputEvent(event.text));
        return;
      case "stopped":
        this.snapshot = { line: event.line, frames: event.frames, variables: event.variables };
        this.resetVariableHandles();
        this.sendStopped(event.reason || "pause");
        return;
      case "input":
        this.snapshot = { line: event.line, frames: event.frames, variables: event.variables };
        this.resetVariableHandles();
        this.waitingForInput = true;
        this.sendEvent(new OutputEvent(event.numberInput
          ? "\n[Input] 请在 Debug Console 输入一个数字后回车。\n"
          : "\n[Input] 请在 Debug Console 输入文本后回车。\n"));
        this.sendStopped("pause", event.numberInput ? "Waiting for TextWindow number" : "Waiting for TextWindow input");
        return;
      case "terminated":
        this.endSession(event.exitCode);
        return;
      case "error":
        this.sendEvent(new OutputEvent(`[Webview] ${event.message}\n`, "stderr"));
        return;
      default:
        return;
    }
  }

  private currentDepth(): number {
    return this.snapshot?.frames.length ?? 0;
  }

  /**
   * `@vscode/debugadapter`'s `StoppedEvent` cannot carry a description, but both
   * the JavaScript adapter and the CLI Blazor adapter publish one for input
   * waits. Sending the raw event keeps every adapter consistent.
   */
  private sendStopped(reason: string, description?: string): void {
    const stopped: DebugProtocol.StoppedEvent = {
      seq: 0,
      type: "event",
      event: "stopped",
      body: {
        reason,
        threadId: THREAD_ID,
        allThreadsStopped: true,
        ...(description ? { description } : {})
      }
    };
    this.sendEvent(stopped);
  }

  private resetVariableHandles(): void {
    this.variableHandles.reset();
  }

  private toVariable(variable: WebDebugVariable): DebugProtocol.Variable {
    return {
      name: variable.name,
      value: variable.value,
      variablesReference: variable.children.length > 0 ? this.variableHandles.create(variable.children) : 0
    };
  }

  private findVariable(name: string): WebDebugVariable | undefined {
    const variables = this.snapshot?.variables ?? [];
    const exact = variables.find((variable) => variable.name === name);
    if (exact) {
      return exact;
    }

    const lower = name.toLowerCase();
    return variables.find((variable) => variable.name.toLowerCase() === lower);
  }

  private emitDiagnostic(error: unknown): void {
    const text = error instanceof Error ? error.message : String(error);
    this.sendEvent(new OutputEvent(`[Debug] ${text}\n`, "stderr"));
  }

  private endSession(exitCode: number): void {
    if (this.terminated) {
      return;
    }

    this.terminated = true;
    this.sendEvent(new ExitedEvent(exitCode));
    this.sendEvent(new TerminatedEvent());
  }
}
