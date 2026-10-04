import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { blazorHostMissing, programFileNotFound, OPEN_SB_FILE_WARNING } from "../common/messages";
import { repositoryBinCandidates, resolveHostCommand, type HostCommand } from "./host-resolve";

export type BlazorHostCommand = HostCommand;

export class BlazorRunner {
  public static async runActiveDocument(extensionPath: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "smallbasic") {
      void vscode.window.showWarningMessage(OPEN_SB_FILE_WARNING);
      return;
    }

    if (editor.document.isUntitled || !(await editor.document.save())) {
      void vscode.window.showWarningMessage("请先保存文件后再使用 Blazor 后端运行。");
      return;
    }

    await BlazorRunner.runProgram(editor.document.uri.fsPath, extensionPath);
  }

  public static async runProgram(filePath: string, extensionPath: string): Promise<void> {
    const host = BlazorRunner.resolveHostCommand(extensionPath);
    if (!host) {
      void vscode.window.showErrorMessage(blazorHostMissing("运行"));
      return;
    }

    if (!fs.existsSync(filePath)) {
      void vscode.window.showErrorMessage(programFileNotFound(filePath));
      return;
    }

    // Text-only programs remain in this terminal. The RunHost opens a browser
    // only after compiler analysis finds GraphicsWindow/Shapes/Turtle usage.
    const terminal = vscode.window.createTerminal({
      name: `SmallBasic (Blazor): ${path.basename(filePath)}`,
      shellPath: host.executable,
      shellArgs: [...host.argumentsPrefix, "run", "--file", filePath],
      cwd: path.dirname(filePath)
    });
    terminal.show(true);
  }

  public static resolveHostCommand(extensionPath: string): BlazorHostCommand | undefined {
    return resolveHostCommand(extensionPath, "blazor.runHostPath", (searchRoots) => [
      path.join(extensionPath, "runhost", "blazor", "SmallBasic.Blazor.RunHost.dll"),
      path.join(searchRoots[0], "runhost", "blazor", "SmallBasic.Blazor.RunHost.dll"),
      ...searchRoots.flatMap((root) => repositoryBinCandidates(root, "SmallBasic.Blazor.RunHost", "net8.0", "SmallBasic.Blazor.RunHost.dll"))
    ]);
  }
}
