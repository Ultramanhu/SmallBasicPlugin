/**
 * Routing for the run/debug requests that reach the web entry
 * (`src/web/extension.ts`, VS Code for the Web and vscode.dev).
 *
 * The web host has two backends with different capabilities:
 *
 *   - `javascript` runs *and* debugs inside the web extension host;
 *   - `blazor` runs inside a webview (the same SmallBasic.Blazor.Client
 *     WebAssembly build the desktop RunHost serves, see ./blazor-webview.ts) but
 *     cannot be stepped, so only "Run Without Debugging" - Ctrl+F5, which VS Code
 *     marks with `noDebug: true` on the resolved configuration - can be honoured.
 *
 * Programs that draw (GraphicsWindow/Shapes/Turtle) can *only* run on the Blazor
 * backend, so a request without an explicit backend is resolved by analysing the
 * program. The table lives here - free of the `vscode` module - so that it can be
 * unit-tested; the provider keeps only the I/O around it.
 */

export type WebBackend = "javascript" | "csharp" | "blazor";

export interface WebDebugRequest {
  /** Backend from the launch configuration; `undefined` when the user picked none. */
  backend?: unknown;
  /** True for "Run Without Debugging" requests. */
  noDebug?: boolean;
}

export type WebDebugRouting =
  /** Let the built-in JavaScript run/debug adapter handle the request. */
  | { kind: "javascript" }
  /** Run the program in the browser webview; no debug session is started. */
  | { kind: "webview"; backend: "javascript" | "blazor"; note?: string }
  /** Refuse the request with an explanation of what to use instead. */
  | { kind: "reject"; message: string };

const RUN_WITH_BLAZOR = "“SmallBasic: Run with Blazor Backend”";

const C_SHARP_MESSAGE =
  "Web 模式无法启动本机 C# RunHost：请用 JavaScript 后端运行 TextWindow 程序，" +
  `图形程序请按 Ctrl+F5（运行但不调试）或执行 ${RUN_WITH_BLAZOR}。`;

const BLAZOR_DEBUG_MESSAGE =
  "Web 模式不支持 Blazor 后端的逐行调试。" +
  `请按 Ctrl+F5（运行但不调试）或执行 ${RUN_WITH_BLAZOR}，两者都在 Webview 内运行同一份 Blazor WASM 后端。`;

const GRAPHICS_DEBUG_MESSAGE =
  "图形程序（GraphicsWindow/Shapes/Turtle）在 Web 上由 Blazor 后端运行，而该后端不支持逐行调试。" +
  `请按 Ctrl+F5（运行但不调试）或执行 ${RUN_WITH_BLAZOR}。`;

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
      kind: "webview",
      backend: selectedBackend,
      // The user explicitly asked for JavaScript, which cannot run this program
      // at all, so explain the substitution instead of silently changing backends.
      note: backend === "javascript" && programDrawsShapes ? GRAPHICS_FALLBACK_NOTE : undefined
    };
  }

  // JavaScript remains debuggable in the web extension host. A webview is an
  // execution surface rather than a DAP client, so F5 keeps using the adapter.
  if (selectedBackend === "javascript") {
    return { kind: "javascript" };
  }

  return {
    kind: "reject",
    message: backend === "blazor" && !programDrawsShapes ? BLAZOR_DEBUG_MESSAGE : GRAPHICS_DEBUG_MESSAGE
  };
}

function normalizeBackend(value: unknown): WebBackend | undefined {
  return value === "javascript" || value === "csharp" || value === "blazor" ? value : undefined;
}
