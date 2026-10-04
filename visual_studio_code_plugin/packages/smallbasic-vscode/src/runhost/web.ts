import {
  Compilation,
  ExecutionEngine,
  ExecutionMode,
  ExecutionState,
  IGraphicsWindowLibraryPlugin,
  IShapesLibraryPlugin,
  TextWindowColor,
  ValueKind
} from "smallbasic-lang-core";
import { sleep } from "../common/async";
import { createUnsupportedPlugin, describeError, UnsupportedLibraryError } from "../common/errors";
import { BufferedTextWindowPlugin } from "../common/text-window";
import { BrowserDebugSession, type DebugEventSink } from "./web-debug";
import { EXIT_COMPILE_ERROR, EXIT_RUNTIME_ERROR, EXIT_SUCCESS, EXIT_UNSUPPORTED_LIBRARY } from "./exit-codes";

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

/** Exit codes shared with the Node.js run host (`./exit-codes`). */
export { EXIT_COMPILE_ERROR, EXIT_RUNTIME_ERROR, EXIT_SUCCESS, EXIT_UNSUPPORTED_LIBRARY };

export type InputKind = "string" | "number";

export interface IWebRunHostBridge {
  /** TextWindow.Write / WriteLine, with the active TextWindow colors. */
  writeText(text: string, appendNewLine: boolean, foreground: TextWindowColor, background: TextWindowColor): void;

  /** TextWindow.Read / ReadNumber; resolves with the line the user typed. */
  readInput(kind: InputKind): Promise<string>;

  /** Compiler diagnostics and runtime failures. */
  writeError(text: string): void;
}

class WebTextWindowPlugin extends BufferedTextWindowPlugin {
  private readonly bridge: IWebRunHostBridge;
  private pendingRead: ((line: string) => void) | undefined;

  public constructor(bridge: IWebRunHostBridge) {
    super();
    this.bridge = bridge;
  }

  public writeText(value: string, appendNewLine: boolean): void {
    this.bridge.writeText(value, appendNewLine, this.getForegroundColor(), this.getBackgroundColor());
  }

  public readLine(): Promise<string> {
    const kind: InputKind = this.pendingInputKind === ValueKind.Number ? "number" : "string";
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
  engine.libraries.GraphicsWindow.plugin = createUnsupportedPlugin<IGraphicsWindowLibraryPlugin>(
    "GraphicsWindow 由 Blazor WASM 后端提供，JavaScript 后端只支持 TextWindow，请切换到 Blazor 后端。"
  );
  engine.libraries.Shapes.plugin = createUnsupportedPlugin<IShapesLibraryPlugin>(
    "Shapes 由 Blazor WASM 后端提供，JavaScript 后端只支持 TextWindow，请切换到 Blazor 后端。"
  );

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

    bridge.writeError(describeError(error, true));
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

/* ------------------------------------------------------- web mode debugging */

/**
 * Runtime events and TextWindow output go through the page's
 * `SmallBasicWebHost`, the exact same channel the Blazor backend uses
 * (`WebShellTransport`), so the webview treats both backends identically.
 */
interface IWebHostBridge {
  write?: (text: string) => void;
  notify?: (json: string) => void;
}

function webHostBridge(): IWebHostBridge | undefined {
  return (globalThis as unknown as { SmallBasicWebHost?: IWebHostBridge }).SmallBasicWebHost;
}

const debugSink: DebugEventSink = {
  notify: (json) => webHostBridge()?.notify?.(json),
  write: (text) => webHostBridge()?.write?.(text)
};

let activeDebugSession: BrowserDebugSession | undefined;

/** Called by the webview with the `debug-launch` payload of a session. */
export function debugStart(json: string): void {
  activeDebugSession?.stop();
  activeDebugSession = new BrowserDebugSession(debugSink);
  activeDebugSession.start(json);
}

/** Called by the webview with one wire command of the active session. */
export function debugCommand(json: string): void {
  activeDebugSession?.dispatch(json);
}

/** Called when the panel is torn down without an explicit protocol `stop`. */
export function debugStop(): void {
  activeDebugSession?.stop();
  activeDebugSession = undefined;
}

interface ISmallBasicWebHost {
  runJavaScript: typeof runJavaScript;
  stopJavaScript: typeof stopJavaScript;
  debugStart: typeof debugStart;
  debugCommand: typeof debugCommand;
  debugStop: typeof debugStop;
}

(globalThis as unknown as { SmallBasicWeb?: ISmallBasicWebHost }).SmallBasicWeb = {
  runJavaScript,
  stopJavaScript,
  debugStart,
  debugCommand,
  debugStop
};
