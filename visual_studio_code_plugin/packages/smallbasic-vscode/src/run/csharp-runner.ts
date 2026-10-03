import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { supportsFunctionCapability } from "./capabilities";

export interface CSharpHostCommand {
    executable: string;
    argumentsPrefix: string[];
    cwd: string;
    artifactPath: string;
}

export class CSharpRunner {
    public static async runActiveDocument(extensionPath: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "smallbasic") {
            void vscode.window.showWarningMessage("请先打开一个 SmallBasic (.sb) 文件。");
            return;
        }

        await CSharpRunner.runDocument(editor.document, extensionPath);
    }

    public static async runDocument(document: vscode.TextDocument, extensionPath: string): Promise<void> {
        if (!document.isUntitled) {
            const saved = await document.save();
            if (!saved) {
                void vscode.window.showWarningMessage("运行前需要先保存当前文件。");
                return;
            }
        } else {
            void vscode.window.showWarningMessage("请先保存文件后再使用 C# 后端运行。");
            return;
        }

        await CSharpRunner.runProgram(document.uri.fsPath, extensionPath);
    }

    public static async runProgram(filePath: string, extensionPath: string): Promise<void> {
        const host = CSharpRunner.resolveHostCommand(extensionPath);
        if (!host) {
            void vscode.window.showErrorMessage(
                "未找到可用的 SmallBasic C# 运行宿主。请在设置中配置 smallbasic.csharp.runHostPath，" +
                "或安装 .NET 8 后重新安装完整的扩展包。"
            );
            return;
        }

        if (!CSharpRunner.fileExists(filePath)) {
            void vscode.window.showErrorMessage(`找不到 SmallBasic 程序文件：${filePath}`);
            return;
        }

        if (!await CSharpRunner.supportsFunctions(host)) {
            void vscode.window.showErrorMessage(
                "当前 SmallBasic C# 运行宿主不支持 Function/Dim/Return。" +
                "请升级扩展内置宿主，或更新 smallbasic.csharp.runHostPath 指向的自定义宿主。"
            );
            return;
        }

        const terminal = vscode.window.createTerminal({
            name: `SmallBasic (C#): ${path.basename(filePath)}`,
            shellPath: host.executable,
            shellArgs: [...host.argumentsPrefix, "run", "--file", filePath, "--pause"],
            cwd: path.dirname(filePath)
        });

        terminal.show(true);
    }

    public static resolveHostCommand(extensionPath: string): CSharpHostCommand | undefined {
        const configPath = vscode.workspace
            .getConfiguration("smallbasic")
            .get<string>("csharp.runHostPath");

        if (configPath && CSharpRunner.fileExists(configPath)) {
            return CSharpRunner.toHostCommand(configPath);
        }

        const roots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
        const repositoryCandidates = (root: string, framework: string, fileName: string): string[] => [
            path.join(root, "visual_studio_plugin", "src", "SmallBasic.RunHost", "bin", "Release", framework, fileName),
            path.join(root, "visual_studio_plugin", "src", "SmallBasic.RunHost", "bin", "Debug", framework, fileName),
            path.join(root, "src", "SmallBasic.RunHost", "bin", "Release", framework, fileName),
            path.join(root, "src", "SmallBasic.RunHost", "bin", "Debug", framework, fileName),
            path.resolve(root, "..", "visual_studio_plugin", "src", "SmallBasic.RunHost", "bin", "Release", framework, fileName),
            path.resolve(root, "..", "visual_studio_plugin", "src", "SmallBasic.RunHost", "bin", "Debug", framework, fileName)
        ];

        const developmentRoot = path.resolve(extensionPath, "..", "..", "..");
        const searchRoots = [developmentRoot, ...roots];
        const windowsCandidates = [
            path.join(extensionPath, "runhost", "windows", "SmallBasic.RunHost.exe"),
            path.join(extensionPath, "runhost", "SmallBasic.RunHost.exe"),
            ...searchRoots.flatMap((root) => [
                ...repositoryCandidates(root, "net8.0-windows", "SmallBasic.RunHost.exe"),
                ...repositoryCandidates(root, "net48", "SmallBasic.RunHost.exe")
            ])
        ];
        const portableCandidates = [
            path.join(extensionPath, "runhost", "portable", "SmallBasic.RunHost.dll"),
            ...searchRoots.flatMap((root) => repositoryCandidates(root, "net8.0", "SmallBasic.RunHost.dll"))
        ];
        const candidates = process.platform === "win32"
            ? [...windowsCandidates, ...portableCandidates]
            : portableCandidates;

        for (const candidate of candidates) {
            if (CSharpRunner.fileExists(candidate)) {
                return CSharpRunner.toHostCommand(candidate);
            }
        }

        return undefined;
    }

    public static resolveHostPath(extensionPath: string): string | undefined {
        return CSharpRunner.resolveHostCommand(extensionPath)?.artifactPath;
    }

    public static supportsFunctions(host: CSharpHostCommand): Promise<boolean> {
        return new Promise((resolve) => {
            execFile(
                host.executable,
                [...host.argumentsPrefix, "--capabilities"],
                { cwd: host.cwd, timeout: 5_000, windowsHide: true },
                (error, stdout) => {
                    if (error) {
                        resolve(false);
                        return;
                    }

                    resolve(supportsFunctionCapability(stdout));
                }
            );
        });
    }

    private static toHostCommand(artifactPath: string): CSharpHostCommand {
        const resolved = path.resolve(artifactPath);
        if (path.extname(resolved).toLowerCase() === ".dll") {
            return {
                executable: "dotnet",
                argumentsPrefix: [resolved],
                cwd: path.dirname(resolved),
                artifactPath: resolved
            };
        }

        return {
            executable: resolved,
            argumentsPrefix: [],
            cwd: path.dirname(resolved),
            artifactPath: resolved
        };
    }

    private static fileExists(filePath: string): boolean {
        return fs.existsSync(filePath);
    }
}
