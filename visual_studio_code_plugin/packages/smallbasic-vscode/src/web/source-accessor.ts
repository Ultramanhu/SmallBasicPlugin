import * as vscode from "vscode";
import { normalizeProgramPath } from "../common/paths";
import type { DebugSourceAccessor } from "../debug/session";

export class WebDebugSourceAccessor implements DebugSourceAccessor {
  private readonly aliases = new Map<string, string>();
  private readonly source: string;
  private readonly canonicalPath: string;

  public constructor(document: vscode.TextDocument, configuredProgram: string) {
    this.source = document.getText();
    this.canonicalPath = document.fileName || document.uri.path || document.uri.toString();
    for (const alias of [
      configuredProgram,
      this.canonicalPath,
      document.uri.fsPath,
      document.uri.path,
      document.uri.toString()
    ]) {
      if (alias) {
        this.aliases.set(normalizeProgramPath(alias), this.canonicalPath);
      }
    }
  }

  public resolvePath(filePath: string): string {
    return this.aliases.get(normalizeProgramPath(filePath)) ?? filePath;
  }

  public basename(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    return normalized.slice(normalized.lastIndexOf("/") + 1) || "program.sb";
  }

  public readFile(filePath: string): string {
    if (this.resolvePath(filePath) !== this.canonicalPath) {
      throw new Error(`Source is not open in VS Code for the Web: ${filePath}`);
    }

    return this.source;
  }
}
