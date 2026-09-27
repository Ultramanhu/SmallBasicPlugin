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
import {
  ArrayValue,
  BaseValue,
  Compilation,
  CompiledDebugExpression,
  compileDebugExpression,
  evaluateDebugCondition,
  ExecutionEngine,
  ExecutionMode,
  ExecutionState,
  ITextWindowLibraryPlugin,
  NumberValue,
  StringValue,
  TextWindowColor,
  ValueKind
} from "smallbasic-lang-core";

const THREAD_ID = 1;

export interface DebugSourceAccessor {
  resolvePath(filePath: string): string;
  basename(filePath: string): string;
  readFile(filePath: string): string;
}

type RunControl =
  | { kind: "continue" }
  | { kind: "stepIn"; depth: number }
  | { kind: "next"; depth: number }
  | { kind: "stepOut"; depth: number };

type VariableContainer =
  | { kind: "globals" }
  | { kind: "array"; value: ArrayValue };

type SessionBreakpoint = {
  requestedLine: number;
  actualLine?: number;
  verified: boolean;
  condition?: string;
  compiledCondition?: CompiledDebugExpression;
};

class DebugTextWindow implements ITextWindowLibraryPlugin {
  private readonly inputBuffer: BaseValue[] = [];
  private foreground = TextWindowColor.White;
  private background = TextWindowColor.Black;
  private requestedInputKind: ValueKind | undefined;

  public constructor(private readonly session: SmallBasicDebugSession) {}

  public inputIsNeeded(kind: ValueKind): void {
    this.requestedInputKind = kind;
    this.session.onInputRequested(kind);
  }

  public checkInputBuffer(): BaseValue | undefined {
    return this.inputBuffer.shift();
  }

  public writeText(value: string, appendNewLine: boolean): void {
    this.session.emitOutput(value + (appendNewLine ? "\n" : ""));
  }

  public getForegroundColor(): TextWindowColor {
    return this.foreground;
  }

  public setForegroundColor(color: TextWindowColor): void {
    this.foreground = color;
  }

  public getBackgroundColor(): TextWindowColor {
    return this.background;
  }

  public setBackgroundColor(color: TextWindowColor): void {
    this.background = color;
  }

  public pushInput(raw: string): void {
    if (this.requestedInputKind === ValueKind.Number) {
      const parsed = Number(raw);
      this.inputBuffer.push(new NumberValue(Number.isFinite(parsed) ? parsed : 0));
    } else {
      this.inputBuffer.push(new StringValue(raw));
    }

    this.requestedInputKind = undefined;
  }

  public isWaitingForInput(): boolean {
    return this.requestedInputKind !== undefined;
  }
}

export class SmallBasicDebugSession extends LoggingDebugSession {
  private programPath = "";
  private compilation: Compilation | undefined;
  private engine: ExecutionEngine | undefined;
  private readonly breakpointMap = new Map<string, SessionBreakpoint[]>();
  private readonly variableHandles = new Handles<VariableContainer>();
  private readonly textWindow = new DebugTextWindow(this);

  private configurationDone = false;
  private executionStarted = false;
  private stopOnEntry = false;
  private running = false;
  private pauseRequested = false;
  private initialLocationChecked = false;
  private terminated = false;
  private activeControl: RunControl = { kind: "continue" };

