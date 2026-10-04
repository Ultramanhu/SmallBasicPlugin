/**
 * Path helpers shared across hosts; free of `vscode` and Node.js imports so
 * browser bundles can use them.
 */

/** Canonical comparison form of a program path: slashes, no trailing slash, lowercase. */
export function normalizeProgramPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

/** Last path segment of a slash-separated path, or `fallback` when empty. */
export function pathBaseName(value: string, fallback: string): string {
  const segments = value.replace(/\\/g, "/").split("/");
  return segments[segments.length - 1] || fallback;
}
