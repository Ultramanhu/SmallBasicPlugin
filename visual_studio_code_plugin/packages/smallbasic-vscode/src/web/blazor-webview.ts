import * as vscode from "vscode";
import {
  BlazorWebviewHost,
  blazorPayloadEntry,
  javascriptPayloadEntry,
  resolveBlazorPayload,
  resolveJavaScriptPayload,
  type WebviewMessage
} from "./webview-panel";

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
 *
 * Debug sessions use a separate panel and message channel; see
 * `./blazor-debug-broker.ts`. Both flows share the panel/resource plumbing in
 * `./webview-panel.ts`.
 */

const RUN_VIEW_TYPE = "smallbasic.web";
const RUN_TITLE = "Small Basic (Web)";
const OUTPUT_CHANNEL = "SmallBasic (Web)";

export type WebviewBackend = "javascript" | "blazor";

interface HostNotifyMessage {
  type?: string;
  exitCode?: number;
}

export { resolveBlazorPayload };

let panel: BlazorWebviewHost | undefined;
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
    void vscode.window.showErrorMessage(
      `未找到浏览器端 Blazor 载荷：${blazorPayloadEntry(context).toString()}。` +
      "请先执行 runhost\\Build-RunHost.ps1，然后 npm run stage:blazor（或 visual_studio_code_plugin\\build\\Package-Vsix.ps1）把载荷放进扩展目录。"
    );
    return;
  }

  const javascript = await resolveJavaScriptPayload(context);
  if (!javascript) {
    void vscode.window.showErrorMessage(
      `未找到浏览器端 JavaScript 载荷：${javascriptPayloadEntry(context).toString()}。请先执行 npm run build。`
    );
    return;
  }

  const host = ensurePanel(context, root, javascript);
  host.reveal();
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
  panel?.post({ type: "stop" });
}

function ensurePanel(
  context: vscode.ExtensionContext,
  root: vscode.Uri,
  javascript: vscode.Uri
): BlazorWebviewHost {
  if (panel && !panel.isDisposed) {
    return panel;
  }

  output ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  const host = new BlazorWebviewHost(context, {
    viewType: RUN_VIEW_TYPE,
    title: RUN_TITLE,
    payloadRoot: root,
    javascriptUri: javascript,
    log: (line) => output?.appendLine(line)
  });

  host.onMessage((message) => handleRunMessage(message));
  host.onDispose(() => {
    panel = undefined;
    pageReady = false;
    pendingRun = undefined;
  });

  panel = host;
  output.appendLine("[webview] browser runtime requested");
  return host;
}

function handleRunMessage(message: WebviewMessage): void {
  switch (message.type) {
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
  panel.post({
    type: "run",
    backend: run.backend,
    name: run.name,
    source: run.source
  });
}
