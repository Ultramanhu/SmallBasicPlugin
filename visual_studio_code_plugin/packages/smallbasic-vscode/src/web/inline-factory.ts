import * as vscode from "vscode";
import { documentBaseName, resolveDebugDocument } from "../common/documents";
import { WebDebugSessionBroker } from "./debug-broker";
import { WebDebugSourceAccessor } from "./source-accessor";
import { BlazorWebviewHost, blazorPayloadEntry, resolveBlazorPayload, resolveJavaScriptPayload } from "./webview-panel";
import { WebviewDebugSession, type WebviewDebugBackend } from "./webview-debug-adapter";

/**
 * Creates the inline DAP adapter for a `mode: "web"` launch, shared by the
 * desktop extension (`src/extension.ts`) and the Web extension
 * (`src/web/extension.ts`).
 *
 * Both backends run in the webview, which is what makes their experience the
 * same: the panel shows the program (TextWindow text or the SVG graphics scene)
 * while VS Code's debug UI drives it through `WebDebugSessionBroker` and the web
 * debug protocol. Only where the engine runs differs - the JavaScript runtime in
 * the page itself, Blazor WebAssembly in the page's WASM runtime - and that is
 * invisible to the user.
 *
 * `mode: "cli"` never reaches this file; each CLI backend keeps its own host
 * (external Node DAP adapter, C# RunHost, Blazor RunHost).
 */

const DEBUG_VIEW_TYPE = "smallbasic.web.debug";
const DEBUG_TITLE = "Small Basic (Web Debug)";
const DEBUG_OUTPUT_CHANNEL = "SmallBasic (Web Debug)";

/** Creates the inline adapter for a web-mode debug session, or undefined on error. */
export async function createWebInlineAdapter(
  context: vscode.ExtensionContext,
  session: vscode.DebugSession
): Promise<vscode.DebugAdapterDescriptor | undefined> {
  const backend = session.configuration.backend;
  if (backend === "csharp") {
    void vscode.window.showErrorMessage(
      "Web 模式无法启动本机 C# RunHost：TextWindow 程序请用 JavaScript 后端，图形程序请用 Blazor 后端（两者都在 Webview 内运行）。"
    );
    return undefined;
  }

  const normalized: WebviewDebugBackend = backend === "javascript" ? "javascript" : "blazor";
  const configuredProgram = typeof session.configuration.program === "string" ? session.configuration.program : "";
  const document = await resolveDebugDocument(configuredProgram);
  if (!document) {
    void vscode.window.showErrorMessage("无法打开要调试的 SmallBasic 文件。请先在编辑器中打开并保存该文件。");
    return undefined;
  }

  const sources = new WebDebugSourceAccessor(document, configuredProgram);

  // The webview document loads the Blazor payload (styles + WASM framework) and
  // the bundled JavaScript backend, whichever engine the session ends up using.
  const root = await resolveBlazorPayload(context);
  if (!root) {
    void vscode.window.showErrorMessage(
      `未找到浏览器端 Blazor 载荷：${blazorPayloadEntry(context).toString()}。` +
      "请先执行 runhost\\Build-RunHost.ps1，然后 npm run stage:blazor（或 visual_studio_plugin\\build\\Package-Vsix.ps1）把载荷放进扩展目录。"
    );
    return undefined;
  }

  const javascript = await resolveJavaScriptPayload(context);
  if (!javascript) {
    void vscode.window.showErrorMessage("未找到浏览器端 JavaScript 载荷（dist/web-runhost.js）。请先执行 npm run build。");
    return undefined;
  }

  const output = vscode.window.createOutputChannel(DEBUG_OUTPUT_CHANNEL);
  const host = new BlazorWebviewHost(context, {
    viewType: DEBUG_VIEW_TYPE,
    title: DEBUG_TITLE,
    payloadRoot: root,
    javascriptUri: javascript,
    log: (line) => output.appendLine(line)
  });

  const broker = new WebDebugSessionBroker(
    `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    host
  );
  host.onDispose(() => broker.dispose());

  // The webview has to boot before the first breakpoint can be validated, so it
  // is launched here (before `initialize`) instead of blocking `launch`.
  void broker.launch({
    backend: normalized,
    name: documentBaseName(document),
    source: document.getText(),
    stopOnEntry: session.configuration.stopOnEntry === true
  }).catch((error: unknown) => output.appendLine(`[launch] ${error instanceof Error ? error.message : String(error)}`));

  const adapter = new WebviewDebugSession(broker, sources, {
    backend: normalized,
    close: () => {
      host.dispose();
      output.dispose();
    }
  });
  return new vscode.DebugAdapterInlineImplementation(adapter);
}
