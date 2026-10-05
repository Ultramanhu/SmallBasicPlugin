import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Process-level contract of the CLI debug adapters (design doc 10, §18.1/§18.3):
 * the Rust shell spawns them with a fixed argv and the page configures
 * breakpoints from the adapter's `initialized` event - i.e. `setBreakpoints`
 * arrives **before** `launch`. This spec drives both staged .NET RunHost
 * flavours through that exact handshake and asserts a breakpoint verifies and
 * stops.
 *
 * It only runs when the desktop staging root was assembled (the hosts are
 * generated binaries); on a clean checkout every case is skipped.
 */
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(testDirectory);
const repositoryRoot = path.resolve(packageRoot, "..", "..", "..");

const binDir = path.join(repositoryRoot, "runhost", "playground", "bin");
const resourcesDir = path.join(repositoryRoot, "runhost", "playground", "resources");
const program = path.join(repositoryRoot, "sample", "hello", "hello.sb");

function hostTriple(): string {
  const arm = process.arch === "arm64";
  if (process.platform === "win32") {
    return arm ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }

  if (process.platform === "darwin") {
    return arm ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }

  return arm ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
}

const triple = hostTriple();
const exeSuffix = process.platform === "win32" ? ".exe" : "";
const sidecar = (base: string) => path.join(binDir, `${base}-${triple}${exeSuffix}`);

interface DebugTarget {
  name: string;
  command: string;
  args: string[];
  cwd: string;
}

const net48Payload = path.join(resourcesDir, "dotnet", "csharp-net48");

const targets: DebugTarget[] = [
  {
    name: "cli-csharp-net8",
    command: sidecar("smallbasic-csharp-net8"),
    args: ["debug"],
    cwd: repositoryRoot
  },
  {
    name: "cli-csharp-net48",
    command: path.join(net48Payload, `SmallBasic.RunHost${exeSuffix}`),
    args: ["debug"],
    // A .NET Framework host is a folder deployment: it runs from its own
    // directory, which is exactly what the Rust shell does.
    cwd: net48Payload
  }
].filter((target) => fs.existsSync(target.command));

interface DapMessage {
  type?: string;
  event?: string;
  command?: string;
  body?: Record<string, unknown>;
}

interface DapSession {
  child: ChildProcessWithoutNullStreams;
  send(command: string, args?: Record<string, unknown>): void;
  waitFor(predicate: (message: DapMessage) => boolean, timeoutMs?: number): Promise<DapMessage>;
}

function startDapAdapter(target: DebugTarget): DapSession {
  const child = spawn(target.command, target.args, { cwd: target.cwd, stdio: ["pipe", "pipe", "pipe"] });
  const messages: DapMessage[] = [];
  let buffer = Buffer.alloc(0);

  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        break;
      }

      const headers = buffer.subarray(0, headerEnd).toString("latin1");
      const length = Number(/content-length:\s*(\d+)/i.exec(headers)?.[1] ?? "0");
      const start = headerEnd + 4;
      if (length === 0 || buffer.length < start + length) {
        break;
      }

      messages.push(JSON.parse(buffer.subarray(start, start + length).toString("utf8")) as DapMessage);
      buffer = buffer.subarray(start + length);
    }
  });
  child.stderr.on("data", () => {});

  let sequence = 0;
  const send = (command: string, args: Record<string, unknown> = {}): void => {
    const body = JSON.stringify({ seq: ++sequence, type: "request", command, arguments: args });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const waitFor = (predicate: (message: DapMessage) => boolean, timeoutMs = 60_000): Promise<DapMessage> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const found = messages.find(predicate);
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`${target.name}: timed out waiting for the next DAP message`));
        }
      }, 25);
    });

  return { child, send, waitFor };
}

describe.skipIf(targets.length === 0)("CLI debug adapter contract (setBreakpoints before launch)", () => {
  it.each(targets)("$name advertises the Function runtime capability", async (target) => {
    const child = spawn(target.command, ["--capabilities"], {
      cwd: target.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      protocolVersion: 2,
      capabilities: ["function-v1"]
    });
  });

  it.each(targets)(
    "$name validates the breakpoint and stops on it",
    async (target) => {
      const session = startDapAdapter(target);
      try {
        session.send("initialize", {
          adapterID: "smallbasic-playground",
          linesStartAt1: true,
          columnsStartAt1: true,
          pathFormat: "path"
        });
        await session.waitFor((message) => message.type === "event" && message.event === "initialized");

        // Exactly what LocalCliDebugTransport does on `initialized`.
        session.send("setBreakpoints", {
          source: { name: "hello.sb", path: program },
          lines: [5],
          breakpoints: [{ line: 5 }]
        });
        const breakpoints = await session.waitFor((message) => message.type === "response" && message.command === "setBreakpoints");
        const declared = (breakpoints.body?.breakpoints ?? []) as Array<{ verified?: boolean; line?: number }>;
        expect(declared).toHaveLength(1);
        expect(declared[0].verified).toBe(true);
        expect(declared[0].line).toBe(5);

        session.send("launch", { program, name: "hello.sb", stopOnEntry: false });
        await session.waitFor((message) => message.type === "response" && message.command === "launch");
        session.send("configurationDone");

        const stopped = await session.waitFor((message) => message.type === "event" && message.event === "stopped");
        expect(stopped.body?.reason).toBe("breakpoint");

        session.send("stackTrace", { threadId: 1 });
        const stack = await session.waitFor((message) => message.type === "response" && message.command === "stackTrace");
        const frames = (stack.body?.stackFrames ?? []) as Array<{ line?: number }>;
        expect(frames.length).toBeGreaterThan(0);
        expect(frames[0].line).toBe(5);

        session.send("continue", { threadId: 1 });
        await session.waitFor((message) => message.type === "event" && message.event === "terminated", 120_000);
      } finally {
        session.child.kill();
      }
    },
    180_000
  );
});
