import * as vscode from "vscode";
import { activateCommon } from "../common/activation";
import { analyzeProgramShape, documentBaseName, resolveDebugDocument } from "../common/documents";
import { OPEN_SB_FILE_WARNING } from "../common/messages";
import { isSmallBasicDocument } from "../language/providers";
import { runInWebview, type WebviewBackend } from "./blazor-webview";
import { SmallBasicWebDebugAdapterFactory } from "./debug-factory";
import { routeWebDebugRequest } from "./run-routing";

export function activate(context: vscode.ExtensionContext): void {
  activateCommon(context, {
    debugAdapterFactory: new SmallBasicWebDebugAdapterFactory(context),
    debugConfigurationProvider: createWebDebugConfigurationProvider(context),
    // The Blazor backend runs entirely inside a webview here: the same
    // SmallBasic.Blazor.Client WebAssembly build that the desktop RunHost serves
    // over HTTP, so graphics work without any local process.
    runJavaScript: async () => runWebActiveDocument(context, "javascript"),
    runBlazor: async () => runWebActiveDocument(context, "blazor")
  });
}

export function deactivate(): void {
  // no-op
}

async function runWebActiveDocument(
  context: vscode.ExtensionContext,
  backend: WebviewBackend
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isSmallBasicDocument(editor.document)) {
    void vscode.window.showWarningMessage(OPEN_SB_FILE_WARNING);
    return;
  }

  const document = editor.document;
  if (backend === "blazor") {
    warnWhenJavaScriptWouldDo(document);
  }

  await runInWebview(context, documentBaseName(document), document.getText(), backend);
}

function warnWhenJavaScriptWouldDo(document: vscode.TextDocument): void {
  const shape = analyzeProgramShape(document);
  if (!shape.ready || shape.drawsShapes) {
    return;
  }

  // Not a blocker: the user asked for this backend explicitly.
  void vscode.window.setStatusBarMessage(
    "Small Basic 提示：该程序只使用 TextWindow，JavaScript 后端启动更快。",
    8000
  );
}

/**
 * Resolves the launch configuration of the web entry.
 *
 * Both "Start Debugging" (F5) and "Run Without Debugging" (Ctrl+F5) arrive here,
 * the latter flagged by `noDebug` on the configuration. See `./run-routing.ts`
 * for the full table:
 *
 *   - Ctrl+F5 runs the program in the Blazor webview and ends the request;
 *   - F5 for JavaScript or Blazor returns the configuration so the inline
 *     adapter factory (`./inline-factory.ts`) can start a real debug session;
 *   - `csharp` and an explicit JavaScript request for a graphics program are
 *     refused with a message pointing at the supported alternative.
 */
function createWebDebugConfigurationProvider(context: vscode.ExtensionContext): vscode.DebugConfigurationProvider {
  const activeDocument = (): vscode.TextDocument | undefined => {
    const document = vscode.window.activeTextEditor?.document;
    return document && isSmallBasicDocument(document) ? document : undefined;
  };

  const createConfig = (document: vscode.TextDocument): vscode.DebugConfiguration => {
    const shape = analyzeProgramShape(document);
    const backend = shape.ready && shape.drawsShapes ? "blazor" : "javascript";
    return {
      type: "smallbasic",
      request: "launch",
      name: backend === "blazor"
        ? "SmallBasic: Debug current file with Blazor backend"
        : "SmallBasic: Debug current file with JavaScript backend",
      program: document.fileName || document.uri.toString(),
      backend,
      mode: "web",
      stopOnEntry: true
    };
  };

  return {
    resolveDebugConfiguration(_folder, config) {
      // A launch.json configuration is passed through as-is; the decision needs the
      // substituted variables and `noDebug`, so it happens in the second hook.
      if (config.type === "smallbasic" && typeof config.program === "string") {
        return config;
      }

      const document = activeDocument();
      return document ? createConfig(document) : undefined;
    },
    async resolveDebugConfigurationWithSubstitutedVariables(_folder, config) {
      if (config.type !== "smallbasic") {
        return config;
      }

      // A browser extension host has no local process/terminal host. Treat the
      // launch configuration as web mode even if a shared launch.json says cli.
      config.mode = "web";

      const document = activeDocument();
      const program = (typeof config.program === "string" ? config.program.trim() : "")
        || document?.fileName
        || document?.uri.toString()
        || "";
      if (!program) {
        void vscode.window.showErrorMessage("请先打开一个 SmallBasic (.sb) 文件后再启动调试。");
        return undefined;
      }

      const target = await resolveDebugDocument(program);
      const shape = target ? analyzeProgramShape(target) : { ready: false, drawsShapes: false };
      const routing = routeWebDebugRequest(
        { backend: config.backend, noDebug: config.noDebug === true },
        shape.ready && shape.drawsShapes
      );

      if (routing.kind === "reject") {
        void vscode.window.showErrorMessage(routing.message);
        return undefined;
      }

      if (routing.kind === "run-in-webview") {
        if (!target) {
          void vscode.window.showErrorMessage("无法打开要运行的 SmallBasic 文件。请先在编辑器中打开该文件。");
          return undefined;
        }

        if (routing.note) {
          void vscode.window.setStatusBarMessage(routing.note, 8000);
        }

        await runInWebview(context, documentBaseName(target), target.getText(), routing.backend);
        // The program already ran in the webview, so this request is complete.
        return undefined;
      }

      // F5: let the inline adapter factory start the shared web debug session.
      config.backend = routing.backend;
      config.program = program;
      return config;
    }
  };
}
