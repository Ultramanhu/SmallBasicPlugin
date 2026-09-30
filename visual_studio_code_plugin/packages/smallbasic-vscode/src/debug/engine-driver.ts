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

/**
 * Host-agnostic Small Basic debug engine.
 *
 * The engine-driving semantics (breakpoint snapping, conditional breakpoints,
 * stop on entry, stepping, and the pause/blocked/terminated state machine) live
 * here exactly once, and are consumed by two very different hosts:
 *
 *   - `src/debug/session.ts` - the DAP adapter of the CLI JavaScript backend
 *     (external Node adapter) and of the extension host;
 *   - `src/runhost/web-debug.ts` - the browser runtime that the VS Code webview
 *     drives over the web debug protocol, for `mode: "web"` JavaScript sessions.
 *
 * Keeping both on one implementation is what lets the two web-mode backends
 * behave the same without duplicating the debug loop.
 *
 * All source lines handled here are **0-based**; the DAP boundary converts.
 */

/** Reads source text for a program path (file system, in-memory, remote, ...). */
export interface DebugSourceReader {
  readFile(filePath: string): string;
}

export type RunControl =
  | { kind: "continue" }
  | { kind: "stepIn"; depth: number }
  | { kind: "next"; depth: number }
  | { kind: "stepOut"; depth: number };

export interface DebugBreakpointRequest {
  /** 0-based requested line. */
  line: number;
  condition?: string;
}

export interface DebugBreakpoint extends DebugBreakpointRequest {
  /** 0-based executable line the request snapped to. */
  actualLine?: number;
  verified: boolean;
  compiledCondition?: CompiledDebugExpression;
}

export interface DebugFrame {
  /** Module name, used as the frame label. */
  name: string;
  /** 0-based. */
  line: number;
  /** 0-based. */
  column: number;
}

export interface DebugVariableValue {
  name: string;
  value: string;
  kind: ValueKind;
  /** Present for arrays so the host can expand or serialize children. */
  array?: ArrayValue;
}

export interface DebugSnapshot {
  /** Top frame first. */
  frames: DebugFrame[];
  variables: DebugVariableValue[];
}

/** Recursive variable shape published by the web debug protocol. */
export interface DebugVariableTree {
  name: string;
  value: string;
  children: DebugVariableTree[];
}

export interface DebugDriverCallbacks {
  /** TextWindow output (already carries its newline). */
  onOutput(text: string): void;
  /** `reason` is `entry` | `breakpoint` | `step` | `pause`. */
  onStopped(reason: string, snapshot: DebugSnapshot): void;
  onInputRequested(kind: ValueKind, snapshot: DebugSnapshot): void;
  /** Fired exactly once, also for a forced termination. */
  onTerminated(exitCode: number): void;
}

export interface DebugDriverOptions {
  /** Wall-clock budget of one execution slice, in milliseconds. */
  sliceMs?: number;
  /** Instruction budget of one execution slice. */
  sliceSteps?: number;
}

export class DebugEngineDriver {
  private readonly breakpointsByFile = new Map<string, DebugBreakpoint[]>();
  private readonly textWindow = new DriverTextWindow(this);
  private readonly sliceMs: number;
  private readonly sliceSteps: number;
  private compilation: Compilation | undefined;
  private engine: ExecutionEngine | undefined;
  private loadedPath = "";
  private executionStarted = false;
  private running = false;
  private pauseRequested = false;
  private initialLocationChecked = false;
  private ended = false;
  private activeControl: RunControl = { kind: "continue" };

  public constructor(
    private readonly callbacks: DebugDriverCallbacks,
    private readonly reader: DebugSourceReader,
    options: DebugDriverOptions = {}
  ) {
    this.sliceMs = options.sliceMs ?? 5;
    this.sliceSteps = options.sliceSteps ?? 128;
  }

  public get programPath(): string {
    return this.loadedPath;
  }

  public get isLoaded(): boolean {
    return this.engine !== undefined;
  }

  public get isEnded(): boolean {
    return this.ended;
  }

  public get isRunning(): boolean {
    return this.running;
  }

  public get isWaitingForInput(): boolean {
    return this.textWindow.isWaitingForInput();
  }

  /**
   * Compiles `programPath` and prepares the engine. Throws with the compiler
   * diagnostics (or the unsupported-graphics message) when it cannot run.
   */
  public load(programPath: string): void {
    const compilation = this.compile(programPath);
    this.loadedPath = programPath;
    this.compilation = compilation;
    this.engine = new ExecutionEngine(compilation);
    this.engine.libraries.TextWindow.plugin = this.textWindow;
  }

