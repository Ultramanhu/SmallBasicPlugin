import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeDebugSourceAccessor } from "../src/debug/node-source-accessor";
import { DebugSourceAccessor, SmallBasicDebugSession } from "../src/debug/session";

type DapMessage = {
  type: string;
  event?: string;
  command?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: Record<string, unknown>;
};

class DapClient {
  private readonly session: SmallBasicDebugSession;
  private readonly clientToAdapter = new PassThrough();
  private readonly adapterToClient = new PassThrough();
  private readonly pending = new Map<number, (message: DapMessage) => void>();
  private readonly events: DapMessage[] = [];
  private buffer = Buffer.alloc(0);
  private seq = 0;

  public constructor(sourceAccessor: DebugSourceAccessor = new NodeDebugSourceAccessor()) {
    this.session = new SmallBasicDebugSession(sourceAccessor);
    this.session.setRunAsServer(true);
    this.session.start(this.clientToAdapter, this.adapterToClient);
    this.adapterToClient.on("data", (chunk: Buffer) => this.onData(chunk));
  }

  public request(command: string, args?: Record<string, unknown>): Promise<DapMessage> {
    this.seq += 1;
    const message: Record<string, unknown> = { seq: this.seq, type: "request", command };
    if (args) {
      message.arguments = args;
    }

    return new Promise<DapMessage>((resolve, reject) => {
      this.pending.set(this.seq, (response) => {
        if (response.success === false) {
          reject(new Error(`${command} failed: ${response.message}`));
        } else {
          resolve(response);
        }
      });

      const json = JSON.stringify(message);
      this.clientToAdapter.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`, "utf8");
    });
  }

  public async waitForEvent(eventName: string, occurrence = 1, timeoutMs = 5000): Promise<DapMessage> {
    const startedAt = Date.now();
    for (;;) {
      const matches = this.events.filter((event) => event.event === eventName);
      if (matches.length >= occurrence) {
        return matches[occurrence - 1];
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for event '${eventName}'. Seen: ${this.events.map((event) => event.event).join(", ")}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  public eventCount(eventName: string): number {
    return this.events.filter((event) => event.event === eventName).length;
  }

  public outputText(): string {
    return this.events
      .filter((event) => event.event === "output")
      .map((event) => String(event.body?.output ?? ""))
      .join("");
  }

  public stopSession(): void {
    this.session.stop();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }

      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        throw new Error(`Malformed DAP header: ${header}`);
      }

      const length = Number.parseInt(match[1], 10);
      if (this.buffer.length < headerEnd + 4 + length) {
        return;
      }

      const body = this.buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      this.buffer = this.buffer.slice(headerEnd + 4 + length);
      const message = JSON.parse(body) as DapMessage;
      if (message.type === "response") {
        const handler = this.pending.get(message.request_seq ?? -1);
        if (handler) {
          this.pending.delete(message.request_seq ?? -1);
          handler(message);
        }
      } else if (message.type === "event") {
        this.events.push(message);
      }
    }
  }
}

describe("smallbasic debug session", () => {
  let workDir: string;
  let client: DapClient;

  const writeProgram = (name: string, text: string): string => {
    const filePath = path.join(workDir, name);
    fs.writeFileSync(filePath, text, "utf8");
    return filePath;
  };

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-debug-test-"));
    client = new DapClient();
  });

  afterEach(() => {
    client.stopSession();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("runs a program to completion and forwards TextWindow output", async () => {
    const program = writeProgram("hello.sb", 'TextWindow.WriteLine("Hello, World!")\n');

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    await client.request("configurationDone");

    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("Hello, World!");
  });

  it("runs from an in-memory source accessor used by VS Code for the Web", async () => {
    const program = "memfs:/workspace/web.sb";
    client.stopSession();
    client = new DapClient({
      resolvePath: (filePath) => filePath,
      basename: () => "web.sb",
      readFile: (filePath) => {
        if (filePath !== program) {
          throw new Error(`Unexpected path: ${filePath}`);
        }

        return 'x = 21\nTextWindow.WriteLine(x * 2)\n';
      }
    });

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    await client.request("configurationDone");

    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("42");
  });

  it("verifies breakpoints, stops, steps over, and exposes variables", async () => {
    const program = writeProgram(
      "steps.sb",
      ['x = 1', 'y = x + 1', 'TextWindow.WriteLine(y)', ''].join("\n")
    );

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    const breakpoints = await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 2 }]
    });
    expect((breakpoints.body?.breakpoints as Array<{ verified: boolean; line: number }>)[0]).toMatchObject({
      verified: true,
      line: 2
    });
    await client.request("configurationDone");

    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body?.reason).toBe("breakpoint");

    let stack = await client.request("stackTrace", { threadId: 1 });
    let frames = stack.body?.stackFrames as Array<{ line: number }>;
    expect(frames[0].line).toBe(2);

    await client.request("next", { threadId: 1 });
    await client.waitForEvent("stopped", 2);
    stack = await client.request("stackTrace", { threadId: 1 });
    frames = stack.body?.stackFrames as Array<{ line: number }>;
    expect(frames[0].line).toBe(3);

    const scopes = await client.request("scopes", { frameId: 1 });
    const variables = await client.request("variables", {
      variablesReference: (scopes.body?.scopes as Array<{ variablesReference: number }>)[0].variablesReference
    });
    const entries = variables.body?.variables as Array<{ name: string; value: string }>;
    expect(entries.find((variable) => variable.name === "x")?.value).toBe("1");
    expect(entries.find((variable) => variable.name === "y")?.value).toBe("2");

    const evaluation = await client.request("evaluate", { expression: "y" });
    expect(evaluation.body?.result).toBe("2");

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("2");
  });

  it("stops only when a conditional breakpoint condition is true", async () => {
    const program = writeProgram(
      "conditional.sb",
      ['For i = 1 To 5', 'TextWindow.WriteLine(i)', 'EndFor', ''].join("\n")
    );

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    const breakpoints = await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 2, condition: "i = 3" }]
    });
    expect((breakpoints.body?.breakpoints as Array<{ verified: boolean; line: number }>)[0]).toMatchObject({
      verified: true,
      line: 2
    });
    await client.request("configurationDone");

    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body?.reason).toBe("breakpoint");

    const evaluation = await client.request("evaluate", { expression: "i" });
    expect(evaluation.body?.result).toBe("3");
    expect(client.outputText()).toContain("2");
    expect(client.outputText()).not.toContain("3");

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("5");
  });

  it("never stops when a conditional breakpoint condition stays false", async () => {
    const program = writeProgram(
      "conditional-false.sb",
      ['For i = 1 To 5', 'TextWindow.WriteLine(i)', 'EndFor', ''].join("\n")
    );

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 2, condition: "i = 99" }]
    });
    await client.request("configurationDone");

    await client.waitForEvent("terminated");
    expect(client.eventCount("stopped")).toBe(0);
    expect(client.outputText()).toContain("5");
  });

  it("rejects a conditional breakpoint whose condition does not compile", async () => {
    const program = writeProgram("conditional-invalid.sb", ['x = 1', 'TextWindow.WriteLine(x)', ''].join("\n"));

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    const breakpoints = await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 2, condition: "x = = 1" }]
    });
    const [breakpoint] = breakpoints.body?.breakpoints as Array<{ verified: boolean; message?: string }>;
    expect(breakpoint.verified).toBe(false);
    expect(breakpoint.message).toContain("无法编译条件");
  });

  it("snaps breakpoints on blank lines to the next executable line", async () => {
    const program = writeProgram("snap.sb", ['x = 1', '', 'TextWindow.WriteLine(x)', ''].join("\n"));

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    const breakpoints = await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 2 }]
    });
    const [breakpoint] = breakpoints.body?.breakpoints as Array<{ verified: boolean; line: number }>;
    expect(breakpoint.verified).toBe(true);
    expect(breakpoint.line).toBe(3);

    await client.request("configurationDone");
    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body?.reason).toBe("breakpoint");
    const stack = await client.request("stackTrace", { threadId: 1 });
    expect((stack.body?.stackFrames as Array<{ line: number }>)[0].line).toBe(3);

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
  });

  it("bridges TextWindow input through evaluate", async () => {
    const program = writeProgram(
      "input.sb",
      ['n = TextWindow.ReadNumber()', 'TextWindow.WriteLine(n * 2)', ''].join("\n")
    );

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    await client.request("configurationDone");

    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body?.description).toBe("Waiting for input");

    await client.request("evaluate", { expression: "42" });
    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("84");
  });

  it("stops on entry when stopOnEntry is set", async () => {
    const program = writeProgram("entry.sb", 'TextWindow.WriteLine("go")\n');

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: true });
    await client.request("configurationDone");

    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body?.reason).toBe("entry");
    expect(client.eventCount("stopped")).toBe(1);

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("go");
  });

  it("starts when VS Code completes configuration before launch", async () => {
    const program = writeProgram(
      "configuration-first.sb",
      ['x = 1', 'TextWindow.WriteLine(x)', ''].join("\n")
    );

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    const breakpoints = await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 2 }]
    });
    expect((breakpoints.body?.breakpoints as Array<{ verified: boolean }>)[0].verified).toBe(true);

    // VS Code is allowed to finish the breakpoint configuration sequence before
    // it sends launch. The adapter must preserve that state across launch.
    await client.request("configurationDone");
    await client.request("launch", { program, stopOnEntry: false });

    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body?.reason).toBe("breakpoint");

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
  });

  it("rejects graphics programs with a launch error", async () => {
    const program = writeProgram("graphics.sb", 'GraphicsWindow.Show()\n');

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    const launch = await client.request("launch", { program, stopOnEntry: false }).catch((error: Error) => error);
    expect(launch).toBeInstanceOf(Error);
  });
});
