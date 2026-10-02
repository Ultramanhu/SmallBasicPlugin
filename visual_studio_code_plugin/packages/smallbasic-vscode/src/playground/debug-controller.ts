import * as monaco from "monaco-editor";

/**
 * In-page debug controller of `playground.html`.
 *
 * It drives the web debug protocol (mirroring `src/runhost/web-debug.ts` and
 * `SmallBasic.Blazor.Shared/Protocol.cs`) against either backend:
 *
 *   - JavaScript: the engine runs in this page (`SmallBasicWeb.debugStart` /
 *     `debugCommand` / `debugStop`);
 *   - Blazor WASM: the engine runs in the WebAssembly component; commands go
 *     through `SetSession`/`DispatchDebugCommand` interop, exactly like the
 *     VS Code webview glue (`vscode-webview.js`).
 *
 * It renders the surfaces Monaco does not provide by itself, following VS
 * Code's debug UX: gutter breakpoints with verification feedback, the floating
 * step toolbar, the current-stack-frame highlight and the call-stack/variables
 * panel (design doc 12, §11).
 *
 * All protocol lines are 0-based (the driver's convention); Monaco lines are
 * 1-based. Every conversion goes through {@link toMonacoLine} /
 * {@link toProtocolLine} so the +1/-1 never scatters.
 */

export function toMonacoLine(protocolLine: number): number {
  return protocolLine + 1;
}

export function toProtocolLine(lineNumber: number): number {
  return lineNumber - 1;
}

/**
 * Backends the controller can debug. The two Web kinds are built in; the
 * desktop shell registers additional CLI kinds (`cli-javascript`,
 * `cli-csharp`, `cli-blazor`, doc 10 §17.2) whose transports are provided
 * through the page's extension hook, so the string stays open here.
 */
export type DebugBackendKind = "javascript" | "blazor" | (string & {});

/** Wire commands accepted by both backend transports. */
export type DebugCommand = {
  type: "setBreakpoints";
  breakpoints: number[];
  requestId: string;
} | {
  // The Blazor session replaces its breakpoint set with whatever the start
  // message carries (the CLI bridge always ships snapped lines this way), so
  // start re-states the requested lines instead of relying on earlier state.
  type: "start";
  breakpoints: number[];
} | {
  type: "control";
  control: "pause" | "next" | "stepIn" | "stepOut" | "continue";
  /** Stack depth to step from; the paused stack's frame count, like the DAP adapter. */
  depth?: number;
} | {
  type: "input";
  text: string;
} | {
  type: "stop";
};

/** One debug session's command channel. Created per session, disposed with it. */
export interface DebugTransport {
  launch(payload: { sessionId: string; name: string; source: string }): Promise<void>;
  send(command: DebugCommand): Promise<void>;
  dispose(): void;
}

/** Transport for the in-page JavaScript engine. */
export class JsDebugTransport implements DebugTransport {
  public constructor(
    private readonly web: { debugStart(json: string): void; debugCommand(json: string): void; debugStop(): void },
    private readonly sessionId: string
  ) {}

  public async launch(payload: { sessionId: string; name: string; source: string }): Promise<void> {
    this.web.debugStart(JSON.stringify({ ...payload, stopOnEntry: false }));
  }

  public async send(command: DebugCommand): Promise<void> {
    this.web.debugCommand(JSON.stringify({ protocolVersion: 1, sessionId: this.sessionId, ...command }));
  }

  public dispose(): void {
    this.web.debugStop();
  }
}

/** The page-facing slice of the shell controller needed to reach Blazor. */
export interface BlazorDebugBridge {
  startBlazor(): Promise<void>;
  invoke(method: string, ...args: unknown[]): Promise<unknown>;
}

/** Transport for the WebAssembly engine behind JS interop. */
export class BlazorDebugTransport implements DebugTransport {
  public constructor(private readonly bridge: BlazorDebugBridge, private readonly sessionId: string) {}

  public async launch(payload: { sessionId: string; name: string; source: string }): Promise<void> {
    await this.bridge.startBlazor();
    await this.bridge.invoke("SetSession", JSON.stringify({ ...payload, debug: true, stopOnEntry: false }));
  }

  public async send(command: DebugCommand): Promise<void> {
    await this.bridge.invoke("DispatchDebugCommand", JSON.stringify({ protocolVersion: 1, sessionId: this.sessionId, ...command }));
  }

  public async dispose(): Promise<void> {
    // Mirrors the webview glue: a page-level stop terminates the C# session.
    try {
      await this.bridge.invoke("Stop");
    } catch {
      // The session may already be gone; a failed teardown is not an error.
    }
  }
}