  public constructor(private readonly sources: DebugSourceAccessor) {
    super("smallbasic-debug.log");
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  protected override initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments
  ): void {
    this.configurationDone = false;
    this.executionStarted = false;
    response.body = {
      supportsConfigurationDoneRequest: true,
      supportsConditionalBreakpoints: true,
      supportsEvaluateForHovers: false,
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
    this.initialLocationChecked = false;
    this.terminated = false;

    try {
      this.compilation = this.loadCompilation(this.programPath);
      this.engine = new ExecutionEngine(this.compilation);
      this.engine.libraries.TextWindow.plugin = this.textWindow;
      this.breakpointMap.set(this.normalizePath(this.programPath), this.verifyBreakpoints(this.programPath, this.breakpointMap.get(this.normalizePath(this.programPath)) ?? []));
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
    const requested: SessionBreakpoint[] = args.breakpoints
      ? args.breakpoints.map((breakpoint) => ({
          requestedLine: breakpoint.line - 1,
          verified: false,
          condition: breakpoint.condition?.trim() || undefined
        }))
      : (args.lines ?? []).map((line) => ({ requestedLine: line - 1, verified: false }));
    const verified = sourcePath ? this.verifyBreakpoints(sourcePath, requested) : requested;

    if (sourcePath) {
      this.breakpointMap.set(this.normalizePath(sourcePath), verified);
    }

    response.body = {
      breakpoints: verified.map((breakpoint) => {
        const result: DebugProtocol.Breakpoint = {
          verified: breakpoint.verified,
          line: (breakpoint.actualLine ?? breakpoint.requestedLine) + 1
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
    const stackFrames = this.getExecutionFrames().map((frame, index) => {
      const instruction = this.getInstructionForFrame(frame.moduleName, frame.instructionIndex);
      const source = new Source(this.sources.basename(this.programPath || "program.sb"), this.programPath);
      return new StackFrame(index + 1, frame.moduleName, source, (instruction?.sourceRange.start.line ?? 0) + 1, (instruction?.sourceRange.start.column ?? 0) + 1);
    });

    response.body = {
      stackFrames,
      totalFrames: stackFrames.length
    };
    this.sendResponse(response);
  }

  protected override scopesRequest(
    response: DebugProtocol.ScopesResponse,
    _args: DebugProtocol.ScopesArguments
  ): void {
    response.body = {
      scopes: [new Scope("Globals", this.variableHandles.create({ kind: "globals" }), false)]
    };
    this.sendResponse(response);
  }

  protected override variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    const container = this.variableHandles.get(args.variablesReference);
    response.body = {
      variables: container ? this.expandVariables(container) : []
    };
    this.sendResponse(response);
  }

  protected override continueRequest(
    response: DebugProtocol.ContinueResponse,
    _args: DebugProtocol.ContinueArguments
  ): void {
    this.activeControl = { kind: "continue" };
    this.pauseRequested = false;
    this.sendResponse(response);
    this.resumeExecution();
  }

  protected override nextRequest(
    response: DebugProtocol.NextResponse,
    _args: DebugProtocol.NextArguments
  ): void {
    this.activeControl = { kind: "next", depth: this.getStackDepth() };
    this.pauseRequested = false;
    this.sendResponse(response);
    this.resumeExecution();
  }

  protected override stepInRequest(
    response: DebugProtocol.StepInResponse,
    _args: DebugProtocol.StepInArguments
  ): void {
    this.activeControl = { kind: "stepIn", depth: this.getStackDepth() };
    this.pauseRequested = false;
    this.sendResponse(response);
    this.resumeExecution();
  }

  protected override stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    _args: DebugProtocol.StepOutArguments
  ): void {
    this.activeControl = { kind: "stepOut", depth: this.getStackDepth() };
    this.pauseRequested = false;
    this.sendResponse(response);
    this.resumeExecution();
  }

  protected override pauseRequest(
    response: DebugProtocol.PauseResponse,
    _args: DebugProtocol.PauseArguments
  ): void {
    this.pauseRequested = true;
    this.sendResponse(response);
  }

  protected override disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    _args: DebugProtocol.DisconnectArguments
  ): void {
    this.engine?.terminate();
    this.sendResponse(response);
    this.endSession(0);
  }

  protected override evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): void {
    const expression = args.expression.trim();

    if (this.textWindow.isWaitingForInput()) {
      this.textWindow.pushInput(expression);
      response.body = {
        result: expression,
        variablesReference: 0
      };
      this.sendResponse(response);
      this.activeControl = { kind: "continue" };
      this.pauseRequested = false;
      this.resumeExecution();
      return;
    }

    const memory = this.engine?.memory.values;
    const value = memory
      ? memory[expression] ?? memory[Object.keys(memory).find((name) => name.toLowerCase() === expression.toLowerCase()) ?? ""]
      : undefined;
    if (value) {
      response.body = {
        result: value.toDebuggerString(),
        variablesReference: value.kind === ValueKind.Array ? this.variableHandles.create({ kind: "array", value: value as ArrayValue }) : 0
      };
      this.sendResponse(response);
      return;
    }

    this.sendErrorResponse(response, 2002, `无法计算表达式: ${expression}`);
  }

  public emitOutput(text: string): void {
    this.sendEvent(new OutputEvent(text));
  }

  public onInputRequested(kind: ValueKind): void {
    this.emitOutput(kind === ValueKind.Number ? "\n[Input] 请输入数字后在 Debug Console 中按回车。\n" : "\n[Input] 请输入文本后在 Debug Console 中按回车。\n");
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

  private loadCompilation(programPath: string): Compilation {
    let text: string;
    try {
      text = this.sources.readFile(programPath);
    } catch {
      throw new Error(`找不到程序文件: ${programPath}`);
    }

    const compilation = new Compilation(text);
    if (!compilation.isReadyToRun) {
      const message = compilation.diagnostics.map((item) => item.toString()).join("\n");
      throw new Error(message || "Program contains compilation errors.");
    }

    if (compilation.kind.drawsShapes()) {
      throw new Error("当前内置 SmallBasic 调试器暂不支持 GraphicsWindow/Shapes/Turtle/Controls 图形宿主。请先调试文本模式程序，或改用后续图形后端。");
    }

    return compilation;
  }

  private verifyBreakpoints(sourcePath: string, breakpoints: SessionBreakpoint[]): SessionBreakpoint[] {
    let compilation: Compilation | undefined;
    try {
      compilation = this.loadCompilation(sourcePath);
    } catch {
      return breakpoints.map((breakpoint) => ({ ...breakpoint, verified: false }));
    }

    const lines = this.getExecutableLines(compilation);
    return breakpoints.map((breakpoint) => {
      const actualLine = lines.find((line) => line >= breakpoint.requestedLine);
      if (actualLine === undefined) {
        return { ...breakpoint, actualLine, verified: false };
      }

      if (breakpoint.condition) {
        // A condition that does not compile invalidates the breakpoint so the
        // client can surface the problem instead of silently ignoring it.
        const compiledCondition = compileDebugExpression(breakpoint.condition);
        if (!compiledCondition) {
          return { ...breakpoint, actualLine, verified: false, compiledCondition: undefined };
        }

        return { ...breakpoint, actualLine, verified: true, compiledCondition };
      }

      return { ...breakpoint, actualLine, verified: true };
    });
  }

  private getExecutableLines(compilation: Compilation): number[] {
    const executableLines = new Set<number>();
    const modules = compilation.emit();

    for (const instructions of Object.values(modules)) {
      for (const instruction of instructions) {
        executableLines.add(instruction.sourceRange.start.line);
      }
    }

    return [...executableLines].sort((left, right) => left - right);
  }

  private startExecutionAfterConfiguration(): void {
    if (!this.configurationDone || !this.engine || this.executionStarted) {
      return;
    }

    this.executionStarted = true;
    this.activeControl = { kind: "continue" };

    if (this.stopOnEntry) {
      // DAP's entry stop is before the first statement. Calling the engine here
      // would execute line zero before pausing because its first-line sentinel is
      // also zero, so publish the stop directly.
      this.initialLocationChecked = true;
      this.sendEvent(new StoppedEvent("entry", THREAD_ID));
      return;
    }

    this.resumeExecution();
  }

  private resumeExecution(): void {
    if (!this.engine || this.running) {
      return;
    }

    // The execution engine starts at instruction zero but uses line zero as its
    // internal sentinel. Check the initial source location ourselves so a
    // breakpoint on the first line is not skipped.
    if (!this.initialLocationChecked) {
      this.initialLocationChecked = true;
      void this.checkInitialBreakpoint();
      return;
    }

    this.running = true;
    setTimeout(() => void this.executionLoop(), 0);
  }

  private async checkInitialBreakpoint(): Promise<void> {
    if (!this.engine) {
      return;
    }

    if (this.activeControl.kind === "continue" && await this.shouldStopAtLine(this.getCurrentLine())) {
      this.sendEvent(new StoppedEvent("breakpoint", THREAD_ID));
      return;
    }

    this.running = true;
    setTimeout(() => void this.executionLoop(), 0);
  }

  private async executionLoop(): Promise<void> {
    if (!this.engine) {
      this.running = false;
      return;
    }

    const startedAt = Date.now();
    let steps = 0;

    while (this.engine && Date.now() - startedAt < 5 && steps < 128) {
      this.engine.execute(ExecutionMode.NextStatement);
      steps += 1;

      if (this.engine.state === ExecutionState.Terminated) {
        this.running = false;
        if (this.engine.exception) {
          this.emitOutput(`\n[Runtime Error] ${this.engine.exception.toString()}\n`);
        }
        this.endSession(this.engine.exception ? 1 : 0);
        return;
      }

      if (this.engine.state === ExecutionState.BlockedOnInput) {
        this.running = false;
        return;
      }

      if (this.engine.state === ExecutionState.Paused) {
        const stopReason = await this.getStopReason();
        if (stopReason) {
          this.running = false;
          this.sendEvent(new StoppedEvent(stopReason, THREAD_ID));
          return;
        }
      }
    }

    this.running = false;
    if (this.engine && this.engine.state !== ExecutionState.Terminated) {
      this.resumeExecution();
    }
  }

  private async getStopReason(): Promise<DebugProtocol.StoppedEvent["body"]["reason"] | undefined> {
    if (!this.engine) {
      return undefined;
    }

    if (this.pauseRequested) {
      this.pauseRequested = false;
      return "pause";
    }

    const currentDepth = this.getStackDepth();

    switch (this.activeControl.kind) {
      case "stepIn":
        return "step";
      case "next":
        return currentDepth <= this.activeControl.depth ? "step" : undefined;
      case "stepOut":
        return currentDepth < this.activeControl.depth ? "step" : undefined;
      case "continue":
        return await this.shouldStopAtLine(this.getCurrentLine()) ? "breakpoint" : undefined;
      default:
        return undefined;
    }
  }

  // A line stops execution when it has a verified unconditional breakpoint, or a
  // conditional breakpoint whose condition evaluates to true. Conditions are
  // evaluated against the live program memory; failures simply fall through so
  // the program keeps running.
  private async shouldStopAtLine(line: number | undefined): Promise<boolean> {
    if (line === undefined || !this.engine) {
      return false;
    }

    const fileBreakpoints = this.breakpointMap.get(this.normalizePath(this.programPath)) ?? [];
    for (const breakpoint of fileBreakpoints) {
      if (!breakpoint.verified || breakpoint.actualLine !== line) {
        continue;
      }

      if (!breakpoint.compiledCondition) {
        return true;
      }

      if (evaluateDebugCondition(this.engine, breakpoint.compiledCondition)) {
        return true;
      }
    }

    return false;
  }

  private endSession(exitCode: number): void {
    if (this.terminated) {
      return;
    }

    this.terminated = true;
    this.sendEvent(new ExitedEvent(exitCode));
    this.sendEvent(new TerminatedEvent());
  }

  private expandVariables(container: VariableContainer): DebugProtocol.Variable[] {
    if (!this.engine) {
      return [];
    }

    if (container.kind === "globals") {
      return Object.entries(this.engine.memory.values)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => this.createVariable(name, value));
    }

    return Object.entries(container.value.values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => this.createVariable(name, value));
  }

  private createVariable(name: string, value: BaseValue): DebugProtocol.Variable {
    return {
      name,
      value: value.toDebuggerString(),
      variablesReference: value.kind === ValueKind.Array ? this.variableHandles.create({ kind: "array", value: value as ArrayValue }) : 0
    };
  }

  private getExecutionFrames(): Array<{ moduleName: string; instructionIndex: number }> {
    return this.engine ? [...this.engine.executionStack].reverse() : [];
  }

  private getStackDepth(): number {
    return this.engine?.executionStack.length ?? 0;
  }

  private getCurrentLine(): number | undefined {
    if (!this.engine || this.engine.executionStack.length === 0) {
      return undefined;
    }

    const topFrame = this.engine.executionStack[this.engine.executionStack.length - 1];
    const instruction = this.getInstructionForFrame(topFrame.moduleName, topFrame.instructionIndex);
    return instruction?.sourceRange.start.line;
  }

  private getInstructionForFrame(moduleName: string, instructionIndex: number) {
    const instructions = this.engine?.modules[moduleName];
    if (!instructions || instructionIndex < 0 || instructionIndex >= instructions.length) {
      return undefined;
    }

    return instructions[instructionIndex];
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
  }
}
