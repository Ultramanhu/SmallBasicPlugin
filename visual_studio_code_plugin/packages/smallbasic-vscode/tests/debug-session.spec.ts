import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeDebugSourceAccessor } from "../src/debug/node-source-accessor";
import { DebugSourceAccessor, SmallBasicDebugSession } from "../src/debug/session";
import { DapClient } from "./support/dap-client";

describe("smallbasic debug session", () => {
  let workDir: string;
  let client: DapClient;
  let session: SmallBasicDebugSession;

  const writeProgram = (name: string, text: string): string => {
    const filePath = path.join(workDir, name);
    fs.writeFileSync(filePath, text, "utf8");
    return filePath;
  };

  const startClient = (accessor: DebugSourceAccessor = new NodeDebugSourceAccessor()): void => {
    session = new SmallBasicDebugSession(accessor);
    client = new DapClient(session);
  };

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-debug-test-"));
    startClient();
  });

  afterEach(() => {
    session.stop();
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
    session.stop();
    startClient({
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

  it("steps through and evaluates integer division and modulo expressions", async () => {
    const program = writeProgram(
      "arithmetic-debug.sb",
      ["Value = 17", "Whole = Value \\ 5", "Rest = Value Mod 5", "TextWindow.WriteLine(Whole + Rest)", ""].join("\n")
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
    await client.waitForEvent("stopped");

    expect((await client.request("evaluate", { expression: "Value \\ 5" })).body?.result).toBe("3");
    expect((await client.request("evaluate", { expression: "Value Mod 5" })).body?.result).toBe("2");
    expect((await client.request("evaluate", { expression: "Math.Mod(Value, 5)" })).body?.result).toBe("2");

    await client.request("next", { threadId: 1 });
    await client.waitForEvent("stopped", 2);
    const stack = await client.request("stackTrace", { threadId: 1 });
    expect((stack.body?.stackFrames as Array<{ line: number }>)[0].line).toBe(3);

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("5");
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

  it("stops on a Break line and steps out of the loop", async () => {
    const program = writeProgram(
      "break-line.sb",
      [
        "I = 0",
        'While "True"',
        "  I = I + 1",
        "  If I = 3 Then",
        "    Break",
        "  EndIf",
        "EndWhile",
        "TextWindow.WriteLine(I)",
        ""
      ].join("\n")
    );

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    const breakpoints = await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 5 }]
    });
    expect((breakpoints.body?.breakpoints as Array<{ verified: boolean; line: number }>)[0]).toMatchObject({
      verified: true,
      line: 5
    });
    await client.request("configurationDone");

    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body?.reason).toBe("breakpoint");
    const atBreak = await client.request("stackTrace", { threadId: 1 });
    expect((atBreak.body?.stackFrames as Array<{ line: number }>)[0].line).toBe(5);

    // `Break` is an ordinary statement: stepping over it leaves the loop and
    // never stops on the synthesized lowering labels.
    await client.request("next", { threadId: 1 });
    await client.waitForEvent("stopped", 2);
    const afterBreak = await client.request("stackTrace", { threadId: 1 });
    expect((afterBreak.body?.stackFrames as Array<{ line: number }>)[0].line).toBe(8);

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("3");
  });

  it("stops on a Continue line and still runs the For increment", async () => {
    const program = writeProgram(
      "continue-line.sb",
      [
        "Sum = 0",
        "For I = 1 To 4",
        "  If I = 2 Then",
        "    Continue",
        "  EndIf",
        "  Sum = Sum + I",
        "EndFor",
        "TextWindow.WriteLine(Sum)",
        ""
      ].join("\n")
    );

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    const breakpoints = await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 4 }]
    });
    expect((breakpoints.body?.breakpoints as Array<{ verified: boolean; line: number }>)[0]).toMatchObject({
      verified: true,
      line: 4
    });
    await client.request("configurationDone");

    const stopped = await client.waitForEvent("stopped");
    expect(stopped.body?.reason).toBe("breakpoint");
    const evaluation = await client.request("evaluate", { expression: "I" });
    expect(evaluation.body?.result).toBe("2");

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
    // 1 + 3 + 4 = 8: the `Continue` round still ran the For increment, so the
    // skipped iteration is the only one missing from the sum.
    expect(client.outputText()).toContain("8");
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

  it("shows Function parameters and Dim variables per frame and evaluates with locals", async () => {
    const program = writeProgram("function-debug.sb", [
      "answer = Calculate(4)",
      "TextWindow.WriteLine(answer)",
      "Function Calculate(Input)",
      "  Dim Doubled",
      "  Doubled = Input * 2",
      "  Return Doubled",
      "EndFunction"
    ].join("\n"));

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 5 }]
    });
    await client.request("configurationDone");
    await client.waitForEvent("stopped");

    const stack = await client.request("stackTrace", { threadId: 1 });
    const frames = stack.body?.stackFrames as Array<{ id: number; name: string }>;
    expect(frames.map((frame) => frame.name)).toEqual(["Calculate", "<Main>"]);

    const scopes = await client.request("scopes", { frameId: frames[0].id });
    const localScope = (scopes.body?.scopes as Array<{ name: string; variablesReference: number }>)
      .find((scope) => scope.name === "Locals")!;
    const variables = await client.request("variables", { variablesReference: localScope.variablesReference });
    const locals = variables.body?.variables as Array<{ name: string; value: string }>;
    expect(locals.find((variable) => variable.name === "Input")?.value).toBe("4");
    expect(locals.find((variable) => variable.name === "Doubled")?.value).toBe('""');

    const evaluation = await client.request("evaluate", { expression: "Input + 1", frameId: frames[0].id });
    expect(evaluation.body?.result).toBe("5");

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
    expect(client.outputText()).toContain("8");
  });

  it("keeps recursive Function frames distinct and evaluates the selected frame", async () => {
    const program = writeProgram("recursive-debug.sb", [
      "answer = Recurse(3)",
      "Function Recurse(N)",
      "  Dim Current",
      "  Current = N",
      "  If N > 1 Then",
      "    Return Recurse(N - 1)",
      "  EndIf",
      "  Return Current",
      "EndFunction"
    ].join("\n"));

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: false });
    await client.request("setBreakpoints", {
      source: { path: program },
      breakpoints: [{ line: 5 }]
    });
    await client.request("configurationDone");
    await client.waitForEvent("stopped");
    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("stopped", 2);
    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("stopped", 3);

    const stack = await client.request("stackTrace", { threadId: 1 });
    const frames = stack.body?.stackFrames as Array<{ id: number; name: string }>;
    expect(frames.map((frame) => frame.name)).toEqual(["Recurse", "Recurse", "Recurse", "<Main>"]);
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(frames.length);

    for (const [index, expected] of ["1", "2", "3"].entries()) {
      const evaluation = await client.request("evaluate", { expression: "N", frameId: frames[index].id });
      expect(evaluation.body?.result).toBe(expected);
    }

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
  });

  it("steps into and out of a Function call", async () => {
    const program = writeProgram("function-steps.sb", [
      "answer = Double(4)",
      "TextWindow.WriteLine(answer)",
      "Function Double(Value)",
      "  Dim Result",
      "  Result = Value * 2",
      "  Return Result",
      "EndFunction"
    ].join("\n"));

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: true });
    await client.request("configurationDone");
    await client.waitForEvent("stopped");

    await client.request("stepIn", { threadId: 1 });
    await client.waitForEvent("stopped", 2);
    let stack = await client.request("stackTrace", { threadId: 1 });
    expect((stack.body?.stackFrames as Array<{ name: string }>)[0].name).toBe("Double");

    await client.request("stepOut", { threadId: 1 });
    await client.waitForEvent("stopped", 3);
    stack = await client.request("stackTrace", { threadId: 1 });
    const frames = stack.body?.stackFrames as Array<{ name: string; line: number }>;
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ name: "<Main>", line: 2 });

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
  });

  it("steps over a Function call and stops on the following statement", async () => {
    const program = writeProgram("function-next.sb", [
      "answer = Double(4)",
      "TextWindow.WriteLine(answer)",
      "Function Double(Value)",
      "  Return Value * 2",
      "EndFunction"
    ].join("\n"));

    await client.request("initialize", { adapterID: "smallbasic", pathFormat: "path" });
    await client.request("launch", { program, stopOnEntry: true });
    await client.request("configurationDone");
    await client.waitForEvent("stopped");

    await client.request("next", { threadId: 1 });
    await client.waitForEvent("stopped", 2);
    const stack = await client.request("stackTrace", { threadId: 1 });
    expect((stack.body?.stackFrames as Array<{ name: string; line: number }>)[0])
      .toMatchObject({ name: "<Main>", line: 2 });

    await client.request("continue", { threadId: 1 });
    await client.waitForEvent("terminated");
  });
});
