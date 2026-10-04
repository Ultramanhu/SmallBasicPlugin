import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

/**
 * Shared resolution of the local .NET backend hosts (C# RunHost, Blazor
 * RunHost): a user-configured setting wins, then the first existing candidate
 * from each runner's ladder, and a resolved `.dll` artifact launches through
 * `dotnet` while an `.exe` launches directly.
 */

/** Launch shape of a resolved host artifact, shared by every backend. */
export interface HostCommand {
  executable: string;
  argumentsPrefix: string[];
  cwd: string;
  artifactPath: string;
}

/** Wraps a resolved artifact: `.dll` runs via `dotnet`, anything else directly. */
export function toHostCommand(artifactPath: string): HostCommand {
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

/**
 * Resolves a host artifact: the configured setting (`configKey`) when it
 * exists, else the first existing candidate. `candidates` receives the search
 * roots — the development repository (three levels above the extension) first,
 * then the workspace folders — so a ladder only describes repository-relative
 * paths.
 */
export function resolveHostCommand(
  extensionPath: string,
  configKey: string,
  candidates: (searchRoots: string[]) => string[]
): HostCommand | undefined {
  const configured = vscode.workspace.getConfiguration("smallbasic").get<string>(configKey);
  if (configured && fs.existsSync(configured)) {
    return toHostCommand(configured);
  }

  const developmentRoot = path.resolve(extensionPath, "..", "..", "..");
  const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  const searchRoots = [developmentRoot, ...workspaceRoots];
  const artifact = candidates(searchRoots).find((candidate) => fs.existsSync(candidate));
  return artifact ? toHostCommand(artifact) : undefined;
}

/**
 * Candidate paths of `bin/<configuration>/<framework>` layouts inside one
 * search root, mirroring the historical ladder order (repository copy first,
 * then the extension-style layout, then the parent directory; Release before
 * Debug within each).
 */
export function repositoryBinCandidates(root: string, project: string, framework: string, fileName: string): string[] {
  return [
    path.join(root, "visual_studio_plugin", "src", project, "bin", "Release", framework, fileName),
    path.join(root, "visual_studio_plugin", "src", project, "bin", "Debug", framework, fileName),
    path.join(root, "src", project, "bin", "Release", framework, fileName),
    path.join(root, "src", project, "bin", "Debug", framework, fileName),
    path.resolve(root, "..", "visual_studio_plugin", "src", project, "bin", "Release", framework, fileName),
    path.resolve(root, "..", "visual_studio_plugin", "src", project, "bin", "Debug", framework, fileName)
  ];
}
