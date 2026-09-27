import * as vscode from "vscode";
import { activateCommon } from "./common/activation";
import { selectDefaultDebugBackend } from "./debug/backend-selection";
import { SmallBasicDebugAdapterFactory } from "./debug/factory";
import { isSmallBasicDocument } from "./language/providers";
import { CSharpRunner } from "./run/csharp-runner";

export function activate(context: vscode.ExtensionContext): void {
  activateCommon(context, {
    debugAdapterFactory: new SmallBasicDebugAdapterFactory(context),
    debugConfigurationProvider: createDebugConfigurationProvider(context.extensionPath),
    runCSharp: async () => CSharpRunner.runActiveDocument(context.extensionPath)
  });
}

export function deactivate(): void {
  // no-op
}

function createDebugConfigurationProvider(extensionPath: string): vscode.DebugConfigurationProvider {
  const preferredBackend = (): "javascript" | "csharp" =>
    selectDefaultDebugBackend(
      process.platform,
      CSharpRunner.resolveHostCommand(extensionPath) !== undefined
    );

  const baseConfig = (
    program: string,
    backend: "javascript" | "csharp" = preferredBackend()
  ): vscode.DebugConfiguration => ({
    type: "smallbasic",
    request: "launch",
    name: backend === "csharp"
      ? "SmallBasic: Debug current file with C# backend"
      : "SmallBasic: Launch current file (JS debugger)",
    program,
    backend,
    stopOnEntry: true
  });

  const activeSmallBasicPath = (): string | undefined => {
    const editor = vscode.window.activeTextEditor;
    return editor && isSmallBasicDocument(editor.document) ? editor.document.uri.fsPath : undefined;
  };

  return {
    resolveDebugConfiguration(_folder, config) {
      if (config.type === "smallbasic" && typeof config.program === "string") {
        if (config.backend !== "csharp" && config.backend !== "javascript") {
          config.backend = preferredBackend();
        }

        return config;
      }

      const program = activeSmallBasicPath();
      return program ? baseConfig(program) : undefined;
    },
    async resolveDebugConfigurationWithSubstitutedVariables(_folder, config) {
      if (config.type !== "smallbasic") {
        return config;
      }

      if (config.backend !== "csharp" && config.backend !== "javascript") {
        config.backend = preferredBackend();
      }

      let program = typeof config.program === "string" ? config.program.trim() : "";
      if (!program) {
        program = activeSmallBasicPath() ?? "";
      }

      if (!program) {
        void vscode.window.showErrorMessage("调试配置缺少有效的 program 路径。请打开一个 .sb 文件后再启动调试。");
        return undefined;
      }

      if (config.backend === "csharp") {
        if (config.noDebug === true) {
          await CSharpRunner.runProgram(program, extensionPath);
          return undefined;
        }

        if (!CSharpRunner.resolveHostCommand(extensionPath)) {
          void vscode.window.showErrorMessage(
            "未找到可用的 SmallBasic C# 运行宿主。请安装 .NET 8、重新安装完整扩展，" +
            "或在 smallbasic.csharp.runHostPath 中指定宿主路径。"
          );
          return undefined;
        }
      }

      config.program = program;
      return config;
    }
  };
}
