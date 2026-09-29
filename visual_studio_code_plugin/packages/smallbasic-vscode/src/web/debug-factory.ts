import * as vscode from "vscode";
import { SmallBasicDebugSession } from "../debug/session";
import { isSmallBasicDocument } from "../language/providers";
import { WebDebugSourceAccessor } from "./source-accessor";

export class SmallBasicWebDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  public async createDebugAdapterDescriptor(
    session: vscode.DebugSession
  ): Promise<vscode.DebugAdapterDescriptor | undefined> {
    if (session.configuration.backend === "csharp" || session.configuration.backend === "blazor") {
      // Ctrl+F5 already runs the Blazor backend in a webview from the configuration
      // provider, so reaching this point means a debug session was requested for a
      // backend that cannot be stepped in the browser.
      void vscode.window.showErrorMessage(
        "VS Code for the Web 目前只支持 JavaScript 后端的逐行调试。" +
        "图形程序请按 Ctrl+F5（运行但不调试）或执行 “SmallBasic: Run with Blazor Backend”。"
      );
      return undefined;
    }

    const configuredProgram = typeof session.configuration.program === "string"
      ? session.configuration.program
      : "";
    const document = await this.findDocument(configuredProgram);
    if (!document || !isSmallBasicDocument(document)) {
      void vscode.window.showErrorMessage("无法打开要调试的 SmallBasic 文件。请先在编辑器中打开并保存该文件。");
      return undefined;
    }

    const adapter = new SmallBasicDebugSession(new WebDebugSourceAccessor(document, configuredProgram));
    return new vscode.DebugAdapterInlineImplementation(adapter);
  }

  private async findDocument(configuredProgram: string): Promise<vscode.TextDocument | undefined> {
    const normalize = (value: string): string => value.replace(/\\/g, "/").toLowerCase();
    const wanted = normalize(configuredProgram);
    const open = vscode.workspace.textDocuments.find((document) => [
      document.fileName,
      document.uri.fsPath,
      document.uri.path,
      document.uri.toString()
    ].some((value) => normalize(value) === wanted));
    if (open) {
      return open;
    }

    const active = vscode.window.activeTextEditor?.document;
    if (active && isSmallBasicDocument(active)) {
      return active;
    }

    if (configuredProgram.includes(":")) {
      try {
        return await vscode.workspace.openTextDocument(vscode.Uri.parse(configuredProgram));
      } catch {
        return undefined;
      }
    }

    return undefined;
  }
}
