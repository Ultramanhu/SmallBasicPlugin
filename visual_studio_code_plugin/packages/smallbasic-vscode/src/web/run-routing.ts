/**
 * Routing for the run/debug requests that reach web mode
 * (`src/web/extension.ts` for VS Code for the Web, and `src/extension.ts` for the
 * desktop host when `mode: "web"` is configured).
 *
 * Web mode has three backends with different capabilities:
 *
 *   - `javascript` runs *and* debugs inside the extension host (Node or Web
 *     Worker); graphics are not available;
 *   - `blazor` runs inside a webview (the same SmallBasic.Blazor.Client
 *     WebAssembly build the desktop RunHost serves, see ./webview-panel.ts) and
 *     debugs through the inline DAP adapter + webview broker, graphics included;
 *   - `csharp` needs a local process and is therefore not available in web mode.
 *
 * `Ctrl+F5` (`noDebug: true`) runs in the webview; `F5` creates a real VS Code
 * debug session. Programs that draw (GraphicsWindow/Shapes/Turtle) can only run
 * on Blazor, so a request without an explicit backend is resolved by analysing
 * the program. The table lives here - free of the `vscode` module - so that it
 * can be unit-tested; the providers keep only the I/O around it.
 */

export type WebBackend = "javascript" | "csharp" | "blazor";

export interface WebDebugRequest {
  /** Backend from the launch configuration; `undefined` when the user picked none. */
  backend?: unknown;
  /** True for "Run Without Debugging" requests. */
  noDebug?: boolean;
}

export type WebDebugRouting =
  /** Run the program in the browser webview; no debug session is started. */
  | { kind: "run-in-webview"; backend: "javascript" | "blazor"; note?: string }
  /** Create an inline DAP session (JavaScript in the extension host, Blazor via the webview). */
  | { kind: "inline-debug"; backend: "javascript" | "blazor" }
  /** Refuse the request with an explanation of what to use instead. */
  | { kind: "reject"; message: string };

const RUN_WITH_BLAZOR = "“SmallBasic: Run with Blazor Backend”";

const C_SHARP_MESSAGE =
  "Web 模式无法启动本机 C# RunHost（VS Code for the Web 没有本机进程，桌面请改用 mode: \"cli\"）。" +
  "TextWindow 程序请用 JavaScript 后端运行，" +
  `图形程序请按 Ctrl+F5（运行但不调试）或执行 ${RUN_WITH_BLAZOR}。`;

const GRAPHICS_DEBUG_MESSAGE =
  "图形程序（GraphicsWindow/Shapes/Turtle）在 Web 上只能由 Blazor 后端运行，" +
  "而你显式选择了 JavaScript 后端。请改用 Blazor 后端，或按 Ctrl+F5（运行但不调试）。";

const GRAPHICS_FALLBACK_NOTE =
  "该程序使用 GraphicsWindow/Shapes/Turtle，JavaScript 后端无法运行，已在 Blazor Webview 中运行。";

/**
 * @param programDrawsShapes Whether the program uses GraphicsWindow/Shapes/Turtle
 *   (the caller analyses the source; see `Compilation.kind.drawsShapes()`).
 */
export function routeWebDebugRequest(request: WebDebugRequest, programDrawsShapes: boolean): WebDebugRouting {
  const backend = normalizeBackend(request.backend);

  if (backend === "csharp") {
    return { kind: "reject", message: C_SHARP_MESSAGE };
  }

  // Only Blazor can draw here, so a program that draws needs it whether the user
  // picked the JavaScript backend or did not pick one at all.
  const selectedBackend = backend === "blazor" || programDrawsShapes ? "blazor" : "javascript";

  if (request.noDebug === true) {
    return {
      kind: "run-in-webview",
      backend: selectedBackend,
      // The user explicitly asked for JavaScript, which cannot run this program
      // at all, so explain the substitution instead of silently changing backends.
      note: backend === "javascript" && programDrawsShapes ? GRAPHICS_FALLBACK_NOTE : undefined
    };
  }

  // F5: an explicit JavaScript request for a graphics program is refused rather
  // than silently changing execution semantics during a debug session.
  if (backend === "javascript" && programDrawsShapes) {
    return { kind: "reject", message: GRAPHICS_DEBUG_MESSAGE };
  }

  return { kind: "inline-debug", backend: selectedBackend };
}

function normalizeBackend(value: unknown): WebBackend | undefined {
  return value === "javascript" || value === "csharp" || value === "blazor" ? value : undefined;
}
