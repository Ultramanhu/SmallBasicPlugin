/**
 * Routing for the run/debug requests that reach the browser-compatible launch
 * surfaces.
 *
 * {@link routeWebDebugRequest} covers `mode: "web"` only (shared by the desktop
 * host in `src/extension.ts` and VS Code for the Web in `src/web/extension.ts`);
 * {@link routeWebHostLaunch} adds the `mode: "cli"` surface that a Web extension
 * host can still serve: the JavaScript backend needs no local process, so the
 * engine runs inline in the extension host instead of a webview.
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

/* ------------------------------------------------------- mode: "cli" (Web host) */

/**
 * Execution surface of a launch configuration. In the Web extension host both
 * are available for JavaScript: `cli` keeps the engine in the extension host
 * (same experience as the desktop CLI backend, see `src/debug/session.ts`),
 * `web` runs it in a webview. C# and Blazor keep their `cli` meaning - a local
 * RunHost process - which the browser cannot provide.
 */
export type LaunchMode = "cli" | "web";

export interface WebHostLaunchRequest extends WebDebugRequest {
  /** `mode` from the launch configuration; `undefined` when the user picked none. */
  mode?: unknown;
}

export type WebHostLaunchRouting =
  /** Debug in the extension host: no webview, output in the Debug Console. */
  | { kind: "inline-debug"; surface: "extension-host"; backend: "javascript"; note?: string }
  /** Debug in a webview: the shared adapter of `mode: "web"`. */
  | { kind: "inline-debug"; surface: "webview"; backend: "javascript" | "blazor"; note?: string }
  /** Run the JavaScript backend inline, in a terminal the extension host drives. */
  | { kind: "run-in-extension-host"; backend: "javascript" }
  /** Run in the webview; no debug session is started. */
  | { kind: "run-in-webview"; backend: "javascript" | "blazor"; note?: string }
  /** Refuse the request with an explanation of what to use instead. */
  | { kind: "reject"; message: string };

const CLI_CSHARP_MESSAGE =
  "CLI 模式的 C# 后端需要本机 RunHost 进程，VS Code for the Web 没有本机进程。" +
  "文本程序请改用 JavaScript 后端（CLI 或 Web 模式均可），图形程序请改用 Web 模式的 Blazor 后端。";

const CLI_BLAZOR_NOTE =
  "CLI Blazor 需要本机 RunHost 进程，VS Code for the Web 没有本机进程，已改用 Web 模式在 Webview 内运行。";

/** `mode` defaults to `web` here: the Web host has no local command-line host. */
export function normalizeLaunchMode(value: unknown): LaunchMode {
  return value === "cli" ? "cli" : "web";
}

/**
 * Routing of a launch request for a Web extension host, for both modes.
 *
 * `mode: "cli"` is honoured for the JavaScript backend only, because it is the
 * one backend that needs no local process: F5 debugs it inline in the extension
 * host (the pre-webview VS Code for the Web behaviour, see `src/debug/session.ts`)
 * and Ctrl+F5 runs it in an extension-host terminal. Every other `cli` request
 * keeps the `mode: "web"` result it would have had before this surface existed:
 * C# cannot run in a browser at all (rejected with a clearer message), and
 * Blazor / a graphics program fall back to the webview - the only browser
 * surface that can run them - with a status-bar note that says so.
 *
 * @param programDrawsShapes Whether the program uses GraphicsWindow/Shapes/Turtle
 *   (the caller analyses the source; see `Compilation.kind.drawsShapes()`).
 */
export function routeWebHostLaunch(request: WebHostLaunchRequest, programDrawsShapes: boolean): WebHostLaunchRouting {
  const backend = normalizeBackend(request.backend);

  if (normalizeLaunchMode(request.mode) === "cli") {
    if (backend === "csharp") {
      return { kind: "reject", message: CLI_CSHARP_MESSAGE };
    }

    if (backend === "blazor") {
      return withNote(routeWebDebugRequest(request, programDrawsShapes), CLI_BLAZOR_NOTE);
    }

    if ((backend === "javascript" || backend === undefined) && !programDrawsShapes) {
      return request.noDebug === true
        ? { kind: "run-in-extension-host", backend: "javascript" }
        : { kind: "inline-debug", surface: "extension-host", backend: "javascript" };
    }
  }

  const routing = routeWebDebugRequest(request, programDrawsShapes);
  return routing.kind === "inline-debug"
    ? { kind: "inline-debug", surface: "webview", backend: routing.backend }
    : routing;
}

/** Maps a `mode: "web"` result onto the host routing, adding a fallback note. */
function withNote(routing: WebDebugRouting, note: string): WebHostLaunchRouting {
  switch (routing.kind) {
    case "inline-debug":
      return { kind: "inline-debug", surface: "webview", backend: routing.backend, note };
    case "run-in-webview":
      return { ...routing, note: routing.note ?? note };
    default:
      return routing;
  }
}

function normalizeBackend(value: unknown): WebBackend | undefined {
  return value === "javascript" || value === "csharp" || value === "blazor" ? value : undefined;
}
