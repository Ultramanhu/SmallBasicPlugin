import * as vscode from "vscode";
import { buildWebviewHtml } from "./webview-html";

/**
 * Runs the JavaScript or Blazor WebAssembly backend inside a webview. The page
 * follows the same two-backend model as runhost/web, so an installed desktop
 * extension and VS Code for the Web share the same browser execution surface.
 *
 * Message protocol (see visual_studio_plugin/src/SmallBasic.Blazor.Client/wwwroot/vscode-webview.js):
 *
 *   host -> page : { type: "run", backend, name, source } | { type: "stop" }
 *                  { type: "resource-response", requestId, ok, data/error }
 *   page -> host : { type: "ready" } | { type: "output", text }
 *                  { type: "notify", json } | { type: "failed", text }
 *                  { type: "resource-request", requestId, path }
 */

const PAYLOAD_SEGMENTS = ["runhost", "blazor", "wwwroot"];
const ENTRY_SEGMENTS = ["_framework", "blazor.webassembly.js"];
const JAVASCRIPT_SEGMENTS = ["dist", "web-runhost.js"];
const OUTPUT_CHANNEL = "SmallBasic (Web)";

export type WebviewBackend = "javascript" | "blazor";

interface WebviewToHostMessage {
  type?: string;
  text?: string;
  json?: string;
  requestId?: string;
  path?: string;
}

interface HostNotifyMessage {
  type?: string;
  exitCode?: number;
}

let panel: vscode.WebviewPanel | undefined;
let output: vscode.OutputChannel | undefined;
let pageReady = false;
let pendingRun: { backend: WebviewBackend; name: string; source: string } | undefined;

/** Runs `source` in the browser webview, reusing an open panel when there is one. */
export async function runInWebview(
  context: vscode.ExtensionContext,
  name: string,
  source: string,
  backend: WebviewBackend
): Promise<void> {
  const root = await resolveBlazorPayload(context);
  if (!root) {
    const expected = vscode.Uri.joinPath(context.extensionUri, ...PAYLOAD_SEGMENTS, ...ENTRY_SEGMENTS);
    void vscode.window.showErrorMessage(
      `未找到浏览器端 Blazor 载荷：${expected.toString()}。` +
      "请先执行 runhost\\Build-RunHost.ps1，然后 npm run stage:blazor（或 visual_studio_code_plugin\\build\\Package-Vsix.ps1）把载荷放进扩展目录。"
    );
    return;
  }

  const javascript = vscode.Uri.joinPath(context.extensionUri, ...JAVASCRIPT_SEGMENTS);
  try {
    await vscode.workspace.fs.stat(javascript);
  } catch {
    void vscode.window.showErrorMessage(
      `未找到浏览器端 JavaScript 载荷：${javascript.toString()}。请先执行 npm run build。`
    );
    return;
  }

  const webviewPanel = ensurePanel(context, root, javascript);
  webviewPanel.reveal(webviewPanel.viewColumn, true);
  output?.appendLine(`[run:${backend}] ${name}`);
  pendingRun = { backend, name, source };
  flushPendingRun();
}

/** Compatibility wrapper for callers that explicitly request Blazor. */
export function runInBlazorWebview(
  context: vscode.ExtensionContext,
  name: string,
  source: string
): Promise<void> {
  return runInWebview(context, name, source, "blazor");
}

/** Stops the program running in the webview, if any. */
export function stopBlazorWebview(): void {
  void panel?.webview.postMessage({ type: "stop" });
}

/** Root folder of the staged Blazor payload, or undefined when it is missing. */
export async function resolveBlazorPayload(context: vscode.ExtensionContext): Promise<vscode.Uri | undefined> {
  const root = vscode.Uri.joinPath(context.extensionUri, ...PAYLOAD_SEGMENTS);
  try {
    // workspace.fs works for extension resources in web extension hosts.
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ...ENTRY_SEGMENTS));
    return root;
  } catch {
    return undefined;
  }
}

