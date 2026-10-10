import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { csharpCompilerMissing, OPEN_SB_FILE_WARNING, programFileNotFound, SAVE_BEFORE_RUN_WARNING } from "../common/messages";
import { repositoryBinCandidates } from "./host-resolve";

const outputChannel = vscode.window.createOutputChannel("SmallBasic Compiler");

export class CSharpCompilerRunner {
  public static async compileActiveDocument(extensionPath: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "smallbasic") {
      void vscode.window.showWarningMessage(OPEN_SB_FILE_WARNING);
      return;
    }

    if (process.platform !== "win32") {
      void vscode.window.showErrorMessage("Small Basic C# 编译工具当前仅支持 Windows。");
      return;
    }

    if (editor.document.isUntitled) {
      void vscode.window.showWarningMessage("请先保存文件后再编译 Small Basic 程序。");
      return;
    }

    const saved = await editor.document.save();
    if (!saved) {
      void vscode.window.showWarningMessage(SAVE_BEFORE_RUN_WARNING);
      return;
    }

    await CSharpCompilerRunner.compileProgram(editor.document.uri.fsPath, extensionPath);
  }

  public static resolveCompilerPath(extensionPath: string): string | undefined {
    const configured = vscode.workspace.getConfiguration("smallbasic").get<string>("csharp.compilerPath");
    if (configured && fs.existsSync(configured)) {
      return path.resolve(configured);
    }

    const developmentRoot = path.resolve(extensionPath, "..", "..", "..");
    const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    const searchRoots = [developmentRoot, ...workspaceRoots];
    const candidates = [
      path.join(extensionPath, "runhost", "compiler", "SmallBasic.Compiler.Tool.exe"),
      path.join(searchRoots[0], "runhost", "compiler", "SmallBasic.Compiler.Tool.exe"),
      ...searchRoots.flatMap((root) => repositoryBinCandidates(root, "SmallBasic.Compiler.Tool", "net48", "SmallBasic.Compiler.Tool.exe"))
    ];

    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  public static async compileProgram(filePath: string, extensionPath: string, outputDirectory?: string): Promise<string | undefined> {
    const compilerPath = CSharpCompilerRunner.resolveCompilerPath(extensionPath);
    if (!compilerPath) {
      void vscode.window.showErrorMessage(csharpCompilerMissing());
      return undefined;
    }

    if (!fs.existsSync(filePath)) {
      void vscode.window.showErrorMessage(programFileNotFound(filePath));
      return undefined;
    }

    const targetDirectory = path.resolve(outputDirectory ?? path.dirname(filePath));
    const executablePath = path.join(targetDirectory, `${path.basename(filePath, path.extname(filePath))}.exe`);

    outputChannel.clear();
    outputChannel.appendLine(`[compile] compiler=${compilerPath}`);
    outputChannel.appendLine(`[compile] source=${filePath}`);
    outputChannel.appendLine(`[compile] output=${targetDirectory}`);

    const { exitCode, stdout, stderr } = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        compilerPath,
        ["compile", "--file", path.resolve(filePath), "--outputDir", targetDirectory],
        {
          cwd: path.dirname(compilerPath),
          windowsHide: true
        },
        (error, stdoutText, stderrText) => {
          const exitCode = error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : error ? 1 : 0;
          resolve({
            exitCode,
            stdout: stdoutText,
            stderr: stderrText
          });
        }
      );
    });

    if (stdout.trim().length > 0) {
      outputChannel.appendLine(stdout.trim());
    }

    if (stderr.trim().length > 0) {
      outputChannel.appendLine(stderr.trim());
    }

    if (exitCode !== 0 || !fs.existsSync(executablePath)) {
      outputChannel.show(true);
      void vscode.window.showErrorMessage(
        exitCode !== 0
          ? `Small Basic 编译失败（退出码 ${exitCode}）。详见 “SmallBasic Compiler” 输出。`
          : `Small Basic 编译工具未生成预期的 EXE：${executablePath}`
      );
      return undefined;
    }

    void vscode.window.showInformationMessage(`已生成 Small Basic EXE：${executablePath}`);
    return executablePath;
  }
}