/** Events emitted through `SmallBasicWebHost.notify` while a session runs. */
export interface DebugEvent {
  type: "ready" | "stopped" | "input" | "terminated" | "breakpointsValidated" | "error";
  reason?: string;
  line?: number;
  frames?: DebugStackFrame[];
  variables?: DebugVariable[];
  numberInput?: boolean;
  exitCode?: number;
  breakpoints?: number[];
  message?: string;
}

export interface DebugStackFrame {
  name: string;
  line: number;
}

export interface DebugVariable {
  name: string;
  value: string;
  children?: DebugVariable[];
}

export interface DebugControllerShell {
  setStatus(text: string): void;
  showRuntimeDiagnostics(text: string): void;
  isRunning(): boolean;
  stopRun(): Promise<void>;
  setRunning(running: boolean): void;
  requestDebugInput(numberInput: boolean): Promise<string>;
}

export interface DebugControllerDom {
  debugButton: HTMLButtonElement;
  toolbar: HTMLElement;
  panel: HTMLElement;
  stack: HTMLElement;
  variables: HTMLElement;
  toggleButton: HTMLButtonElement;
  toggleIcon: HTMLElement;
  stepOverButton: HTMLButtonElement;
  stepIntoButton: HTMLButtonElement;
  stepOutButton: HTMLButtonElement;
  restartButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
}

/** Localized strings the controller renders itself. */
export interface DebugControllerLabels {
  frame(name: string, monacoLine: number): string;
  emptyStack: string;
  emptyVariables: string;
  editEndedSession: string;
  titles: {
    continue: string;
    pause: string;
    stepOver: string;
    stepInto: string;
    stepOut: string;
    restart: string;
    stop: string;
    breakpoint: string;
  };
}

export interface DebugControllerOptions {
  editor: monaco.editor.IStandaloneCodeEditor;
  model: monaco.editor.ITextModel;
  shell: DebugControllerShell;
  dom: DebugControllerDom;
  labels: DebugControllerLabels;
  sessionId: string;
  /** Builds the transport for the selected backend; may load a runtime. */
  createTransport(backend: DebugBackendKind): Promise<DebugTransport>;
}

export class PlaygroundDebugController {
  /** Protocol line (0-based) -> snapped executable line, or -1 while unvalidated. */
  private readonly breakpoints = new Map<number, number>();
  private readonly breakpointDecorations: monaco.editor.IEditorDecorationsCollection;
  private readonly currentLineDecoration: monaco.editor.IEditorDecorationsCollection;
  private transport: DebugTransport | undefined;
  private lastProgram: { name: string; source: string; backend: DebugBackendKind } | undefined;
  /** Frame count of the last paused stack; steps must resume from this depth. */
  private pausedStackDepth = 0;
  private active = false;
  private paused = false;
  private awaitingInput = false;

  public constructor(private readonly options: DebugControllerOptions) {
    this.breakpointDecorations = options.editor.createDecorationsCollection([]);
    this.currentLineDecoration = options.editor.createDecorationsCollection([]);
    options.editor.onMouseDown(this.onMouseDown);
    this.applyTitles();
    this.updateToolbar();
  }

