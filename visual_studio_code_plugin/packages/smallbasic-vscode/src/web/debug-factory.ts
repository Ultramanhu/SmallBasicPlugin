import * as vscode from "vscode";
import { resolveDebugDocument } from "../common/documents";
import { SmallBasicDebugSession } from "../debug/session";
import { createWebInlineAdapter } from "./inline-factory";
import { normalizeLaunchMode } from "./run-routing";
import { WebDebugSourceAccessor } from "./source-accessor";

/**
 * Registers the inline DAP adapters of the Web extension host.
 *
 * `mode: "web"` delegates to `./inline-factory.ts` (the shared webview adapter
 * used by the desktop host too); `mode: "cli"` keeps the JavaScript engine in
 * the extension host, which is what `SmallBasicDebugSession` was built for (see
 * its doc comment) and needs no webview at all.
 */
export class SmallBasicWebDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public createDebugAdapterDescriptor(
    session: vscode.DebugSession
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return createWebHostDebugAdapter(this.context, session);
  }
}

/**
 * Picks the adapter for a Web-host launch. `mode` defaults to `web` here, the
 * same rule `routeWebHostLaunch` applies to the launch configuration, so the
 * provider's decision and this factory can never disagree.
 */
export async function createWebHostDebugAdapter(
  context: vscode.ExtensionContext,
  session: vscode.DebugSession
): Promise<vscode.DebugAdapterDescriptor | undefined> {
  return normalizeLaunchMode(session.configuration.mode) === "cli"
    ? createExtensionHostJavaScriptAdapter(session)
    : createWebInlineAdapter(context, session);
}

/**
 * CLI JavaScript in the browser: the engine runs in the extension host (the Web
 * Worker) and reports through DAP, so output lands in the Debug Console exactly
 * as it does for the desktop CLI backend's external Node adapter. Only the
 * JavaScript backend qualifies - C# and Blazor need a local RunHost process.
 */
async function createExtensionHostJavaScriptAdapter(
  session: vscode.DebugSession
): Promise<vscode.DebugAdapterDescriptor | undefined> {
  if (session.configuration.backend !== "javascript") {
    void vscode.window.showErrorMessage(
      "CLI 模式在 VS Code for the Web 中只支持 JavaScript 后端：C# 与 Blazor 需要本机 RunHost 进程。" +
      "图形程序请把 launch.json 改为 mode: \"web\" + backend: \"blazor\"。"
    );
    return undefined;
  }

  const program = typeof session.configuration.program === "string" ? session.configuration.program : "";
  const document = await resolveDebugDocument(program);
  if (!document) {
    void vscode.window.showErrorMessage("无法打开要调试的 SmallBasic 文件。请先在编辑器中打开并保存该文件。");
    return undefined;
  }

  const sources = new WebDebugSourceAccessor(document, program);
  return new vscode.DebugAdapterInlineImplementation(new SmallBasicDebugSession(sources));
}
