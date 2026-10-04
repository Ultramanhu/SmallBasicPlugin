import * as vscode from "vscode";
import { Compilation } from "smallbasic-lang-core";
import { normalizeProgramPath, pathBaseName } from "./paths";
import { isSmallBasicDocument } from "../language/providers";

/**
 * Document helpers of the extension hosts (desktop and Web): resolving the
 * launch program to a document and reading its compiler shape. This is the one
 * implementation behind the run commands, the launch-configuration providers
 * and the web debug adapter factory.
 */

/**
 * Resolves the `program` of a launch configuration to an open/loadable
 * document: an already-open match first, then the active editor, then opening
 * the URI.
 *
 * The URI rule accepts any `scheme://` authority and any non-drive-letter
 * scheme (remote/untitled URIs), while a Windows path such as `c:\dir\x.sb`
 * — whose `c:` would otherwise parse as a URI scheme — goes through
 * {@link vscode.Uri.file}.
 */
export async function resolveDebugDocument(configuredProgram: string): Promise<vscode.TextDocument | undefined> {
  const wanted = normalizeProgramPath(configuredProgram);
  const open = configuredProgram
    ? vscode.workspace.textDocuments.find((document) => [
        document.fileName,
        document.uri.fsPath,
        document.uri.path,
        document.uri.toString()
      ].some((value) => normalizeProgramPath(value) === wanted) && isSmallBasicDocument(document))
    : undefined;
  if (open) {
    return open;
  }

  const active = vscode.window.activeTextEditor?.document;
  if (active && isSmallBasicDocument(active)) {
    return active;
  }

  if (!configuredProgram) {
    return undefined;
  }

  try {
    // A leading single-letter "scheme" is a Windows drive letter, not a URI.
    const uri = /^[a-z][a-z0-9+.-]+:/i.test(configuredProgram)
      ? vscode.Uri.parse(configuredProgram)
      : vscode.Uri.file(configuredProgram);
    const document = await vscode.workspace.openTextDocument(uri);
    return isSmallBasicDocument(document) ? document : undefined;
  } catch {
    return undefined;
  }
}

/** File name of a document, used as the program name in terminal titles and pages. */
export function documentBaseName(document: vscode.TextDocument): string {
  if (document.isUntitled) {
    return "untitled.sb";
  }

  return pathBaseName(document.uri.path, document.fileName || "program.sb");
}

/** Whether a document compiles, and whether it needs a graphics backend. */
export interface ProgramShape {
  ready: boolean;
  /** Whether the program needs the Blazor backend (GraphicsWindow/Shapes/Turtle). */
  drawsShapes: boolean;
}

export function analyzeProgramShape(document: vscode.TextDocument): ProgramShape {
  try {
    const compilation = new Compilation(document.getText());
    return { ready: compilation.isReadyToRun, drawsShapes: compilation.kind.drawsShapes() };
  } catch {
    return { ready: false, drawsShapes: false };
  }
}
