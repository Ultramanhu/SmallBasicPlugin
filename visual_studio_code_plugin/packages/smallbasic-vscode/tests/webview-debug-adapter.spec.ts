import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DebugSourceAccessor } from "../src/debug/session";
import { WebviewDebugSession, type WebviewDebugBackend } from "../src/web/webview-debug-adapter";
import { WebDebugSessionBroker, type DebugWebviewChannel, type DebugWebviewMessage } from "../src/web/debug-broker";
import { DEBUG_PROTOCOL_VERSION } from "../src/web/debug-protocol";
import { DapClient } from "./support/dap-client";

const SESSION = "webview-session";
const PROGRAM = "memfs:/workspace/steps.sb";

/**
 * Stands in for the in-page engine (JavaScript runtime or Blazor WASM): it
 * reacts to the wire commands exactly like `BrowserDebugSession` /
 * `BrowserEngineSession` do, so the adapter is exercised over the real DAP
 * stream and the real web debug protocol.
 */
class FakeRuntimeChannel implements DebugWebviewChannel {
  public readonly commands: Array<Record<string, unknown>> = [];
  public stopOnEntry = false;
  public usesInput = false;
  private readonly messageHandlers = new Set<(message: DebugWebviewMessage) => void>();
  private readonly disposeHandlers = new Set<() => void>();
  private breakpoints: number[] = [];
  private line = 0;
  /** Lines (0-based) that the fake program can stop on. */
  private readonly executable = [0, 1, 2];
  private readonly output: string[] = [];

  public post(message: unknown): void {
    const wire = message as Record<string, unknown>;
    if (wire.type === "debug-launch") {
      this.queue(() => this.emitEvent({ type: "ready" }));
      return;
    }

    if (wire.type !== "debug-command") {
      return;
    }

    const command = JSON.parse(String(wire.json)) as Record<string, unknown>;
    this.commands.push(command);
    this.queue(() => this.handle(command));
  }

  public onMessage(handler: (message: DebugWebviewMessage) => void): { dispose(): void } {
    this.messageHandlers.add(handler);
    return { dispose: () => this.messageHandlers.delete(handler) };
  }

  public onDispose(handler: () => void): { dispose(): void } {
    this.disposeHandlers.add(handler);
    return { dispose: () => this.disposeHandlers.delete(handler) };
  }

