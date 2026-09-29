import * as vscode from "vscode";
import { Compilation } from "smallbasic-lang-core";
import { activateCommon } from "../common/activation";
import { isSmallBasicDocument } from "../language/providers";
import { runInBlazorWebview } from "./blazor-webview";
import { SmallBasicWebDebugAdapterFactory } from "./debug-factory";
import { routeWebDebugRequest } from "./run-routing";

export function activate(context: vscode.ExtensionContext): void {
  activateCommon(context, {
    debugAdapterFactory: new SmallBasicWebDebugAdapterFactory(),
    debugConfigurationProvider: createWebDebugConfigurationProvider(context),
    // The Blazor backend runs entirely inside a webview here: the same
    // SmallBasic.Blazor.Client WebAssembly build that the desktop RunHost serves
    // over HTTP, so graphics work without any local process.
    runBlazor: async () => runBlazorActiveDocument(context)
  });
}

export function deactivate(): void {
  // no-op
}

async function runBlazorActiveDocument(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isSmallBasicDocument(editor.document)) {
    void vscode.window.showWarningMessage("请先打开一个 SmallBasic (.sb) 文件。");
    return;
  }

  const document = editor.document;
  warnWhenJavaScriptWouldDo(document);

  await runInBlazorWebview(context, documentName(document), document.getText());
}

function warnWhenJavaScriptWouldDo(document: vscode.TextDocument): void {
  const shape = analyze(document);
  if (!shape.ready || shape.drawsShapes) {
    return;
  }

  // Not a blocker: the user asked for this backend explicitly.
  void vscode.window.setStatusBarMessage(
    "Small Basic 提示：该程序只使用 TextWindow，JavaScript 后端启动更快。",
    8000
  );
}

function documentName(document: vscode.TextDocument): string {
  if (document.isUntitled) {
    return "untitled.sb";
  }

  const segments = document.uri.path.split("/");
  return segments[segments.length - 1] || document.fileName || "program.sb";
}

/**
 * Resolves the launch configuration of the web entry.
 *
 * Both "Start Debugging" (F5) and "Run Without Debugging" (Ctrl+F5) arrive here,
 * the latter flagged by `noDebug` on the configuration, and only the JavaScript
 * backend can actually be debugged in this host. Blazor requests therefore act as
 * follows (see ./run-routing.ts for the table):
 *
 *   - Ctrl+F5 runs the program in the Blazor webview and ends the request; the
 *     webview is not a debug session, so no session is started;
 *   - F5 is refused with a message pointing at Ctrl+F5 / the run command, instead
 *     of starting a session that would fail inside the adapter.
 */
function createWebDebugConfigurationProvider(context: vscode.ExtensionContext): vscode.DebugConfigurationProvider {
  const activeDocument = (): vscode.TextDocument | undefined => {
    const document = vscode.window.activeTextEditor?.document;
    return document && isSmallBasicDocument(document) ? document : undefined;
  };

  const createConfig = (document: vscode.TextDocument): vscode.DebugConfiguration => {
    const shape = analyze(document);
    const backend = shape.ready && shape.drawsShapes ? "blazor" : "javascript";
    return {
      type: "smallbasic",
      request: "launch",
      name: backend === "blazor"
        ? "SmallBasic: Debug current file with Blazor backend"
        : "SmallBasic: Debug current file with JavaScript backend",
      program: document.fileName || document.uri.toString(),
      backend,
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

      const document = activeDocument();
      const program = (typeof config.program === "string" ? config.program.trim() : "")
        || document?.fileName
        || document?.uri.toString()
        || "";
      if (!program) {
        void vscode.window.showErrorMessage("请先打开一个 SmallBasic (.sb) 文件后再启动调试。");
        return undefined;
      }

      const target = document ?? await openProgram(program);
      const shape = target ? analyze(target) : { ready: false, drawsShapes: false };
      const routing = routeWebDebugRequest(
        { backend: config.backend, noDebug: config.noDebug === true },
        shape.ready && shape.drawsShapes
      );

      if (routing.kind === "reject") {
        void vscode.window.showErrorMessage(routing.message);
        return undefined;
      }

      if (routing.kind === "webview") {
        if (!target) {
          void vscode.window.showErrorMessage("无法打开要运行的 SmallBasic 文件。请先在编辑器中打开该文件。");
          return undefined;
        }

        if (routing.note) {
          void vscode.window.setStatusBarMessage(routing.note, 8000);
        }

        await runInBlazorWebview(context, documentName(target), target.getText());
        // The program already ran in the webview, so this request is complete.
        return undefined;
      }

      config.backend = "javascript";
      config.program = program;
      return config;
    }
  };
}

/** Opens the configured program when it is not the active document (remote URIs included). */
async function openProgram(program: string): Promise<vscode.TextDocument | undefined> {
  if (!program) {
    return undefined;
  }

  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(program));
    return isSmallBasicDocument(document) ? document : undefined;
  } catch {
    return undefined;
  }
}

interface ProgramShape {
  ready: boolean;
  /** Whether the program needs the Blazor backend (GraphicsWindow/Shapes/Turtle). */
  drawsShapes: boolean;
}

function analyze(document: vscode.TextDocument): ProgramShape {
  try {
    const compilation = new Compilation(document.getText());
    return { ready: compilation.isReadyToRun, drawsShapes: compilation.kind.drawsShapes() };
  } catch {
    return { ready: false, drawsShapes: false };
  }
}
