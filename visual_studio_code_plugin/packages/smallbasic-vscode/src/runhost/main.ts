import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
import {
  BaseValue,
  Compilation,
  ExecutionEngine,
  ExecutionMode,
  ExecutionState,
  IGraphicsWindowLibraryPlugin,
  IShapesLibraryPlugin,
  ITextWindowLibraryPlugin,
  NumberValue,
  StringValue,
  TextWindowColor,
  ValueKind
} from "smallbasic-lang-core";
import { RUN_HOST_CAPABILITIES } from "../run/capabilities";

/**
 * Standalone Node.js run host for SmallBasic programs, mirroring the CLI of the
 * C# SmallBasic.RunHost: `run --file <program.sb> [--pause]`.
 *
 * Exit codes match the C# host: 0 success, 1 usage/compile errors, 3 unsupported
 * library usage, 4 unexpected runtime failures.
 */

const ANSI_FOREGROUND: Record<TextWindowColor, number> = {
  [TextWindowColor.Black]: 30,
  [TextWindowColor.DarkBlue]: 34,
  [TextWindowColor.DarkGreen]: 32,
  [TextWindowColor.DarkCyan]: 36,
  [TextWindowColor.DarkRed]: 31,
  [TextWindowColor.DarkMagenta]: 35,
  [TextWindowColor.DarkYellow]: 33,
  [TextWindowColor.Gray]: 37,
  [TextWindowColor.DarkGray]: 90,
  [TextWindowColor.Blue]: 94,
  [TextWindowColor.Green]: 92,
  [TextWindowColor.Cyan]: 96,
  [TextWindowColor.Red]: 91,
  [TextWindowColor.Magenta]: 95,
  [TextWindowColor.Yellow]: 93,
  [TextWindowColor.White]: 97
};

const ANSI_BACKGROUND: Record<TextWindowColor, number> = {
  [TextWindowColor.Black]: 40,
  [TextWindowColor.DarkBlue]: 44,
  [TextWindowColor.DarkGreen]: 42,
  [TextWindowColor.DarkCyan]: 46,
  [TextWindowColor.DarkRed]: 41,
  [TextWindowColor.DarkMagenta]: 45,
  [TextWindowColor.DarkYellow]: 43,
  [TextWindowColor.Gray]: 47,
  [TextWindowColor.DarkGray]: 100,
  [TextWindowColor.Blue]: 104,
  [TextWindowColor.Green]: 102,
  [TextWindowColor.Cyan]: 106,
  [TextWindowColor.Red]: 101,
  [TextWindowColor.Magenta]: 105,
  [TextWindowColor.Yellow]: 103,
  [TextWindowColor.White]: 107
};

class UnsupportedLibraryError extends Error {}

class NodeTextWindowPlugin implements ITextWindowLibraryPlugin {
  private readonly inputBuffer: BaseValue[] = [];
  private readonly pendingLines: string[] = [];
  private readonly lineWaiters: Array<(line: string) => void> = [];
  private readonly isTTY = process.stdout.isTTY === true;
  private readonly inputInterface: readline.Interface;
  private stdinClosed = false;
  private pendingKind: ValueKind | undefined;
  private foreground = TextWindowColor.White;
  private background = TextWindowColor.Black;

  public constructor() {
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

  public inputIsNeeded(kind: ValueKind): void {
    this.pendingKind = kind;
  }

  public checkInputBuffer(): BaseValue | undefined {
    return this.inputBuffer.shift();
  }

  public writeText(value: string, appendNewLine: boolean): void {
    const text = value + (appendNewLine ? "\n" : "");
    process.stdout.write(this.isTTY
      ? `\u001b[${ANSI_FOREGROUND[this.foreground]};${ANSI_BACKGROUND[this.background]}m${text}\u001b[0m`
      : text);
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

  public isWaitingForInput(): boolean {
    return this.pendingKind !== undefined;
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

  public pushInput(raw: string): void {
    if (this.pendingKind === ValueKind.Number) {
      const parsed = Number(raw);
      this.inputBuffer.push(new NumberValue(Number.isFinite(parsed) ? parsed : 0));
    } else {
      this.inputBuffer.push(new StringValue(raw));
    }

    this.pendingKind = undefined;
  }
}

function createUnsupportedPlugin<T>(libraryName: string): T {
  const message = `${libraryName} is not supported by the JavaScript SmallBasic run host yet.`;
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(_target: Record<string | symbol, unknown>, property: string | symbol): unknown {
      if (property === "then") {
        return undefined;
      }

      throw new UnsupportedLibraryError(message);
    }
  }) as unknown as T;
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    await pauseAndExit(1, true);
    return;
  }

  const { filePath, pauseOnExit } = arguments_;
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`SmallBasic source file not found: ${filePath}\n`);
    await pauseAndExit(1, pauseOnExit);
    return;
  }

  let source = fs.readFileSync(filePath, "utf8");
  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
  }

  const compilation = new Compilation(source);
  if (!compilation.isReadyToRun) {
    process.stderr.write(compilation.diagnostics.map((item) => item.toString()).join("\n") + "\n");
    await pauseAndExit(1, pauseOnExit);
    return;
  }

  const engine = new ExecutionEngine(compilation);
  const textWindow = new NodeTextWindowPlugin();
  engine.libraries.TextWindow.plugin = textWindow;
  engine.libraries.GraphicsWindow.plugin = createUnsupportedPlugin<IGraphicsWindowLibraryPlugin>("GraphicsWindow");
  engine.libraries.Shapes.plugin = createUnsupportedPlugin<IShapesLibraryPlugin>("Shapes");

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
            await pauseAndExit(1, pauseOnExit);
          }

          await pauseAndExit(0, pauseOnExit);
          return;
        default:
          throw new Error(`Unexpected execution state: ${ExecutionState[engine.state]}`);
      }
    }
  } catch (error) {
    if (error instanceof UnsupportedLibraryError) {
      process.stderr.write(`${error.message}\n`);
      await pauseAndExit(3, pauseOnExit);
      return;
    }

    process.stderr.write(error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`);
    await pauseAndExit(4, pauseOnExit);
  }
}

void main();