  /** Verifies breakpoints against `sourcePath` and stores them for the run. */
  public setBreakpoints(sourcePath: string, requests: readonly DebugBreakpointRequest[]): DebugBreakpoint[] {
    const verified = this.verifyBreakpoints(sourcePath, requests);
    this.breakpointsByFile.set(normalizePath(sourcePath), verified);
    return verified;
  }

  /**
   * Re-verifies the breakpoints already configured for `sourcePath`. The DAP
   * client is allowed to set breakpoints before `launch`, so they are verified
   * again once the program is known.
   */
  public reverifyBreakpoints(sourcePath: string): DebugBreakpoint[] {
    const current = this.breakpointsByFile.get(normalizePath(sourcePath)) ?? [];
    if (current.length === 0) {
      return [];
    }

    const verified = this.verifyBreakpoints(
      sourcePath,
      current.map((breakpoint) => ({ line: breakpoint.line, condition: breakpoint.condition }))
    );
    this.breakpointsByFile.set(normalizePath(sourcePath), verified);
    return verified;
  }

  /** Starts execution; reports `entry` instead when stopping on entry. */
  public begin(stopOnEntry: boolean): void {
    if (!this.engine || this.executionStarted || this.ended) {
      return;
    }

    this.executionStarted = true;
    this.activeControl = { kind: "continue" };
    if (stopOnEntry) {
      // The engine uses line zero as its sentinel, so publish the entry stop
      // directly instead of executing the first statement first.
      this.initialLocationChecked = true;
      this.callbacks.onStopped("entry", this.snapshot());
      return;
    }

    this.resume();
  }

  public continueExecution(): void {
    this.activeControl = { kind: "continue" };
    this.pauseRequested = false;
    this.resume();
  }

  public step(depth: number, kind: "stepIn" | "next" | "stepOut"): void {
    this.activeControl = { kind, depth };
    this.pauseRequested = false;
    this.resume();
  }

  public pause(): void {
    this.pauseRequested = true;
  }

  /** Feeds a `TextWindow.Read`/`ReadNumber` line and resumes the program. */
  public submitInput(raw: string): void {
    if (!this.textWindow.isWaitingForInput()) {
      return;
    }

    this.textWindow.pushInput(raw);
    this.activeControl = { kind: "continue" };
    this.pauseRequested = false;
    this.resume();
  }

  /** Forced termination; reports `terminated` even when the loop is idle. */
  public terminate(): void {
    if (this.ended) {
      return;
    }

    this.engine?.terminate();
    if (!this.running) {
      this.finish(0);
    }
  }

  public frames(): DebugFrame[] {
    if (!this.engine) {
      return [];
    }

    return [...this.engine.executionStack].reverse().map((frame) => {
      const instruction = this.instructionFor(frame.moduleName, frame.instructionIndex);
      return {
        name: frame.moduleName,
        line: instruction?.sourceRange.start.line ?? 0,
        column: instruction?.sourceRange.start.column ?? 0
      };
    });
  }

