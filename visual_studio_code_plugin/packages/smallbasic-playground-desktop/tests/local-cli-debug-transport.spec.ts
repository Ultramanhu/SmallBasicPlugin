import { describe, expect, it } from "vitest";
import type { CliBackendId, DesktopBridge, SessionEvent, SessionStartInfo } from "../src/desktop-bridge";
import type { DebugEvent } from "../../smallbasic-vscode/src/playground/debug-controller";
import { LocalCliDebugTransport, type CliDebugSinks } from "../src/local-cli-debug-transport";

// The transport measures request timeouts with `window.setTimeout`, mirroring
// the browser it ships into; point it at the Node timer API for tests.
(globalThis as { window?: unknown }).window = globalThis;

interface RecordedRequest {
  seq: number;
  command: string;
  args: Record<string, unknown>;
}

type DapResponder = (args: Record<string, unknown>) => Record<string, unknown> | Error;

/** Minimal in-memory stand-in for the Rust command surface (doc 10, §18.3). */
class FakeBridge implements DesktopBridge {
  public readonly requests: RecordedRequest[] = [];
  public readonly terminated: string[] = [];
  public readonly inputs: string[] = [];
  public autoRespond = true;
  public readonly responders: Record<string, DapResponder> = {};
  private sequence = 0;
  private emit: ((event: SessionEvent) => void) | null = null;

  public capabilities(): Promise<never> {
    throw new Error("capabilities is not used by the debug transport");
  }

  public runProgram(): Promise<SessionStartInfo> {
    throw new Error("runProgram is not used by the debug transport");
  }

  public async startDebug(request: {
    backend: CliBackendId;
    name: string;
    source: string;
    onEvent: (event: SessionEvent) => void;
  }): Promise<SessionStartInfo> {
    this.emit = request.onEvent;
    return {
      sessionId: "session-1",
      sessionDir: "/tmp/session-1",
      programPath: "/tmp/session-1/program.sb"
    };
  }

  public async sendInput(sessionId: string, text: string): Promise<void> {
    this.inputs.push(`${sessionId}:${text}`);
  }

  public async debugRequest(_sessionId: string, command: string, args?: unknown): Promise<number> {
    const seq = ++this.sequence;
    const argsRecord = (args ?? {}) as Record<string, unknown>;
    this.requests.push({ seq, command, args: argsRecord });

    if (this.autoRespond) {
      const responder = this.responders[command] ?? (() => ({}));
      queueMicrotask(() => this.respond(seq, command, responder(argsRecord)));
    }

    return seq;
  }

  public async terminateSession(sessionId: string): Promise<void> {
    this.terminated.push(sessionId);
  }

  public async pickProgramFile(): Promise<null> {
    return null;
  }

  public async saveProgramFile(): Promise<null> {
    return null;
  }

  /** Feeds one decoded DAP message to the transport, as the Rust channel would. */
  public dap(message: Record<string, unknown>): void {
    this.emit?.({ kind: "dap", message });
  }

  public lastRequest(command: string): RecordedRequest | undefined {
    return [...this.requests].reverse().find((request) => request.command === command);
  }

  private respond(seq: number, command: string, result: Record<string, unknown> | Error): void {
    if (result instanceof Error) {
      this.dap({
        type: "response",
        request_seq: seq,
        success: false,
        command,
        message: result.message,
        body: { error: { format: result.message } }
      });
      return;
    }

    this.dap({ type: "response", request_seq: seq, success: true, command, body: result });
  }
}

