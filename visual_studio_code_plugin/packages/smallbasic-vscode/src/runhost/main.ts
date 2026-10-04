import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
import { Compilation, ExecutionEngine, ExecutionMode, ExecutionState, IGraphicsWindowLibraryPlugin, IShapesLibraryPlugin } from "smallbasic-lang-core";
import { ansiColorize } from "../common/ansi";
import { sleep } from "../common/async";
import { createUnsupportedPlugin, describeError, UnsupportedLibraryError } from "../common/errors";
import { BufferedTextWindowPlugin } from "../common/text-window";
import { RUN_HOST_CAPABILITIES } from "../run/capabilities";
import { EXIT_COMPILE_ERROR, EXIT_RUNTIME_ERROR, EXIT_SUCCESS, EXIT_UNSUPPORTED_LIBRARY } from "./exit-codes";

/**
 * Standalone Node.js run host for SmallBasic programs, mirroring the CLI of the
 * C# SmallBasic.RunHost: `run --file <program.sb> [--pause]`.
 *
 * Exit codes match the C# host (`./exit-codes`).
 */

class NodeTextWindowPlugin extends BufferedTextWindowPlugin {
  private readonly pendingLines: string[] = [];
  private readonly lineWaiters: Array<(line: string) => void> = [];
  private readonly isTTY = process.stdout.isTTY === true;
  private readonly inputInterface: readline.Interface;
  private stdinClosed = false;

  public constructor() {
    super();
    // The readline interface must be created eagerly (before any await) so that
    // piped standard input is still readable by the time a Read() executes.
    this.inputInterface = readline.createInterface({
      input: process.stdin,
      terminal: process.stdin.isTTY === true
    });
    this.inputInterface.on("line", (line: string) => {
      const stripped = line.replace(/^\uFEFF/, "");
      const waiter = this.lineWaiters.shift();
      if (waiter) {
        waiter(stripped);
      } else {
        this.pendingLines.push(stripped);
      }
    });
    this.inputInterface.on("close", () => {
      this.stdinClosed = true;
      for (const waiter of this.lineWaiters.splice(0)) {
        waiter("");
      }
    });
  }

  public writeText(value: string, appendNewLine: boolean): void {
    const text = value + (appendNewLine ? "\n" : "");
    process.stdout.write(this.isTTY
      ? ansiColorize(text, this.getForegroundColor(), this.getBackgroundColor())
      : text);
  }

  public readLine(): Promise<string> {
    return new Promise((resolve) => {
      const buffered = this.pendingLines.shift();
      if (buffered !== undefined) {
        resolve(buffered);
        return;
      }

      if (this.stdinClosed) {
        // Mirrors the C# host, which turns a closed console into an empty line.
        resolve("");
        return;
      }

      this.lineWaiters.push(resolve);
    });
  }
}

interface RunHostArguments {
  filePath: string;
  pauseOnExit: boolean;
}

function tryParseArguments(args: string[]): RunHostArguments | undefined {
  const pauseOnExit = args.some((value) => value.toLowerCase() === "--pause");
  if (args.length >= 3 && args[0].toLowerCase() === "run") {
    for (let index = 1; index < args.length - 1; index += 1) {
      if (args[index].toLowerCase() === "--file") {
        return {
          filePath: path.resolve(args[index + 1]),
          pauseOnExit
        };
      }
    }
  }

  return undefined;
}

function pauseAndExit(code: number, pauseOnExit: boolean): Promise<never> {
  if (!pauseOnExit || process.stdin.isTTY !== true) {
    process.exit(code);
  }

  return new Promise(() => {
    process.stdout.write("\n按 Enter 键继续...\n");
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: true
    });
    rl.question("", () => {
      rl.close();
      process.exit(code);
    });
  });
}

async function main(): Promise<void> {
  const rawArguments = process.argv.slice(2);
  if (rawArguments.length === 1 && rawArguments[0].toLowerCase() === "--capabilities") {
    process.stdout.write(`${JSON.stringify(RUN_HOST_CAPABILITIES)}\n`);
    return;
  }

  const arguments_ = tryParseArguments(rawArguments);
  if (!arguments_) {
    process.stderr.write("Usage: smallbasic-runhost run --file <program.sb> [--pause] | smallbasic-runhost --capabilities\n");
    await pauseAndExit(EXIT_COMPILE_ERROR, true);
    return;
  }

  const { filePath, pauseOnExit } = arguments_;
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`SmallBasic source file not found: ${filePath}\n`);
    await pauseAndExit(EXIT_COMPILE_ERROR, pauseOnExit);
    return;
  }

  let source = fs.readFileSync(filePath, "utf8");
  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
  }

  const compilation = new Compilation(source);
  if (!compilation.isReadyToRun) {
    process.stderr.write(compilation.diagnostics.map((item) => item.toString()).join("\n") + "\n");
    await pauseAndExit(EXIT_COMPILE_ERROR, pauseOnExit);
    return;
  }

  const engine = new ExecutionEngine(compilation);
  const textWindow = new NodeTextWindowPlugin();
  engine.libraries.TextWindow.plugin = textWindow;
  engine.libraries.GraphicsWindow.plugin = createUnsupportedPlugin<IGraphicsWindowLibraryPlugin>(
    "GraphicsWindow is not supported by the JavaScript SmallBasic run host yet."
  );
  engine.libraries.Shapes.plugin = createUnsupportedPlugin<IShapesLibraryPlugin>(
    "Shapes is not supported by the JavaScript SmallBasic run host yet."
  );

  try {
    while (true) {
      engine.execute(ExecutionMode.RunToEnd);

      switch (engine.state) {
        case ExecutionState.Running:
          break;
        case ExecutionState.BlockedOnInput:
          if (textWindow.isWaitingForInput()) {
            textWindow.pushInput(await textWindow.readLine());
            engine.state = ExecutionState.Running;
          } else {
            // Program.Delay keeps the engine blocked until its timer elapses.
            await sleep(10);
          }
          break;
        case ExecutionState.Paused:
          engine.state = ExecutionState.Running;
          break;
        case ExecutionState.Terminated:
          if (engine.exception) {
            process.stderr.write(`\n[Runtime Error] ${engine.exception.toString()}\n`);
            await pauseAndExit(EXIT_RUNTIME_ERROR, pauseOnExit);
          }

          await pauseAndExit(EXIT_SUCCESS, pauseOnExit);
          return;
        default:
          throw new Error(`Unexpected execution state: ${ExecutionState[engine.state]}`);
      }
    }
  } catch (error) {
    if (error instanceof UnsupportedLibraryError) {
      process.stderr.write(`${error.message}\n`);
      await pauseAndExit(EXIT_UNSUPPORTED_LIBRARY, pauseOnExit);
      return;
    }

    process.stderr.write(`${describeError(error, true)}\n`);
    await pauseAndExit(EXIT_RUNTIME_ERROR, pauseOnExit);
  }
}

void main();
