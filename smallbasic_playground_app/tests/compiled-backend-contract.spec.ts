import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Process-level contract of the desktop Playground's compiler backend
 * (design doc 10, §19.5): the Rust shell compiles the session program into the
 * output directory the user picked, then either launches the produced EXE
 * (`run`) or debugs it through the compiled DAP adapter - which is told where
 * the artifact lives, because the session program sits in the app cache instead
 * of next to the EXE.
 *
 * This spec drives exactly those argv shapes against the staged payload, so a
 * rename in the packaging contract fails here rather than in the packaged app.
 * It only runs when `runhost/playground` was staged (the payload is generated);
 * on a clean checkout every case is skipped.
 */
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(testDirectory);
const repositoryRoot = path.resolve(packageRoot, "..");

const compilerPayload = path.join(
  repositoryRoot, "runhost", "playground", "resources", "dotnet", "compiler-net48");
const exeSuffix = process.platform === "win32" ? ".exe" : "";
const compilerTool = path.join(compilerPayload, `SmallBasic.Compiler.Tool${exeSuffix}`);
const compiledAdapter = path.join(compilerPayload, `SmallBasic.CompiledDebugAdapter${exeSuffix}`);

const payloadStaged = fs.existsSync(compilerTool) && fs.existsSync(compiledAdapter);

const PROGRAM_NAME = "hello.sb";
const PROGRAM_SOURCE = [
  'TextWindow.WriteLine("Hello, World!")',
  "Total = 0",
  "For I = 1 To 3",
  "  Total = Total + I",
  "EndFor",
  'TextWindow.WriteLine("Total=" + Total)',
  ""
].join("\n");
/** 1-based line of the `TextWindow.WriteLine("Total=" + Total)` statement. */
const BREAKPOINT_LINE = 6;

/** One workspace per case: the session scratch directory plus the artifact directory. */
function createWorkspace(): { root: string; sessionDirectory: string; outputDirectory: string; programPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-compiled-backend-"));
  const sessionDirectory = path.join(root, "session");
  const outputDirectory = path.join(root, "out");
  fs.mkdirSync(sessionDirectory, { recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });

  // The shell names the session program after the program, because the artifact
  // base name is derived from the source file name.
  const programPath = path.join(sessionDirectory, PROGRAM_NAME);
  fs.writeFileSync(programPath, PROGRAM_SOURCE, "utf8");
  return { root, sessionDirectory, outputDirectory, programPath };
}

/** Mirrors `process_manager::compile_artifact`'s argv exactly. */
function compile(
  programPath: string,
  outputDirectory: string
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(compilerTool, [
    "compile",
    "--file", programPath,
    "--outputDir", outputDirectory
  ], { cwd: compilerPayload, encoding: "utf8" });

  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

interface DapMessage {
  type?: string;
  event?: string;
  command?: string;
  success?: boolean;
  message?: string;
  body?: Record<string, unknown>;
}

interface DapSession {
  child: ChildProcessWithoutNullStreams;
  send(command: string, args?: Record<string, unknown>): void;
  waitFor(predicate: (message: DapMessage) => boolean, timeoutMs?: number): Promise<DapMessage>;
}

/** Same framing helper as `cli-debug-contract.spec.ts`, for the third adapter. */
function startDapAdapter(command: string, cwd: string): DapSession {
  const child = spawn(command, [], { cwd, stdio: ["pipe", "pipe", "pipe"] });
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
          reject(new Error("timed out waiting for the next DAP message"));
        }
      }, 25);
    });

  return { child, send, waitFor };
}

const workspaces: string[] = [];

