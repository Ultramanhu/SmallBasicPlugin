import * as vscode from "vscode";
import { buildWebviewHtml } from "./webview-html";

/**
 * Runs the Blazor WebAssembly backend inside a webview, which is what makes
 * GraphicsWindow/Shapes/Turtle work in VS Code for the Web: the browser loads the
 * very same SmallBasic.Blazor.Client build that the desktop RunHost publishes, so
 * the interpreter and the SVG scene run in the page and no local process, port or
 * WebSocket is involved.
 *
 * Message protocol (see visual_studio_plugin/src/SmallBasic.Blazor.Client/wwwroot/vscode-webview.js):
 *
 *   host -> page : { type: "run", name, source } | { type: "stop" }
 *   page -> host : { type: "ready" } | { type: "output", text }
 *                  { type: "notify", json } | { type: "failed", text }
 */

const PAYLOAD_SEGMENTS = ["runhost", "blazor", "wwwroot"];
const ENTRY_SEGMENTS = ["_framework", "blazor.webassembly.js"];
const OUTPUT_CHANNEL = "SmallBasic (Blazor WebAssembly)";

interface WebviewToHostMessage {
  type?: string;
  text?: string;
  json?: string;
}

interface HostNotifyMessage {
  type?: string;
  exitCode?: number;
}

let panel: vscode.WebviewPanel | undefined;
let output: vscode.OutputChannel | undefined;
let pageReady = false;
let pendingRun: { name: string; source: string } | undefined;

/** Runs `source` in the Blazor webview, reusing an open panel when there is one. */
export async function runInBlazorWebview(
  context: vscode.ExtensionContext,
  name: string,
  source: string
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

  const webviewPanel = ensurePanel(context, root);
  webviewPanel.reveal(webviewPanel.viewColumn, true);
  output?.appendLine(`[run] ${name}`);
  pendingRun = { name, source };
  flushPendingRun();
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

function ensurePanel(context: vscode.ExtensionContext, root: vscode.Uri): vscode.WebviewPanel {
  if (panel) {
    return panel;
  }

  output ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  const webviewPanel = vscode.window.createWebviewPanel(
    "smallbasic.blazor",
    "Small Basic (Blazor WASM)",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [root],
      // Keeps the WebAssembly runtime (and therefore the graphics scene) alive
      // while the user switches between editors.
      retainContextWhenHidden: true
    }
  );

  webviewPanel.webview.html = buildWebviewHtml({
    cspSource: webviewPanel.webview.cspSource,
    payloadUri: webviewPanel.webview.asWebviewUri(root).toString()
  });

  webviewPanel.webview.onDidReceiveMessage(
    (message: WebviewToHostMessage | undefined) => handleMessage(message),
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
  output.appendLine("[webview] Blazor WebAssembly runtime requested");
  return webviewPanel;
}

function handleMessage(message: WebviewToHostMessage | undefined): void {
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
        `Small Basic Blazor WASM 运行失败，详情见输出面板“${OUTPUT_CHANNEL}”。`
      );
      return;
    default:
      return;
  }
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
  void panel.webview.postMessage({ type: "run", name: run.name, source: run.source });
}
