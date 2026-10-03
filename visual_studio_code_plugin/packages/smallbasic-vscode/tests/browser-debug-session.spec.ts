import { describe, expect, it } from "vitest";
import { BrowserDebugSession, type DebugEventSink } from "../src/runhost/web-debug";
import { DEBUG_PROTOCOL_VERSION } from "../src/web/debug-protocol";

const SESSION = "js-web-session";
const PROGRAM = "x = 1\ny = x + 1\nTextWindow.WriteLine(y)\n";

interface WireEvent {
  protocolVersion?: number;
  sessionId?: string;
  type: string;
  reason?: string;
  line?: number;
  breakpoints?: number[];
  requestId?: string;
  exitCode?: number;
  message?: string;
  numberInput?: boolean;
  frames?: Array<{ name: string; line: number; variables?: Array<{ name: string; value: string; children: unknown[] }> }>;
  variables?: Array<{ name: string; value: string; children: unknown[] }>;
}

class RecordingSink implements DebugEventSink {
  public readonly events: WireEvent[] = [];
  public output = "";

  public notify(json: string): void {
    this.events.push(JSON.parse(json) as WireEvent);
  }

  public write(text: string): void {
    this.output += text;
  }

  public ofType(type: string): WireEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  public async waitFor(type: string, occurrence = 1, timeoutMs = 5000): Promise<WireEvent> {
    const startedAt = Date.now();
    for (;;) {
      const matches = this.ofType(type);
      if (matches.length >= occurrence) {
        return matches[occurrence - 1];
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for '${type}'. Seen: ${this.events.map((event) => event.type).join(", ")}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

function launch(sink: RecordingSink, options: { stopOnEntry?: boolean; source?: string } = {}): BrowserDebugSession {
  const session = new BrowserDebugSession(sink);
  session.start(JSON.stringify({
    sessionId: SESSION,
    name: "program.sb",
    source: options.source ?? PROGRAM,
    stopOnEntry: options.stopOnEntry === true
  }));
  return session;
}

function command(session: BrowserDebugSession, wire: Record<string, unknown>): void {
  session.dispatch(JSON.stringify({ protocolVersion: DEBUG_PROTOCOL_VERSION, sessionId: SESSION, ...wire }));
}

describe("browser JavaScript debug session (mode: web)", () => {
  it("publishes ready for a runnable program", () => {
    const sink = new RecordingSink();
    launch(sink);
    expect(sink.ofType("ready")).toHaveLength(1);
    expect(sink.ofType("ready")[0]).toMatchObject({ protocolVersion: DEBUG_PROTOCOL_VERSION, sessionId: SESSION });
  });

  it("reports compilation errors and terminates", () => {
    const sink = new RecordingSink();
    launch(sink, { source: "TextWindow.WriteLine(\n" });
    expect(sink.ofType("ready")).toHaveLength(0);
    expect(sink.ofType("error")).toHaveLength(1);
    expect(sink.ofType("terminated")[0].exitCode).toBe(2);
  });

  it("validates breakpoints and snaps them to executable lines", () => {
    const sink = new RecordingSink();
    const session = launch(sink);

    command(session, { type: "setBreakpoints", requestId: "out", breakpoints: [99] });
    command(session, { type: "setBreakpoints", requestId: "bp", breakpoints: [1] });

    const validated = sink.ofType("breakpointsValidated");
    expect(validated[0]).toMatchObject({ requestId: "out", breakpoints: [] });
    expect(validated[1]).toMatchObject({ requestId: "bp", breakpoints: [1] });
  });

  it("stops on a breakpoint, exposes frames/variables, steps and terminates", async () => {
    const sink = new RecordingSink();
    const session = launch(sink);

    command(session, { type: "setBreakpoints", requestId: "bp", breakpoints: [1] });
    command(session, { type: "start", breakpoints: [1] });

    const stopped = await sink.waitFor("stopped");
    expect(stopped).toMatchObject({ reason: "breakpoint", line: 1 });
    expect(stopped.frames?.length).toBeGreaterThan(0);
    expect(stopped.variables?.some((variable) => variable.name === "x")).toBe(true);

    command(session, { type: "control", control: "next", depth: stopped.frames?.length ?? 0 });
    const stepped = await sink.waitFor("stopped", 2);
    expect(stepped.reason).toBe("step");

    command(session, { type: "control", control: "continue" });
    const terminated = await sink.waitFor("terminated");
    expect(terminated.exitCode).toBe(0);
    expect(sink.output).toContain("2");
  });

  it("stops on entry, mirrors output after stepping and ignores late commands", async () => {
    const sink = new RecordingSink();
    const session = launch(sink, { stopOnEntry: true });

    command(session, { type: "start", breakpoints: [] });
    const entry = await sink.waitFor("stopped");
    expect(entry.reason).toBe("entry");

    command(session, { type: "control", control: "next", depth: entry.frames?.length ?? 0 });
    await sink.waitFor("stopped", 2);
    command(session, { type: "control", control: "next", depth: 1 });
    const third = await sink.waitFor("stopped", 3);
    expect(third.reason).toBe("step");
    // The WriteLine statement has been reached but not executed yet.
    expect(sink.output).toBe("");

    command(session, { type: "control", control: "continue" });
    await sink.waitFor("terminated");
    expect(sink.output).toContain("2");

    const before = sink.events.length;
    command(session, { type: "control", control: "continue" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sink.events.length).toBe(before);
  });

  it("bridges TextWindow input through the input command", async () => {
    const sink = new RecordingSink();
    const session = launch(sink, { source: "n = TextWindow.ReadNumber()\nTextWindow.WriteLine(n * 2)\n" });

    command(session, { type: "start", breakpoints: [] });
    const requested = await sink.waitFor("input");
    expect(requested.numberInput).toBe(true);

    command(session, { type: "input", text: "21" });
    await sink.waitFor("terminated");
    expect(sink.output).toContain("42");
  });

  it("terminates a program that is waiting for input", async () => {
    const sink = new RecordingSink();
    const session = launch(sink, { source: "n = TextWindow.ReadNumber()\nTextWindow.WriteLine(n)\n" });

    command(session, { type: "start", breakpoints: [] });
    await sink.waitFor("input");

    command(session, { type: "stop", requestId: "term" });
    await sink.waitFor("terminated");
  });

  it("drops commands for another session or protocol version", async () => {
    const sink = new RecordingSink();
    const session = launch(sink);

    session.dispatch(JSON.stringify({ protocolVersion: DEBUG_PROTOCOL_VERSION, sessionId: "other", type: "setBreakpoints", breakpoints: [1] }));
    session.dispatch(JSON.stringify({ protocolVersion: 99, sessionId: SESSION, type: "setBreakpoints", breakpoints: [1] }));
    session.dispatch("{not json}");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sink.ofType("breakpointsValidated")).toHaveLength(0);
  });

  it("publishes Function parameters and Dim locals in each browser frame", async () => {
    const sink = new RecordingSink();
    const session = launch(sink, {
      source: [
        "answer = Double(4)",
        "Function Double(Value)",
        "  Dim Local",
        "  Local = Value * 2",
        "  Return Local",
        "EndFunction"
      ].join("\n")
    });

    command(session, { type: "setBreakpoints", requestId: "bp", breakpoints: [3] });
    command(session, { type: "start", breakpoints: [3] });
    const stopped = await sink.waitFor("stopped");
    expect(stopped.frames?.map((frame) => frame.name)).toEqual(["Double", "<Main>"]);
    expect(stopped.frames?.[0].variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Value", value: "4" }),
      expect.objectContaining({ name: "Local", value: "\"\"" })
    ]));

    command(session, { type: "control", control: "continue" });
    await sink.waitFor("terminated");
  });
});