function createSinks(): { events: DebugEvent[]; output: string[]; sinks: CliDebugSinks } {
  const events: DebugEvent[] = [];
  const output: string[] = [];
  return {
    events,
    output,
    sinks: {
      emit: (event) => events.push(event),
      onOutput: (text) => output.push(text)
    }
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function started(): Promise<{ bridge: FakeBridge; transport: LocalCliDebugTransport; events: DebugEvent[]; output: string[] }> {
  const bridge = new FakeBridge();
  const { events, output, sinks } = createSinks();
  const transport = new LocalCliDebugTransport(bridge, "cli-csharp", sinks);
  await transport.launch({ sessionId: "ignored", name: "program.sb", source: "TextWindow.WriteLine(1)\n" });
  return { bridge, transport, events, output };
}

describe("local CLI debug transport (web protocol <-> stdio DAP)", () => {
  it("starts the debug adapter lazily and relays `initialized` as ready", async () => {
    const { bridge, events } = await started();
    expect(bridge.requests).toEqual([]);

    bridge.dap({ type: "event", event: "initialized" });
    expect(events).toEqual([{ type: "ready" }]);
  });

  it("converts 0-based protocol breakpoints to 1-based DAP lines and back", async () => {
    const { bridge, transport, events } = await started();
    bridge.responders.setBreakpoints = (args) => ({
      breakpoints: (args.breakpoints as Array<{ line: number }>).map((breakpoint) => ({
        verified: true,
        line: breakpoint.line
      }))
    });

    await transport.send({ type: "setBreakpoints", breakpoints: [2, 5], requestId: "r1" });

    const request = bridge.lastRequest("setBreakpoints")!;
    expect(request.args.lines).toEqual([3, 6]);
    expect(request.args.breakpoints).toEqual([{ line: 3 }, { line: 6 }]);
    expect((request.args.source as { path: string }).path).toBe("/tmp/session-1/program.sb");
    expect(events).toContainEqual({ type: "breakpointsValidated", breakpoints: [2, 5] });
  });

  it("drops unverified breakpoints instead of echoing them", async () => {
    const { bridge, transport, events } = await started();
    bridge.responders.setBreakpoints = () => ({
      breakpoints: [{ verified: false, line: 3, message: "no executable statement" }]
    });

    await transport.send({ type: "setBreakpoints", breakpoints: [2], requestId: "r1" });
    expect(events.some((event) => event.type === "breakpointsValidated")).toBe(false);
  });

  it("sends launch with the session program and closes with configurationDone", async () => {
    const { bridge, transport } = await started();
    await transport.send({ type: "start", breakpoints: [] });

    expect(bridge.requests.map((request) => request.command)).toEqual(["launch", "configurationDone"]);
    expect(bridge.requests[0].args.program).toBe("/tmp/session-1/program.sb");
    expect(bridge.requests[0].args.name).toBe("program.sb");
  });

  it("maps a DAP stop back to a 0-based web stop with frames and variables", async () => {
    const { bridge, events } = await started();
    bridge.responders.stackTrace = () => ({
      stackFrames: [
        { id: 1, name: "Main", line: 4 },
        { id: 2, name: "Greet", line: 7 }
      ]
    });
    bridge.responders.scopes = () => ({ scopes: [{ name: "Globals", variablesReference: 1 }] });
    bridge.responders.variables = (args) => args.variablesReference === 1
      ? { variables: [{ name: "a1", value: "1", variablesReference: 0 }] }
      : { variables: [] };

    bridge.dap({ type: "event", event: "stopped", body: { reason: "breakpoint", line: 4, threadId: 1 } });
    await flush();

    expect(events).toContainEqual({
      type: "stopped",
      reason: "breakpoint",
      line: 3,
      frames: [
        { name: "Main", line: 3 },
        { name: "Greet", line: 6 }
      ],
      variables: [{ name: "a1", value: "1" }]
    });
  });

  it("expands one level of variable children", async () => {
    const { bridge, events } = await started();
    bridge.responders.stackTrace = () => ({ stackFrames: [{ id: 1, name: "Main", line: 2 }] });
    bridge.responders.scopes = () => ({ scopes: [{ name: "Globals", variablesReference: 1 }] });
    bridge.responders.variables = (args) => {
      if (args.variablesReference === 1) {
        return { variables: [{ name: "arr", value: "{...}", variablesReference: 5 }] };
      }

      return { variables: [{ name: "0", value: "7", variablesReference: 0 }] };
    };

    bridge.dap({ type: "event", event: "stopped", body: { reason: "step", line: 2, threadId: 1 } });
    await flush();

    const stopped = events.find((event) => event.type === "stopped")!;
    expect(stopped.variables).toEqual([
      { name: "arr", value: "{...}", children: [{ name: "0", value: "7" }] }
    ]);
  });

  const numericBanners = [
    ["Blazor graphics host", "TextWindow is waiting for a number. Enter it in the Debug Console.\n"],
    ["C# CLI adapter", "\n[Input] Type a number in the Debug Console and press Enter.\n"],
    ["JavaScript CLI adapter", "\n[Input] 请输入数字后在 Debug Console 中按回车。\n"]
  ] as const;

  it.each(numericBanners)("classifies the %s numeric prompt as the web input event", async (_label, banner) => {
    const { bridge, events, output } = await started();
    bridge.responders.stackTrace = () => ({ stackFrames: [{ id: 1, name: "Main", line: 3 }] });
    bridge.responders.scopes = () => ({ scopes: [{ name: "Globals", variablesReference: 1 }] });
    bridge.responders.variables = () => ({ variables: [] });

    bridge.dap({ type: "event", event: "output", body: { output: banner } });
    bridge.dap({
      type: "event",
      event: "stopped",
      body: { reason: "pause", description: "Waiting for TextWindow input", threadId: 1 }
    });
    await flush();

    expect(output[0]).toBe(banner);
    const input = events.find((event) => event.type === "input")!;
    expect(input.line).toBe(2);
    expect(input.numberInput).toBe(true);
  });

  it("keeps Read (string) input on the text prompt", async () => {
    const { bridge, events } = await started();
    bridge.responders.stackTrace = () => ({ stackFrames: [{ id: 1, name: "Main", line: 3 }] });
    bridge.responders.scopes = () => ({ scopes: [{ name: "Globals", variablesReference: 1 }] });
    bridge.responders.variables = () => ({ variables: [] });

    bridge.dap({
      type: "event",
      event: "output",
      body: { output: "\n[Input] Type text in the Debug Console and press Enter.\n" }
    });
    bridge.dap({
      type: "event",
      event: "stopped",
      body: { reason: "pause", description: "Waiting for TextWindow input", threadId: 1 }
    });
    await flush();

    const input = events.find((event) => event.type === "input")!;
    expect(input.numberInput).toBe(false);
  });

  it("does not treat ordinary program output as an input prompt", async () => {
    const { bridge, events } = await started();
    bridge.responders.stackTrace = () => ({ stackFrames: [{ id: 1, name: "Main", line: 3 }] });
    bridge.responders.scopes = () => ({ scopes: [{ name: "Globals", variablesReference: 1 }] });
    bridge.responders.variables = () => ({ variables: [] });

    bridge.dap({
      type: "event",
      event: "output",
      body: { output: "Enter a number: number 7\n" }
    });
    bridge.dap({
      type: "event",
      event: "stopped",
      body: { reason: "pause", description: "Waiting for TextWindow input", threadId: 1 }
    });
    await flush();

    const input = events.find((event) => event.type === "input")!;
    expect(input.numberInput).toBe(false);
  });

  it("forwards TextWindow input as a DAP evaluate request", async () => {
    const { bridge, transport } = await started();
    await transport.send({ type: "input", text: "42" });

    const request = bridge.lastRequest("evaluate")!;
    expect(request.args).toEqual({ expression: "42", context: "repl" });
  });

  it("maps every control command to its DAP thread request", async () => {
    const { bridge, transport } = await started();
    const expected: Array<[string, string]> = [
      ["pause", "pause"],
      ["continue", "continue"],
      ["next", "next"],
      ["stepIn", "stepIn"],
      ["stepOut", "stepOut"]
    ];

    for (const [control, command] of expected) {
      await transport.send({ type: "control", control: control as never, depth: 2 });
      expect(bridge.lastRequest(command)!.args).toEqual({ threadId: 1 });
    }
  });

  it("disconnects first and then tears the process tree down", async () => {
    const { bridge, transport } = await started();
    await transport.send({ type: "stop" });

    expect(bridge.requests.some((request) => request.command === "disconnect")).toBe(true);
    expect(bridge.terminated).toEqual(["session-1"]);
  });

  it("surfaces a rejected DAP request as an error event", async () => {
    const { bridge, transport, events } = await started();
    bridge.responders.setBreakpoints = () => new Error("no executable statement at or after line 9");

    await transport.send({ type: "setBreakpoints", breakpoints: [9], requestId: "r1" });
    expect(events).toContainEqual({ type: "error", message: "no executable statement at or after line 9" });
  });

  it("reports the last exit code with the terminated event", async () => {
    const { bridge, events } = await started();
    bridge.dap({ type: "event", event: "exited", body: { exitCode: 3 } });
    bridge.dap({ type: "event", event: "terminated" });
    expect(events).toContainEqual({ type: "terminated", exitCode: 3 });
  });

  it("correlates a response that beats the debug_request invoke result", async () => {
    const { bridge, transport, events } = await started();
    bridge.autoRespond = false;

    const pending = transport.send({ type: "setBreakpoints", breakpoints: [0], requestId: "r1" });
    // The DAP response races ahead of the sequence number the Rust command
    // returns; the transport must still resolve the pending request.
    bridge.dap({
      type: "response",
      request_seq: 1,
      success: true,
      command: "setBreakpoints",
      body: { breakpoints: [{ verified: true, line: 1 }] }
    });

    await pending;
    expect(events).toContainEqual({ type: "breakpointsValidated", breakpoints: [0] });
  });
});