  public get isActive(): boolean {
    return this.active;
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  /** Entry point of the Debug button: launches a session on the given backend. */
  public async start(name: string, source: string, backend: DebugBackendKind): Promise<void> {
    if (this.active) {
      return;
    }

    if (this.options.shell.isRunning()) {
      await this.options.shell.stopRun();
    }

    this.active = true;
    this.paused = false;
    this.awaitingInput = false;
    this.lastProgram = { name: name || "program.sb", source, backend };
    this.options.shell.setRunning(true);
    this.updateToolbar();
    this.options.shell.setStatus("Starting debug session…");

    try {
      this.transport = await this.options.createTransport(backend);
      await this.transport.launch({
        sessionId: this.options.sessionId,
        name: this.lastProgram.name,
        source: this.lastProgram.source
      });
    } catch (error) {
      this.endSession();
      throw error;
    }
  }

  /** Relaunches the last program with the current breakpoints (toolbar ↻). */
  public restart(): void {
    if (!this.lastProgram) {
      return;
    }

    this.send({ type: "stop" } satisfies DebugCommand);
    this.endSession();
    const { name, source, backend } = this.lastProgram;
    void this.start(name, source, backend).catch((error: unknown) => {
      this.options.shell.showRuntimeDiagnostics(error instanceof Error ? error.message : String(error));
      this.options.shell.setStatus("Failed");
    });
  }

  /** Ends the session from the Stop button (or any page-level teardown). */
  public stop(): void {
    if (!this.active) {
      return;
    }

    this.send({ type: "stop" } satisfies DebugCommand);
    this.endSession();
    this.options.shell.setStatus("Stopped");
  }

  /** Called on every model change; the first edit ends a running session. */
  public onModelChanged(): void {
    if (!this.active) {
      return;
    }

    this.send({ type: "stop" } satisfies DebugCommand);
    this.endSession();
    this.options.shell.setStatus(this.options.labels.editEndedSession);
  }

  /** The toolbar's continue⇄pause toggle, guarded by the session state. */
  public togglePause(): void {
    if (!this.active || this.awaitingInput) {
      return;
    }

    if (this.paused) {
      this.paused = false;
      this.clearPausedState();
      this.send({ type: "control", control: "continue" } satisfies DebugCommand);
      return;
    }

    this.send({ type: "control", control: "pause" } satisfies DebugCommand);
  }

  /** Step Over / Step Into / Step Out, enabled while paused. */
  public step(kind: "next" | "stepIn" | "stepOut"): void {
    if (!this.active || !this.paused || this.awaitingInput) {
      return;
    }

    this.paused = false;
    this.clearPausedState();
    this.send({ type: "control", control: kind, depth: this.pausedStackDepth } satisfies DebugCommand);
  }

  /** Sink for `SmallBasicWebHost.notify` debug events. */
  public handleEvent(event: DebugEvent): void {
    if (!this.active) {
      return;
    }

    switch (event.type) {
      case "ready":
        this.sendBreakpoints();
        // The Blazor session consumes breakpoints from the start message; the
        // JS session ignores them because setBreakpoints already configured it.
        this.send({ type: "start", breakpoints: [...this.breakpoints.keys()] } satisfies DebugCommand);
        break;
      case "breakpointsValidated":
        this.applyValidatedBreakpoints(event.breakpoints ?? []);
        break;
      case "stopped":
        this.paused = true;
        this.awaitingInput = false;
        this.pausedStackDepth = event.frames?.length ?? this.pausedStackDepth;
        this.showPausedState(event);
        break;
      case "input":
        this.pausedStackDepth = event.frames?.length ?? this.pausedStackDepth;
        void this.handleInputRequest(event);
        break;
      case "terminated":
        this.endSession();
        break;
      case "error":
        this.options.shell.showRuntimeDiagnostics(event.message || "Debug session error.");
        this.endSession();
        break;
    }
  }

  public dispose(): void {
    if (this.transport) {
      this.transport.dispose();
      this.transport = undefined;
    }

    this.active = false;
    this.currentLineDecoration.clear();
    this.updateToolbar();
  }

  private readonly onMouseDown = (event: monaco.editor.IEditorMouseEvent): void => {
    if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.target.position) {
      return;
    }

    const line = toProtocolLine(event.target.position.lineNumber);
    if (this.breakpoints.has(line)) {
      this.breakpoints.delete(line);
    } else {
      this.breakpoints.set(line, -1);
    }

    this.refreshBreakpointDecorations();
    if (this.active) {
      this.sendBreakpoints();
    }
  };

  private async handleInputRequest(event: DebugEvent): Promise<void> {
    this.paused = true;
    this.awaitingInput = true;
    this.showPausedState(event);
    const answer = await this.options.shell.requestDebugInput(event.numberInput === true);
    this.awaitingInput = false;
    if (!this.active) {
      return;
    }

    this.send({ type: "input", text: answer } satisfies DebugCommand);
    this.paused = false;
    this.clearPausedState();
  }

  private showPausedState(event: DebugEvent): void {
    this.updateToolbar();
    if (typeof event.line === "number") {
      const monacoLine = toMonacoLine(event.line);
      this.currentLineDecoration.set([{
        range: new monaco.Range(monacoLine, 1, monacoLine, 1),
        options: {
          isWholeLine: true,
          className: "debug-current-line",
          glyphMarginClassName: "debug-current-line-glyph"
        }
      }]);
      this.options.editor.revealLineInCenter(monacoLine);
    }

    this.renderStack(event.frames ?? []);
    this.renderVariables(event.variables ?? []);
    this.options.dom.panel.hidden = false;
  }

  private clearPausedState(): void {
    this.updateToolbar();
    this.currentLineDecoration.clear();
  }

  private endSession(): void {
    this.active = false;
    this.paused = false;
    this.awaitingInput = false;
    const transport = this.transport;
    this.transport = undefined;
    if (transport) {
      transport.dispose();
    }

    this.options.shell.setRunning(false);
    this.options.dom.panel.hidden = true;
    this.clearPausedState();
  }

