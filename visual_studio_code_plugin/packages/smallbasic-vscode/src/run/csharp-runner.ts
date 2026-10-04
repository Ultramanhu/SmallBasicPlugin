import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { csharpHostMissing, csharpHostMissingFunctions, programFileNotFound, SAVE_BEFORE_RUN_WARNING, OPEN_SB_FILE_WARNING } from "../common/messages";
import { supportsFunctionCapability } from "./capabilities";
import { repositoryBinCandidates, resolveHostCommand, type HostCommand } from "./host-resolve";

export type CSharpHostCommand = HostCommand;

export class CSharpRunner {
    public static async runActiveDocument(extensionPath: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "smallbasic") {
            void vscode.window.showWarningMessage(OPEN_SB_FILE_WARNING);
            return;
        }

        await CSharpRunner.runDocument(editor.document, extensionPath);
    }

    public static async runDocument(document: vscode.TextDocument, extensionPath: string): Promise<void> {
        if (!document.isUntitled) {
            const saved = await document.save();
            if (!saved) {
                void vscode.window.showWarningMessage(SAVE_BEFORE_RUN_WARNING);
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
            void vscode.window.showErrorMessage(csharpHostMissing("运行"));
            return;
        }

        if (!CSharpRunner.fileExists(filePath)) {
            void vscode.window.showErrorMessage(programFileNotFound(filePath));
            return;
        }

        if (!await CSharpRunner.supportsFunctions(host)) {
            void vscode.window.showErrorMessage(csharpHostMissingFunctions("运行"));
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
        return resolveHostCommand(extensionPath, "csharp.runHostPath", (searchRoots) => {
            const windowsCandidates = [
                path.join(extensionPath, "runhost", "windows", "SmallBasic.RunHost.exe"),
                path.join(extensionPath, "runhost", "SmallBasic.RunHost.exe"),
                ...searchRoots.flatMap((root) => [
                    ...repositoryBinCandidates(root, "SmallBasic.RunHost", "net8.0-windows", "SmallBasic.RunHost.exe"),
                    ...repositoryBinCandidates(root, "SmallBasic.RunHost", "net48", "SmallBasic.RunHost.exe")
                ])
            ];
            const portableCandidates = [
                path.join(extensionPath, "runhost", "portable", "SmallBasic.RunHost.dll"),
                ...searchRoots.flatMap((root) => repositoryBinCandidates(root, "SmallBasic.RunHost", "net8.0", "SmallBasic.RunHost.dll"))
            ];
            return process.platform === "win32"
                ? [...windowsCandidates, ...portableCandidates]
                : portableCandidates;
        });
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

    private static fileExists(filePath: string): boolean {
        return fs.existsSync(filePath);
    }
}