function ensurePanel(
  context: vscode.ExtensionContext,
  root: vscode.Uri,
  javascript: vscode.Uri
): vscode.WebviewPanel {
  if (panel) {
    return panel;
  }

  output ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  const webviewPanel = vscode.window.createWebviewPanel(
    "smallbasic.web",
    "Small Basic (Web)",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [root, vscode.Uri.joinPath(context.extensionUri, "dist")],
      // Keeps the WebAssembly runtime (and therefore the graphics scene) alive
      // while the user switches between editors.
      retainContextWhenHidden: true
    }
  );

  webviewPanel.webview.html = buildWebviewHtml({
    cspSource: webviewPanel.webview.cspSource,
    payloadUri: webviewPanel.webview.asWebviewUri(root).toString(),
    javascriptUri: webviewPanel.webview.asWebviewUri(javascript).toString()
  });

  webviewPanel.webview.onDidReceiveMessage(
    (message: WebviewToHostMessage | undefined) => {
      void handleMessage(message, root, webviewPanel.webview);
    },
    undefined,
    context.subscriptions
  );

  webviewPanel.onDidDispose(
    () => {
      panel = undefined;
      pageReady = false;
      pendingRun = undefined;
      output?.appendLine("[webview] closed");
    },
    undefined,
    context.subscriptions
  );

  panel = webviewPanel;
  output.appendLine("[webview] browser runtime requested");
  return webviewPanel;
}

async function handleMessage(
  message: WebviewToHostMessage | undefined,
  root: vscode.Uri,
  webview: vscode.Webview
): Promise<void> {
  switch (message?.type) {
    case "ready":
      pageReady = true;
      flushPendingRun();
      return;
    case "output":
      output?.append(message.text ?? "");
      return;
    case "notify":
      handleNotify(message.json);
      return;
    case "failed":
      output?.appendLine(message.text ?? "[webview] unknown failure");
      output?.show(true);
      void vscode.window.showErrorMessage(
        `Small Basic Web 模式运行失败，详情见输出面板“${OUTPUT_CHANNEL}”。`
      );
      return;
    case "resource-request":
      await providePayloadResource(message, root, webview);
      return;
    default:
      return;
  }
}

/**
 * Reads a Blazor boot resource in the extension host and transfers it to the
 * webview. Marketplace web extensions are served from vscode-unpkg.net, whose
 * binary responses are not CORS-readable by the isolated vscode-cdn.net
 * webview. `workspace.fs` is the supported extension-resource channel and does
 * not depend on the marketplace CDN granting the webview cross-origin access.
 */
async function providePayloadResource(
  message: WebviewToHostMessage,
  root: vscode.Uri,
  webview: vscode.Webview
): Promise<void> {
  const requestId = message.requestId;
  if (typeof requestId !== "string" || requestId.length === 0) {
    return;
  }

  try {
    const resource = resolvePayloadResource(root, message.path);
    if (!resource) {
      throw new Error(`非法的 Blazor 资源路径：${String(message.path ?? "")}`);
    }

    const bytes = await vscode.workspace.fs.readFile(resource);
    // VS Code >= 1.57 transfers nested ArrayBuffers efficiently. Slice to the
    // exact view because a Uint8Array is allowed to share a larger backing store.
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await webview.postMessage({ type: "resource-response", requestId, ok: true, data });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    output?.appendLine(`[resource] ${message.path ?? "<missing>"}: ${text}`);
    await webview.postMessage({ type: "resource-response", requestId, ok: false, error: text });
  }
}

/** Keeps webview resource requests inside runhost/blazor/wwwroot. */
function resolvePayloadResource(root: vscode.Uri, requestedPath: string | undefined): vscode.Uri | undefined {
  if (typeof requestedPath !== "string" || requestedPath.length === 0 || requestedPath.length > 512) {
    return undefined;
  }

  if (requestedPath.includes("\\") || requestedPath.startsWith("/")) {
    return undefined;
  }

  const segments = requestedPath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }

  return vscode.Uri.joinPath(root, ...segments);
}

function handleNotify(json: string | undefined): void {
  if (!json) {
    return;
  }

  let notify: HostNotifyMessage;
  try {
    notify = JSON.parse(json) as HostNotifyMessage;
  } catch {
    return;
  }

  if (notify.type === "ready") {
    output?.appendLine("[state] running");
    return;
  }

  if (notify.type === "terminated") {
    const exitCode = notify.exitCode ?? 0;
    output?.appendLine(exitCode === 0 ? "[state] completed" : `[state] exited with code ${exitCode}`);
    vscode.window.setStatusBarMessage(
      exitCode === 0 ? "Small Basic: 运行完成" : `Small Basic: 退出码 ${exitCode}`,
      5000
    );
  }
}

function flushPendingRun(): void {
  if (!panel || !pageReady || !pendingRun) {
    return;
  }

  const run = pendingRun;
  pendingRun = undefined;
  void panel.webview.postMessage({
    type: "run",
    backend: run.backend,
    name: run.name,
    source: run.source
  });
}
