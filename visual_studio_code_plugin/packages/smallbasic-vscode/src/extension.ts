import * as vscode from "vscode";
import { Compilation } from "smallbasic-lang-core";
import { activateCommon } from "./common/activation";
import { selectDefaultDebugBackend } from "./debug/backend-selection";
import { SmallBasicDebugAdapterFactory } from "./debug/factory";
import { isSmallBasicDocument } from "./language/providers";
import { CSharpRunner } from "./run/csharp-runner";
import { BlazorRunner } from "./run/blazor-runner";
import { runJavaScriptCompilation } from "./run/javascript-runner";
import { runInWebview } from "./web/blazor-webview";
import { routeWebDebugRequest } from "./web/run-routing";

export function activate(context: vscode.ExtensionContext): void {
  activateCommon(context, {
    debugAdapterFactory: new SmallBasicDebugAdapterFactory(context),
    debugConfigurationProvider: createDebugConfigurationProvider(context),
    runCSharp: async () => CSharpRunner.runActiveDocument(context.extensionPath),
    runBlazor: async () => BlazorRunner.runActiveDocument(context.extensionPath)
  });
}

export function deactivate(): void {
  // no-op
}

function createDebugConfigurationProvider(context: vscode.ExtensionContext): vscode.DebugConfigurationProvider {
  const extensionPath = context.extensionPath;
  const preferredBackend = (): "javascript" | "csharp" | "blazor" =>
    selectDefaultDebugBackend(
      process.platform,
      CSharpRunner.resolveHostCommand(extensionPath) !== undefined
    );

  const baseConfig = (
    program: string,
    backend: "javascript" | "csharp" | "blazor" = preferredBackend()
  ): vscode.DebugConfiguration => ({
    type: "smallbasic",
    request: "launch",
    name: backend === "csharp"
      ? "SmallBasic: Debug current file with C# backend"
      : backend === "blazor"
        ? "SmallBasic: Debug current file with Blazor backend"
        : "SmallBasic: Debug current file with JavaScript backend",
    program,
    backend,
    mode: "cli",
    stopOnEntry: true
  });

  const activeSmallBasicPath = (): string | undefined => {
    const editor = vscode.window.activeTextEditor;
    return editor && isSmallBasicDocument(editor.document) ? editor.document.uri.fsPath : undefined;
  };

  return {
    resolveDebugConfiguration(_folder, config) {
      if (config.type === "smallbasic" && typeof config.program === "string") {
        if (config.backend !== "csharp" && config.backend !== "javascript" && config.backend !== "blazor") {
          config.backend = preferredBackend();
        }
        if (config.mode !== "web" && config.mode !== "cli") {
          config.mode = "cli";
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

      if (config.backend !== "csharp" && config.backend !== "javascript" && config.backend !== "blazor") {
        config.backend = preferredBackend();
      }
      if (config.mode !== "web" && config.mode !== "cli") {
        config.mode = "cli";
      }

      let program = typeof config.program === "string" ? config.program.trim() : "";
      if (!program) {
        program = activeSmallBasicPath() ?? "";
      }

      if (!program) {
        void vscode.window.showErrorMessage("调试配置缺少有效的 program 路径。请打开一个 .sb 文件后再启动调试。");
        return undefined;
      }

      if (config.mode === "web") {
        const document = await openProgram(program);
        const drawsShapes = document ? analyze(document) : false;
        const routing = routeWebDebugRequest(
          { backend: config.backend, noDebug: config.noDebug === true },
          drawsShapes
        );

        if (routing.kind === "reject") {
          void vscode.window.showErrorMessage(routing.message);
          return undefined;
        }

        if (routing.kind === "webview") {
          if (!document) {
            void vscode.window.showErrorMessage("无法打开要运行的 SmallBasic 文件。请检查 launch.json 中的 program。");
            return undefined;
          }

          if (routing.note) {
            void vscode.window.setStatusBarMessage(routing.note, 8000);
          }

          await runInWebview(
            context,
            documentName(document),
            document.getText(),
            routing.backend
          );
          return undefined;
        }

        config.backend = "javascript";
        config.program = program;
        return config;
      }

      if (config.backend === "javascript" && config.noDebug === true) {
        const document = await openProgram(program);
        if (!document) {
          void vscode.window.showErrorMessage("无法打开要运行的 SmallBasic 文件。请检查 launch.json 中的 program。");
          return undefined;
        }

        if (!document.isUntitled && document.isDirty && !(await document.save())) {
          void vscode.window.showWarningMessage("运行前需要先保存当前文件。");
          return undefined;
        }

        runJavaScriptCompilation(document, new Compilation(document.getText()));
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

      if (config.backend === "blazor") {
        if (config.noDebug === true) {
          await BlazorRunner.runProgram(program, extensionPath);
          return undefined;
        }

        if (!BlazorRunner.resolveHostCommand(extensionPath)) {
          void vscode.window.showErrorMessage(
            "未找到 Small Basic Blazor RunHost。请安装 .NET 8 / ASP.NET Core 8 Runtime、重新安装完整扩展，" +
            "或在 smallbasic.blazor.runHostPath 中指定宿主路径。"
          );
          return undefined;
        }
      }

      config.program = program;
      return config;
    }
  };
}

async function openProgram(program: string): Promise<vscode.TextDocument | undefined> {
  const normalize = (value: string): string => value.replace(/\\/g, "/").toLowerCase();
  const wanted = normalize(program);
  const open = vscode.workspace.textDocuments.find((document) => [
    document.fileName,
    document.uri.fsPath,
    document.uri.path,
    document.uri.toString()
  ].some((value) => normalize(value) === wanted));
  if (open && isSmallBasicDocument(open)) {
    return open;
  }

  try {
    const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(program)
      ? vscode.Uri.parse(program)
      : vscode.Uri.file(program);
    const document = await vscode.workspace.openTextDocument(uri);
    return isSmallBasicDocument(document) ? document : undefined;
  } catch {
    return undefined;
  }
}

function analyze(document: vscode.TextDocument): boolean {
  try {
    const compilation = new Compilation(document.getText());
    return compilation.isReadyToRun && compilation.kind.drawsShapes();
  } catch {
    return false;
  }
}

function documentName(document: vscode.TextDocument): string {
  const segments = document.uri.path.split("/");
  return segments[segments.length - 1] || document.fileName || "program.sb";
}
