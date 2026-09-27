import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

export interface BlazorHostCommand {
  executable: string;
  argumentsPrefix: string[];
  cwd: string;
  artifactPath: string;
}

export class BlazorRunner {
  public static async runActiveDocument(extensionPath: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "smallbasic") {
      void vscode.window.showWarningMessage("请先打开一个 SmallBasic (.sb) 文件。");
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
      void vscode.window.showErrorMessage(
        "未找到 Small Basic Blazor RunHost。请安装 .NET 8 / ASP.NET Core 8 Runtime、重新安装完整扩展，" +
        "或在 smallbasic.blazor.runHostPath 中指定宿主路径。"
      );
      return;
    }

    if (!fs.existsSync(filePath)) {
      void vscode.window.showErrorMessage(`找不到 SmallBasic 程序文件：${filePath}`);
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
    const configured = vscode.workspace.getConfiguration("smallbasic").get<string>("blazor.runHostPath");
    if (configured && fs.existsSync(configured)) {
      return BlazorRunner.toCommand(configured);
    }

    const roots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    const developmentRoot = path.resolve(extensionPath, "..", "..", "..");
    const candidates = [
      path.join(extensionPath, "runhost", "blazor", "SmallBasic.Blazor.RunHost.dll"),
      path.join(developmentRoot, "runhost", "blazor", "SmallBasic.Blazor.RunHost.dll"),
      ...[developmentRoot, ...roots].flatMap((root) => [
        path.join(root, "visual_studio_plugin", "src", "SmallBasic.Blazor.RunHost", "bin", "Release", "net8.0", "SmallBasic.Blazor.RunHost.dll"),
        path.join(root, "visual_studio_plugin", "src", "SmallBasic.Blazor.RunHost", "bin", "Debug", "net8.0", "SmallBasic.Blazor.RunHost.dll"),
        path.resolve(root, "..", "visual_studio_plugin", "src", "SmallBasic.Blazor.RunHost", "bin", "Release", "net8.0", "SmallBasic.Blazor.RunHost.dll"),
        path.resolve(root, "..", "visual_studio_plugin", "src", "SmallBasic.Blazor.RunHost", "bin", "Debug", "net8.0", "SmallBasic.Blazor.RunHost.dll")
      ])
    ];

    const artifact = candidates.find((candidate) => fs.existsSync(candidate));
    return artifact ? BlazorRunner.toCommand(artifact) : undefined;
  }

  private static toCommand(artifactPath: string): BlazorHostCommand {
    const resolved = path.resolve(artifactPath);
    return path.extname(resolved).toLowerCase() === ".dll"
      ? { executable: "dotnet", argumentsPrefix: [resolved], cwd: path.dirname(resolved), artifactPath: resolved }
      : { executable: resolved, argumentsPrefix: [], cwd: path.dirname(resolved), artifactPath: resolved };
  }
}