  public whenReady(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public dispose(): void {
    for (const handler of [...this.disposeHandlers]) {
      handler();
    }
  }

  public allOutput(): string {
    return this.output.join("");
  }

  public lastCommand(type: string): Record<string, unknown> | undefined {
    return [...this.commands].reverse().find((command) => command.type === type);
  }

  private handle(command: Record<string, unknown>): void {
    switch (command.type) {
      case "setBreakpoints": {
        const requested = (command.breakpoints as number[] | undefined) ?? [];
        const validated = requested
          .map((line) => this.executable.find((candidate) => candidate >= line))
          .filter((line): line is number => line !== undefined);
        this.breakpoints = [...new Set(validated)];
        this.emitEvent({
          type: "breakpointsValidated",
          requestId: command.requestId,
          breakpoints: this.breakpoints
        });
        return;
      }
      case "start":
        if (this.stopOnEntry) {
          this.emitSnapshot("stopped", "entry", this.executable[0]);
          return;
        }

        if (this.usesInput) {
          this.emitOutput("Enter a number:\n");
          this.line = 0;
          this.emitSnapshot("input", undefined, this.line, { numberInput: true });
          return;
        }

        this.runToBreakpointOrEnd();
        return;
      case "control":
        this.handleControl(String(command.control));
        return;
      case "input":
        // TextWindow.ReadNumber() * 2
        this.emitOutput("84\n");
        this.emitEvent({ type: "terminated", exitCode: 0 });
        return;
      case "stop":
        this.emitEvent({ type: "terminated", exitCode: 0 });
        return;
      default:
        return;
    }
  }

  private handleControl(control: string): void {
    if (control === "pause") {
      this.emitSnapshot("stopped", "pause", this.line);
      return;
    }

    if (control === "next" || control === "stepIn" || control === "stepOut") {
      this.line = Math.min(this.line + 1, this.executable[this.executable.length - 1]);
      this.emitSnapshot("stopped", "step", this.line);
      return;
    }

    this.runToBreakpointOrEnd();
  }

  private runToBreakpointOrEnd(): void {
    const next = this.breakpoints.find((line) => line > this.line);
    if (next !== undefined) {
      this.line = next;
      this.emitSnapshot("stopped", "breakpoint", next);
      return;
    }

    this.emitOutput("3\n");
    this.emitEvent({ type: "terminated", exitCode: 0 });
  }

  private emitOutput(text: string): void {
    this.output.push(text);
    this.emit({ type: "output", text, sessionId: SESSION });
  }

  private emitSnapshot(type: "stopped" | "input", reason: string | undefined, line: number, extra: Record<string, unknown> = {}): void {
    this.emitEvent({
      type,
      reason,
      line,
      frames: [{ name: "Program", line }],
      variables: [
        { name: "x", value: "1", children: [] },
        { name: "y", value: "2", children: [] }
      ],
      ...extra
    });
  }

  private emitEvent(event: Record<string, unknown>): void {
    this.emit({
      type: "debug-event",
      sessionId: SESSION,
      json: JSON.stringify({ protocolVersion: DEBUG_PROTOCOL_VERSION, sessionId: SESSION, ...event })
    });
  }

  private emit(message: DebugWebviewMessage): void {
    for (const handler of [...this.messageHandlers]) {
      handler(message);
    }
  }

  private queue(action: () => void): void {
    setTimeout(action, 0);
  }
}

function createSources(program: string): DebugSourceAccessor {
  return {
    resolvePath: (filePath) => filePath,
    basename: () => "steps.sb",
    readFile: (filePath) => {
      if (filePath !== program) {
        throw new Error(`Unexpected path: ${filePath}`);
      }

      return "x = 1\ny = x + 1\nTextWindow.WriteLine(y)\n";
    }
  };
}

describe("webview debug adapter", () => {
  let channel: FakeRuntimeChannel;
  let broker: WebDebugSessionBroker;
  let client: DapClient;

  const startSession = (
    options: { stopOnEntry?: boolean; usesInput?: boolean; backend?: WebviewDebugBackend } = {}
  ): void => {
    const backend = options.backend ?? "blazor";
    channel = new FakeRuntimeChannel();
    channel.stopOnEntry = options.stopOnEntry === true;
    channel.usesInput = options.usesInput === true;
    broker = new WebDebugSessionBroker(SESSION, channel, { launchTimeoutMs: 1000, requestTimeoutMs: 1000 });
    // The fake runtime reports `ready` on the next tick; a test that finishes
    // first disposes the broker, which rejects this launch promise.
    void broker.launch({
      backend,
      name: "steps.sb",
      source: "x = 1\ny = x + 1\nTextWindow.WriteLine(y)\n",
      stopOnEntry: options.stopOnEntry === true
    }).catch(() => undefined);
    client = new DapClient(new WebviewDebugSession(broker, createSources(PROGRAM), { backend }));
  };

  beforeEach(() => startSession());

  afterEach(() => broker.dispose());

  it("verifies breakpoints, stops, exposes frames/variables and steps", async () => {
    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program: PROGRAM, stopOnEntry: false });

    const breakpoints = await client.request("setBreakpoints", {
      source: { path: PROGRAM },
      breakpoints: [{ line: 2 }]
    });
    expect((breakpoints.body?.breakpoints as Array<{ verified: boolean; line: number }>)[0]).toEqual({
      verified: true,
      line: 2,
      message: undefined
    });

    await client.request("configurationDone");
    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body).toMatchObject({ reason: "breakpoint", threadId: 1 });

    const stack = await client.request("stackTrace", { threadId: 1 });
    const frames = stack.body?.stackFrames as Array<{ name: string; line: number }>;
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 1, name: "Program", line: 2, column: 1 });

    const scopes = await client.request("scopes", { frameId: 1 });
    const scopesBody = scopes.body?.scopes as Array<{ name: string; variablesReference: number }>;
    expect(scopesBody[0].name).toBe("Globals");

    const variables = await client.request("variables", { variablesReference: scopesBody[0].variablesReference });
    expect(variables.body?.variables).toEqual([
      { name: "x", value: "1", variablesReference: 0 },
      { name: "y", value: "2", variablesReference: 0 }
    ]);

    const evaluation = await client.request("evaluate", { expression: "y" });
    expect(evaluation.body?.result).toBe("2");

    await client.request("next", { threadId: 1 });
    const stepped = await client.waitForEvent("stopped", 2);
    expect(stepped.body?.reason).toBe("step");

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("3");
    expect(channel.allOutput()).toContain("3");
  });

  it("marks a breakpoint with no executable line as unverified", async () => {
    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program: PROGRAM, stopOnEntry: false });

    const breakpoints = await client.request("setBreakpoints", {
      source: { path: PROGRAM },
      breakpoints: [{ line: 99 }]
    });
    expect((breakpoints.body?.breakpoints as Array<{ verified: boolean; line: number }>)[0]).toMatchObject({
      verified: false,
      line: 99
    });
  });

  it("advertises and forwards conditional breakpoints for the JavaScript backend", async () => {
    startSession({ backend: "javascript" });
    const initialize = await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    expect(initialize.body?.supportsConditionalBreakpoints).toBe(true);

    await client.request("launch", { program: PROGRAM, stopOnEntry: false });
    await client.request("setBreakpoints", {
      source: { path: PROGRAM },
      breakpoints: [{ line: 2, condition: "i = 3" }]
    });

    expect(channel.lastCommand("setBreakpoints")).toMatchObject({
      breakpoints: [1],
      conditions: ["i = 3"]
    });
  });

  it("does not advertise conditional breakpoints for the Blazor backend", async () => {
    const initialize = await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    expect(initialize.body?.supportsConditionalBreakpoints).toBe(false);
  });

  it("stops on entry and then continues", async () => {
    startSession({ stopOnEntry: true });
    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program: PROGRAM, stopOnEntry: true });
    await client.request("configurationDone");

    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body?.reason).toBe("entry");

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
  });

  it("bridges TextWindow input through evaluate", async () => {
    startSession({ usesInput: true });
    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program: PROGRAM, stopOnEntry: false });
    await client.request("configurationDone");

    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body).toMatchObject({ reason: "pause", description: "Waiting for TextWindow number" });

    await client.request("evaluate", { expression: "42" });
    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("84");
  });

  it("terminates the runtime on disconnect while the program is stopped", async () => {
    startSession({ stopOnEntry: true });
    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program: PROGRAM, stopOnEntry: true });
    await client.request("configurationDone");

    await client.waitForEvent("stopped");
    await client.request("disconnect", {});

    expect(channel.commands.some((command) => command.type === "stop")).toBe(true);
    await client.waitForEvent("terminated");
  });
});
