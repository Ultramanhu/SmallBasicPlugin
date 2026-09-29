import * as vscode from "vscode";
import { Compilation } from "smallbasic-lang-core";
import { SmallBasicTerminalSession } from "./terminal-session";

/** Runs an already compiled JavaScript program in a VS Code pseudoterminal. */
export function runJavaScriptCompilation(
  document: vscode.TextDocument,
  compilation: Compilation
): void {
  if (!compilation.isReadyToRun) {
    void vscode.window.showErrorMessage("当前程序存在编译错误，请先修复后再运行。");
    return;
  }

  if (compilation.kind.drawsShapes()) {
    void vscode.window.showErrorMessage(
      "当前 JS 后端尚不支持 GraphicsWindow/Shapes/Turtle/Controls 图形宿主。" +
      "请使用 Blazor 后端的 Web 模式，或在 Windows 桌面版使用 C# 后端。"
    );
    return;
  }

  const session = new SmallBasicTerminalSession();
  const terminal = vscode.window.createTerminal({
    name: `SmallBasic: ${documentName(document)}`,
    pty: session
  });

  terminal.show(true);
  session.run(compilation);
}

function documentName(document: vscode.TextDocument): string {
  const segments = document.uri.path.split("/");
  return segments[segments.length - 1] || "program.sb";
}