afterAll(() => {
  for (const root of workspaces) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(!payloadStaged)("compiled C# backend contract", () => {
  it("stages the artifact the shell then launches", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace.root);

    const result = compile(workspace.programPath, workspace.outputDirectory);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    // `CompiledProgramLayout.ForSourceProgram`: the entry point, its manifest
    // and the source payload all follow the program name; the runtime support
    // assemblies move into `lib/` so the artifact root stays readable.
    expect(fs.existsSync(path.join(workspace.outputDirectory, "hello.exe"))).toBe(true);
    expect(fs.existsSync(path.join(workspace.outputDirectory, "hello.smallbasic.json"))).toBe(true);
    expect(fs.existsSync(path.join(workspace.outputDirectory, "hello.smallbasic.source"))).toBe(true);
    expect(fs.readdirSync(path.join(workspace.outputDirectory, "lib"))).toContain("SmallBasicLibrary.dll");
  });

  it("overwrites an existing artifact in place when the program changed", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace.root);

    expect(compile(workspace.programPath, workspace.outputDirectory).status).toBe(0);
    const manifestPath = path.join(workspace.outputDirectory, "hello.smallbasic.json");
    const first = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { SourceHash: string };

    fs.writeFileSync(workspace.programPath, PROGRAM_SOURCE.replace("Hello, World!", "Hello again!"), "utf8");
    expect(compile(workspace.programPath, workspace.outputDirectory).status).toBe(0);

    const second = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { SourceHash: string };
    expect(second.SourceHash).not.toBe(first.SourceHash);
  });

  it("runs the artifact with the shell's `run` argument, without the double-click banner", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace.root);
    expect(compile(workspace.programPath, workspace.outputDirectory).status).toBe(0);

    const executable = path.join(workspace.outputDirectory, "hello.exe");
    const result = spawnSync(executable, ["run"], { cwd: workspace.outputDirectory, encoding: "utf8", input: "" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Hello, World!");
    expect(result.stdout).toContain("Total=6");
    // An argument-less launch is the double-click shape and pauses; the shell
    // must not put that banner into the output pane on every Run.
    expect(result.stdout).not.toContain("按任意键继续");
  });

  it("debugs the artifact through the output directory it was compiled into", async () => {
    const workspace = createWorkspace();
    workspaces.push(workspace.root);
    expect(compile(workspace.programPath, workspace.outputDirectory).status).toBe(0);

    const session = startDapAdapter(compiledAdapter, compilerPayload);
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
        source: { name: PROGRAM_NAME, path: workspace.programPath },
        lines: [BREAKPOINT_LINE],
        breakpoints: [{ line: BREAKPOINT_LINE }]
      });
      const breakpoints = await session.waitFor(
        (message) => message.type === "response" && message.command === "setBreakpoints");
      expect(breakpoints.body?.breakpoints).toMatchObject([{ verified: true, line: BREAKPOINT_LINE }]);

      // The artifact does not sit next to the session program, so the adapter
      // only finds it through `outputDirectory` (the reason it was added).
      session.send("launch", {
        program: workspace.programPath,
        name: PROGRAM_NAME,
        stopOnEntry: false,
        outputDirectory: workspace.outputDirectory
      });
      const launch = await session.waitFor(
        (message) => message.type === "response" && message.command === "launch");
      expect(launch.success, launch.message).toBe(true);
      session.send("configurationDone");

      const stopped = await session.waitFor((message) => message.type === "event" && message.event === "stopped");
      expect(stopped.body?.reason).toBe("breakpoint");

      session.send("stackTrace", { threadId: 1 });
      const stack = await session.waitFor(
        (message) => message.type === "response" && message.command === "stackTrace");
      const frames = (stack.body?.stackFrames ?? []) as Array<{ line?: number }>;
      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0].line).toBe(BREAKPOINT_LINE);

      session.send("continue", { threadId: 1 });
      await session.waitFor((message) => message.type === "event" && message.event === "terminated", 120_000);
    } finally {
      session.child.kill();
    }
  }, 180_000);

  it("refuses to debug when the artifact directory holds no compiled program", async () => {
    const workspace = createWorkspace();
    workspaces.push(workspace.root);
    // No compile: the adapter must reject the launch instead of falling back to
    // interpreting the source, which would silently ignore the backend choice.
    const emptyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sb-compiled-empty-"));
    workspaces.push(emptyDirectory);

    const session = startDapAdapter(compiledAdapter, compilerPayload);
    try {
      session.send("initialize", { adapterID: "smallbasic-playground", linesStartAt1: true, pathFormat: "path" });
      await session.waitFor((message) => message.type === "event" && message.event === "initialized");

      session.send("launch", {
        program: workspace.programPath,
        name: PROGRAM_NAME,
        stopOnEntry: false,
        outputDirectory: emptyDirectory
      });
      const launch = await session.waitFor(
        (message) => message.type === "response" && message.command === "launch");
      expect(launch.success).toBe(false);
      expect(launch.message ?? "").toContain("Compiled Small Basic executable not found");
    } finally {
      session.child.kill();
    }
  }, 120_000);
});