  private applyValidatedBreakpoints(validated: number[]): void {
    const actualLines = new Set(validated);
    for (const [line, current] of this.breakpoints) {
      if (current === -1 && actualLines.has(line)) {
        this.breakpoints.set(line, line);
      }
    }

    this.refreshBreakpointDecorations();
  }

  private refreshBreakpointDecorations(): void {
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const [line, actual] of this.breakpoints) {
      const monacoLine = toMonacoLine(line);
      decorations.push({
        range: new monaco.Range(monacoLine, 1, monacoLine, 1),
        options: {
          glyphMarginClassName: actual >= 0 ? "debug-breakpoint-glyph" : "debug-breakpoint-unverified-glyph",
          glyphMarginHoverMessage: { value: this.options.labels.titles.breakpoint },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      });
    }

    this.breakpointDecorations.set(decorations);
  }

  private sendBreakpoints(): void {
    this.send({
      type: "setBreakpoints",
      breakpoints: [...this.breakpoints.keys()],
      requestId: `bp-${Date.now()}`
    } satisfies DebugCommand);
  }

  private send(command: DebugCommand): void {
    const transport = this.transport;
    if (!transport) {
      return;
    }

    transport.send(command).catch((error: unknown) => {
      this.options.shell.showRuntimeDiagnostics(error instanceof Error ? error.message : String(error));
    });
  }

  private applyTitles(): void {
    const { dom, labels } = this.options;
    dom.toggleButton.title = `${labels.titles.continue} (F5) / ${labels.titles.pause}`;
    dom.stepOverButton.title = `${labels.titles.stepOver} (F10)`;
    dom.stepIntoButton.title = `${labels.titles.stepInto} (F11)`;
    dom.stepOutButton.title = `${labels.titles.stepOut} (Shift+F11)`;
    dom.restartButton.title = labels.titles.restart;
    dom.stopButton.title = `${labels.titles.stop} (Shift+F5)`;
  }

  private updateToolbar(): void {
    // The toolbar is persistent; without a session every button is disabled.
    const { dom, labels } = this.options;
    dom.debugButton.disabled = this.active;
    dom.toggleButton.disabled = !this.active || this.awaitingInput;
    dom.toggleIcon.className = `codicon ${this.paused ? "codicon-debug-continue" : "codicon-debug-pause"}`;
    dom.toggleButton.title = this.paused ? `${labels.titles.continue} (F5)` : `${labels.titles.pause}`;
    const canStep = this.active && this.paused && !this.awaitingInput;
    dom.stepOverButton.disabled = !canStep;
    dom.stepIntoButton.disabled = !canStep;
    dom.stepOutButton.disabled = !canStep;
    dom.restartButton.disabled = !this.active;
    dom.stopButton.disabled = !this.active;
  }

  private renderStack(frames: readonly DebugStackFrame[]): void {
    const { dom, labels } = this.options;
    dom.stack.textContent = "";
    if (frames.length === 0) {
      const empty = document.createElement("div");
      empty.className = "web-debug-variable";
      empty.textContent = labels.emptyStack;
      dom.stack.appendChild(empty);
      return;
    }

    for (const frame of frames) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "web-debug-frame";
      row.textContent = labels.frame(frame.name, toMonacoLine(frame.line));
      row.addEventListener("click", () => {
        const line = toMonacoLine(frame.line);
        this.options.editor.revealLineInCenter(line);
        this.options.editor.setPosition({ lineNumber: line, column: 1 });
        this.options.editor.focus();
      });
      dom.stack.appendChild(row);
    }
  }

  private renderVariables(variables: readonly DebugVariable[]): void {
    const { dom, labels } = this.options;
    dom.variables.textContent = "";
    if (variables.length === 0) {
      const empty = document.createElement("div");
      empty.className = "web-debug-variable";
      empty.textContent = labels.emptyVariables;
      dom.variables.appendChild(empty);
      return;
    }

    this.renderVariableTree(dom.variables, variables, 0);
  }

  private renderVariableTree(target: HTMLElement, variables: readonly DebugVariable[], depth: number): void {
    for (const variable of variables) {
      const row = document.createElement("div");
      row.className = "web-debug-variable";
      row.style.paddingLeft = `${6 + depth * 16}px`;

      const name = document.createElement("span");
      name.className = "web-debug-var-name";
      name.textContent = variable.name;
      const value = document.createElement("span");
      value.className = "web-debug-var-value";
      value.textContent = ` = ${variable.value}`;
      row.append(name, value);
      target.appendChild(row);

      if (variable.children && variable.children.length > 0) {
        this.renderVariableTree(target, variable.children, depth + 1);
      }
    }
  }
}
