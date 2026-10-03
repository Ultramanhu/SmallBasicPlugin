import {
  ExitedEvent,
  Handles,
  InitializedEvent,
  LoggingDebugSession,
  OutputEvent,
  Scope,
  Source,
  StackFrame,
  StoppedEvent,
  TerminatedEvent,
  Thread
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { ValueKind } from "smallbasic-lang-core";
import {
  DebugEngineDriver,
  type DebugBreakpoint,
  type DebugBreakpointRequest,
  type DebugVariableValue
} from "./engine-driver";

const THREAD_ID = 1;

/** Resolves source paths for the debugger (local file system or in-memory). */
export interface DebugSourceAccessor {
  resolvePath(filePath: string): string;
  basename(filePath: string): string;
  readFile(filePath: string): string;
}

/** Transient variable containers; globals stay live so stops read fresh values. */
type VariableContainer =
  | { kind: "globals" }
  | { kind: "locals"; frameId: number }
  | { kind: "array"; value: DebugVariableValue };

/**
 * DAP adapter for the JavaScript backend in the extension host.
 *
 * All engine semantics live in {@link DebugEngineDriver} so that the browser
 * runtime of `mode: "web"` (`src/runhost/web-debug.ts`) shares exactly one
 * implementation of breakpoints/stepping; this class only maps DAP to the
 * driver and back.
 *
 * Used by the CLI JavaScript backend (the external `dist/debug/adapter.js`
 * process) and, before `mode: "web"` moved to the webview, by the Web extension
 * host.
 */
export class SmallBasicDebugSession extends LoggingDebugSession {
  private readonly driver: DebugEngineDriver;
  private readonly variableHandles = new Handles<VariableContainer>();
  private programPath = "";
  private stopOnEntry = false;
  private configurationDone = false;
  private loaded = false;
  private executionStarted = false;
  private terminated = false;

  public constructor(private readonly sources: DebugSourceAccessor) {
    super("smallbasic-debug.log");
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
    this.driver = new DebugEngineDriver(
      {
        onOutput: (text) => this.sendEvent(new OutputEvent(text)),
        onStopped: (reason) => this.sendEvent(new StoppedEvent(reason, THREAD_ID)),
        onInputRequested: (kind) => this.onInputRequested(kind),
        onTerminated: (exitCode) => this.endSession(exitCode)
      },
      sources
    );
  }

  protected override initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments
  ): void {
    this.configurationDone = false;
    this.loaded = false;
    this.executionStarted = false;
    this.terminated = false;
    response.body = {
      supportsConfigurationDoneRequest: true,
      supportsConditionalBreakpoints: true,
      supportsEvaluateForHovers: true,
      supportsStepBack: false,
      supportsRestartRequest: false
    };

    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected override async launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: DebugProtocol.LaunchRequestArguments & { program: string; stopOnEntry?: boolean }
  ): Promise<void> {
    this.programPath = this.sources.resolvePath(String(args.program));
    this.stopOnEntry = !!args.stopOnEntry;
    this.executionStarted = false;
    this.terminated = false;

    try {
      this.driver.load(this.programPath);
      this.loaded = true;
      // Breakpoints may have been set before launch; verify them against the
      // program that is actually running.
      this.driver.reverifyBreakpoints(this.programPath);
      this.sendResponse(response);
      this.startExecutionAfterConfiguration();
    } catch (error) {
      this.sendErrorResponse(response, 2001, error instanceof Error ? error.message : String(error));
    }
  }

  protected override configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    _args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    this.configurationDone = true;
    this.sendResponse(response);
    this.startExecutionAfterConfiguration();
  }

  protected override setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): void {
    const sourcePath = args.source.path ? this.sources.resolvePath(args.source.path) : this.programPath;
    const requested: DebugBreakpointRequest[] = args.breakpoints
      ? args.breakpoints.map((breakpoint) => ({
          line: breakpoint.line - 1,
          condition: breakpoint.condition?.trim() || undefined
        }))
      : (args.lines ?? []).map((line) => ({ line: line - 1 }));
    const verified: DebugBreakpoint[] = sourcePath
      ? this.driver.setBreakpoints(sourcePath, requested)
      : requested.map((breakpoint) => ({ ...breakpoint, verified: false }));

    response.body = {
      breakpoints: verified.map((breakpoint) => {
        const result: DebugProtocol.Breakpoint = {
          verified: breakpoint.verified,
          line: (breakpoint.actualLine ?? breakpoint.line) + 1
        };
        if (!breakpoint.verified && breakpoint.condition) {
          result.message = `无法编译条件: ${breakpoint.condition}`;
        }
        return result;
      })
    };

    this.sendResponse(response);
  }

  protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = {
      threads: [new Thread(THREAD_ID, "Main")]
    };
    this.sendResponse(response);
  }

  protected override stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    _args: DebugProtocol.StackTraceArguments
  ): void {
    const stackFrames = this.driver.frames().map((frame) => {
      const source = new Source(this.sources.basename(this.programPath || "program.sb"), this.programPath);
      return new StackFrame(frame.id, frame.name, source, frame.line + 1, frame.column + 1);
    });

    response.body = {
      stackFrames,
      totalFrames: stackFrames.length
    };
    this.sendResponse(response);
  }

  protected override scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments
  ): void {
    response.body = {
      scopes: [
        new Scope("Globals", this.variableHandles.create({ kind: "globals" }), false),
        new Scope("Locals", this.variableHandles.create({ kind: "locals", frameId: args.frameId }), false)
      ]
    };
    this.sendResponse(response);
  }

  protected override variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    const container = this.variableHandles.get(args.variablesReference);
    const variables = !container
      ? []
      : container.kind === "globals"
        ? this.driver.variables()
        : container.kind === "locals"
          ? this.driver.localVariables(container.frameId)
          : this.driver.expand(container.value);
    response.body = {
      variables: variables.map((variable) => this.createVariable(variable))
    };
    this.sendResponse(response);
  }

  protected override continueRequest(
    response: DebugProtocol.ContinueResponse,
    _args: DebugProtocol.ContinueArguments
  ): void {
    this.sendResponse(response);
    this.driver.continueExecution();
  }

  protected override nextRequest(
    response: DebugProtocol.NextResponse,
    _args: DebugProtocol.NextArguments
  ): void {
    this.sendResponse(response);
    this.driver.step(this.driver.frames().length, "next");
  }

  protected override stepInRequest(
    response: DebugProtocol.StepInResponse,
    _args: DebugProtocol.StepInArguments
  ): void {
    this.sendResponse(response);
    this.driver.step(this.driver.frames().length, "stepIn");
  }

  protected override stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    _args: DebugProtocol.StepOutArguments
  ): void {
    this.sendResponse(response);
    this.driver.step(this.driver.frames().length, "stepOut");
  }

  protected override pauseRequest(
    response: DebugProtocol.PauseResponse,
    _args: DebugProtocol.PauseArguments
  ): void {
    this.driver.pause();
    this.sendResponse(response);
  }

  protected override disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    _args: DebugProtocol.DisconnectArguments
  ): void {
    this.driver.terminate();
    this.sendResponse(response);
    this.endSession(0);
  }

  protected override evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): void {
    const expression = args.expression.trim();

    if (this.driver.isWaitingForInput) {
      this.driver.submitInput(expression);
      response.body = {
        result: expression,
        variablesReference: 0
      };
      this.sendResponse(response);
      return;
    }

    const value = this.driver.evaluate(expression, args.frameId ?? 1)
      ?? this.driver.findVariable(expression, args.frameId ?? 1);
    if (value) {
      response.body = {
        result: value.value,
        variablesReference: value.array ? this.variableHandles.create({ kind: "array", value }) : 0
      };
      this.sendResponse(response);
      return;
    }

    this.sendErrorResponse(response, 2002, `无法计算表达式: ${expression}`);
  }

  private startExecutionAfterConfiguration(): void {
    if (!this.configurationDone || !this.loaded || this.executionStarted) {
      return;
    }

    this.executionStarted = true;
    this.driver.begin(this.stopOnEntry);
  }

  private onInputRequested(kind: ValueKind): void {
    this.sendEvent(new OutputEvent(kind === ValueKind.Number ? "\n[Input] 请输入数字后在 Debug Console 中按回车。\n" : "\n[Input] 请输入文本后在 Debug Console 中按回车。\n"));
    const stopped: DebugProtocol.StoppedEvent = {
      seq: 0,
      type: "event",
      event: "stopped",
      body: {
        reason: "pause",
        description: "Waiting for input",
        threadId: THREAD_ID,
        allThreadsStopped: true
      }
    };
    this.sendEvent(stopped);
  }

  private createVariable(variable: DebugVariableValue): DebugProtocol.Variable {
    return {
      name: variable.name,
      value: variable.value,
      variablesReference: variable.array ? this.variableHandles.create({ kind: "array", value: variable }) : 0
    };
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
