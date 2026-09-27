import * as vscode from "vscode";
import { activateCommon } from "../common/activation";
import { isSmallBasicDocument } from "../language/providers";
import { SmallBasicWebDebugAdapterFactory } from "./debug-factory";

export function activate(context: vscode.ExtensionContext): void {
  activateCommon(context, {
    debugAdapterFactory: new SmallBasicWebDebugAdapterFactory(),
    debugConfigurationProvider: createWebDebugConfigurationProvider()
  });
}

export function deactivate(): void {
  // no-op
}

function createWebDebugConfigurationProvider(): vscode.DebugConfigurationProvider {
  const activeDocument = (): vscode.TextDocument | undefined => {
    const document = vscode.window.activeTextEditor?.document;
    return document && isSmallBasicDocument(document) ? document : undefined;
  };

  const createConfig = (document: vscode.TextDocument): vscode.DebugConfiguration => ({
    type: "smallbasic",
    request: "launch",
    name: "SmallBasic: Debug current file with JavaScript backend",
    program: document.fileName || document.uri.toString(),
    backend: "javascript",
    stopOnEntry: true
  });

  return {
    resolveDebugConfiguration(_folder, config) {
      if (config.backend === "csharp" || config.backend === "blazor") {
        void vscode.window.showErrorMessage("VS Code for the Web 仅支持 JavaScript 后端；Blazor RunHost 需要桌面扩展启动本机进程。");
        return undefined;
      }

      if (config.type === "smallbasic" && typeof config.program === "string") {
        config.backend = "javascript";
        return config;
      }

      const document = activeDocument();
      return document ? createConfig(document) : undefined;
    },
    resolveDebugConfigurationWithSubstitutedVariables(_folder, config) {
      if (config.backend === "csharp" || config.backend === "blazor") {
        void vscode.window.showErrorMessage("VS Code for the Web 仅支持 JavaScript 后端；Blazor RunHost 需要桌面扩展启动本机进程。");
        return undefined;
      }

      const document = activeDocument();
      if (!document) {
        void vscode.window.showErrorMessage("请先打开一个 SmallBasic (.sb) 文件后再启动调试。");
        return undefined;
      }

      config.type = "smallbasic";
      config.request = "launch";
      config.backend = "javascript";
      config.program = typeof config.program === "string" && config.program.trim()
        ? config.program
        : document.fileName || document.uri.toString();
      return config;
    }
  };
}
