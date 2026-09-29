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

/**
 * Browser (no server, no Node.js) run host for SmallBasic programs.
 *
 * This is the JavaScript backend of `runhost/web`: `web.ts` is bundled by tsup
 * into a single classic script that exposes `globalThis.SmallBasicWeb`, and the
 * shell page (wwwroot/shell.js) drives it. It mirrors the Node.js run host
 * (`main.ts`) - same exit codes, same TextWindow plugin contract - but text I/O
 * is routed to the page and to the browser console through {@link IWebRunHostBridge},
 * and GraphicsWindow/Shapes/Turtle are rejected because the Blazor WebAssembly
 * backend owns graphics.
 */

/** Exit codes shared with the Node.js run host. */
export const EXIT_SUCCESS = 0;
export const EXIT_COMPILE_ERROR = 1;
export const EXIT_UNSUPPORTED_LIBRARY = 3;
export const EXIT_RUNTIME_ERROR = 4;

export type InputKind = "string" | "number";

export interface IWebRunHostBridge {
  /** TextWindow.Write / WriteLine, with the active TextWindow colors. */
  writeText(text: string, appendNewLine: boolean, foreground: TextWindowColor, background: TextWindowColor): void;

  /** TextWindow.Read / ReadNumber; resolves with the line the user typed. */
  readInput(kind: InputKind): Promise<string>;

  /** Compiler diagnostics and runtime failures. */
  writeError(text: string): void;
}

class UnsupportedLibraryError extends Error {}

class WebTextWindowPlugin implements ITextWindowLibraryPlugin {
  private readonly inputBuffer: BaseValue[] = [];
  private readonly bridge: IWebRunHostBridge;
  private pendingKind: ValueKind | undefined;
  private pendingRead: ((line: string) => void) | undefined;
  private foreground = TextWindowColor.White;
  private background = TextWindowColor.Black;

  public constructor(bridge: IWebRunHostBridge) {
    this.bridge = bridge;
  }

  public inputIsNeeded(kind: ValueKind): void {
    this.pendingKind = kind;
  }

  public checkInputBuffer(): BaseValue | undefined {
    return this.inputBuffer.shift();
  }

  public writeText(value: string, appendNewLine: boolean): void {
    this.bridge.writeText(value, appendNewLine, this.foreground, this.background);
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
    const kind: InputKind = this.pendingKind === ValueKind.Number ? "number" : "string";
    return new Promise<string>((resolve) => {
      let settled = false;
      const finish = (line: string): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.pendingRead = undefined;
        resolve(line);
      };

      this.pendingRead = finish;
      void this.bridge.readInput(kind).then(finish, () => finish(""));
    });
  }

  /** Releases a pending Read/ReadNumber so that a stopped program can unwind. */
  public cancelPendingInput(): void {
    const pending = this.pendingRead;
    if (pending) {
      pending("");
    }
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
  const message = `${libraryName} 由 Blazor WASM 后端提供，JavaScript 后端只支持 TextWindow，请切换到 Blazor 后端。`;
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(_target: Record<string | symbol, unknown>, property: string | symbol): unknown {
      if (property === "then") {
        return undefined;
      }

      throw new UnsupportedLibraryError(message);
    }
  }) as unknown as T;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

let activeEngine: ExecutionEngine | undefined;
let activePlugin: WebTextWindowPlugin | undefined;
let stopRequested = false;

/**
 * Compiles and runs `source` to completion, requesting input through `bridge`.
 * Returns the exit code of the run.
 */
export async function runJavaScript(source: string, bridge: IWebRunHostBridge): Promise<number> {
  const compilation = new Compilation(source);
  if (!compilation.isReadyToRun) {
    bridge.writeError(compilation.diagnostics.map((item) => item.toString()).join("\n"));
    return EXIT_COMPILE_ERROR;
  }

  if (compilation.kind.drawsShapes()) {
    bridge.writeError("该程序使用了 GraphicsWindow / Shapes / Turtle，JavaScript 后端只支持 TextWindow。\n请把 Backend 切换为 \"Blazor WASM (GraphicsWindow)\" 后重新运行。");
    return EXIT_UNSUPPORTED_LIBRARY;
  }

  const engine = new ExecutionEngine(compilation);
  const plugin = new WebTextWindowPlugin(bridge);
  engine.libraries.TextWindow.plugin = plugin;
  engine.libraries.GraphicsWindow.plugin = createUnsupportedPlugin<IGraphicsWindowLibraryPlugin>("GraphicsWindow");
  engine.libraries.Shapes.plugin = createUnsupportedPlugin<IShapesLibraryPlugin>("Shapes");

  activeEngine = engine;
  activePlugin = plugin;
  stopRequested = false;

  try {
    while (true) {
      engine.execute(ExecutionMode.RunToEnd);
      if (stopRequested) {
        engine.terminate();
      }

      switch (engine.state) {
        case ExecutionState.Running:
          // Defensive: the engine only returns when it paused, blocked or terminated.
          await sleep(10);
          break;
        case ExecutionState.BlockedOnInput:
          if (stopRequested) {
            engine.terminate();
            break;
          }

          if (plugin.isWaitingForInput()) {
            plugin.pushInput(await plugin.readLine());
            if (stopRequested) {
              engine.terminate();
              break;
            }

            engine.state = ExecutionState.Running;
          } else {
            // Program.Delay blocks the engine and resumes it from its own timer,
            // so wait for that instead of re-entering the engine (which would
            // re-run the delay instruction and consume an empty stack).
            while (engine.state === ExecutionState.BlockedOnInput && !stopRequested) {
              await sleep(10);
            }

            if (stopRequested) {
              engine.terminate();
            }
          }

          break;
        case ExecutionState.Paused:
          engine.state = ExecutionState.Running;
          break;
        case ExecutionState.Terminated:
          if (engine.exception) {
            bridge.writeError(`[Runtime Error] ${engine.exception.toString()}`);
            return EXIT_RUNTIME_ERROR;
          }

          return EXIT_SUCCESS;
        default:
          throw new Error(`Unexpected execution state: ${ExecutionState[engine.state]}`);
      }
    }
  } catch (error) {
    if (error instanceof UnsupportedLibraryError) {
      bridge.writeError(error.message);
      return EXIT_UNSUPPORTED_LIBRARY;
    }

    bridge.writeError(describe(error));
    return EXIT_RUNTIME_ERROR;
  } finally {
    activeEngine = undefined;
    activePlugin = undefined;
    stopRequested = false;
  }
}

/** Stops the run started by the most recent {@link runJavaScript} call. */
export function stopJavaScript(): void {
  stopRequested = true;
  activePlugin?.cancelPendingInput();
  activeEngine?.terminate();
}

interface ISmallBasicWebHost {
  runJavaScript: typeof runJavaScript;
  stopJavaScript: typeof stopJavaScript;
}

(globalThis as unknown as { SmallBasicWeb?: ISmallBasicWebHost }).SmallBasicWeb = {
  runJavaScript,
  stopJavaScript
};