  public variables(): DebugVariableValue[] {
    const memory = this.engine?.memory.values ?? {};
    return Object.keys(memory)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => this.toVariableValue(name, memory[name]));
  }

  public snapshot(): DebugSnapshot {
    return { frames: this.frames(), variables: this.variables() };
  }

  /** Children of an array variable; empty for scalars. */
  public expand(variable: DebugVariableValue): DebugVariableValue[] {
    if (!variable.array) {
      return [];
    }

    return Object.entries(variable.array.values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => this.toVariableValue(name, value));
  }

  /** Fully expands a variable into the recursive shape of the web protocol. */
  public toVariableTree(variable: DebugVariableValue): DebugVariableTree {
    return {
      name: variable.name,
      value: variable.value,
      children: this.expand(variable).map((child) => this.toVariableTree(child))
    };
  }

  public findVariable(name: string): DebugVariableValue | undefined {
    const variables = this.variables();
    return variables.find((variable) => variable.name === name)
      ?? variables.find((variable) => variable.name.toLowerCase() === name.toLowerCase());
  }

  /** Called by the TextWindow plugin; keeps the driver the only emitter. */
  public notifyInputNeeded(kind: ValueKind): void {
    this.callbacks.onInputRequested(kind, this.snapshot());
  }

  public emitOutput(text: string): void {
    this.callbacks.onOutput(text);
  }

  private compile(sourcePath: string): Compilation {
    let text: string;
    try {
      text = this.reader.readFile(sourcePath);
    } catch {
      throw new Error(`找不到程序文件: ${sourcePath}`);
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

  private verifyBreakpoints(sourcePath: string, requests: readonly DebugBreakpointRequest[]): DebugBreakpoint[] {
    let compilation: Compilation;
    try {
      compilation = this.compile(sourcePath);
    } catch {
      return requests.map((breakpoint) => ({ ...breakpoint, verified: false }));
    }

    const lines = executableLines(compilation);
    return requests.map((breakpoint) => {
      const actualLine = lines.find((line) => line >= breakpoint.line);
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

  private resume(): void {
    if (!this.engine || this.running || this.ended) {
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

    if (this.activeControl.kind === "continue" && await this.shouldStopAtLine(this.currentLine())) {
      this.callbacks.onStopped("breakpoint", this.snapshot());
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

    while (this.engine && Date.now() - startedAt < this.sliceMs && steps < this.sliceSteps) {
      this.engine.execute(ExecutionMode.NextStatement);
      steps += 1;

      if (this.engine.state === ExecutionState.Terminated) {
        this.running = false;
        if (this.engine.exception) {
          this.callbacks.onOutput(`\n[Runtime Error] ${this.engine.exception.toString()}\n`);
          this.finish(1);
        } else {
          this.finish(0);
        }

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
          this.callbacks.onStopped(stopReason, this.snapshot());
          return;
        }
      }
    }

    this.running = false;
    if (this.engine && this.engine.state !== ExecutionState.Terminated) {
      this.resume();
    }
  }

  private async getStopReason(): Promise<string | undefined> {
    if (!this.engine) {
      return undefined;
    }

    if (this.pauseRequested) {
      this.pauseRequested = false;
      return "pause";
    }

    const depth = this.engine.executionStack.length;

    switch (this.activeControl.kind) {
      case "stepIn":
        return "step";
      case "next":
        return depth <= this.activeControl.depth ? "step" : undefined;
      case "stepOut":
        return depth < this.activeControl.depth ? "step" : undefined;
      case "continue":
        return await this.shouldStopAtLine(this.currentLine()) ? "breakpoint" : undefined;
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

    const fileBreakpoints = this.breakpointsByFile.get(normalizePath(this.loadedPath)) ?? [];
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

  private currentLine(): number | undefined {
    const stack = this.engine?.executionStack ?? [];
    if (stack.length === 0) {
      return undefined;
    }

    const top = stack[stack.length - 1];
    return this.instructionFor(top.moduleName, top.instructionIndex)?.sourceRange.start.line;
  }

  private instructionFor(moduleName: string, instructionIndex: number) {
    const instructions = this.engine?.modules[moduleName];
    if (!instructions || instructionIndex < 0 || instructionIndex >= instructions.length) {
      return undefined;
    }

    return instructions[instructionIndex];
  }

  private toVariableValue(name: string, value: BaseValue): DebugVariableValue {
    return {
      name,
      value: value.toDebuggerString(),
      kind: value.kind,
      array: value.kind === ValueKind.Array ? value as ArrayValue : undefined
    };
  }

  private finish(exitCode: number): void {
    if (this.ended) {
      return;
    }

    this.ended = true;
    this.running = false;
    this.callbacks.onTerminated(exitCode);
  }
}

function executableLines(compilation: Compilation): number[] {
  const lines = new Set<number>();
  for (const instructions of Object.values(compilation.emit())) {
    for (const instruction of instructions) {
      lines.add(instruction.sourceRange.start.line);
    }
  }

  return [...lines].sort((left, right) => left - right);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

class DriverTextWindow implements ITextWindowLibraryPlugin {
  private readonly inputBuffer: BaseValue[] = [];
  private foreground = TextWindowColor.White;
  private background = TextWindowColor.Black;
  private requestedInputKind: ValueKind | undefined;

  public constructor(private readonly driver: DebugEngineDriver) {}

  public inputIsNeeded(kind: ValueKind): void {
    this.requestedInputKind = kind;
    this.driver.notifyInputNeeded(kind);
  }

  public checkInputBuffer(): BaseValue | undefined {
    return this.inputBuffer.shift();
  }

  public writeText(value: string, appendNewLine: boolean): void {
    this.driver.emitOutput(value + (appendNewLine ? "\n" : ""));
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
