/**
 * Error formatting and unsupported-library plumbing shared by the hosts.
 *
 * Deliberately free of `vscode` and Node.js imports: it is bundled into the
 * browser run host (`src/runhost/web.ts`), the extension host and the desktop
 * playground page alike.
 */

/** Formats an unknown thrown value for diagnostics and status lines. */
export function describeError(error: unknown, includeStack = false): string {
  if (error instanceof Error) {
    if (includeStack && error.stack) {
      return error.stack;
    }

    return error.message;
  }

  return String(error);
}

/** Thrown by the proxies of {@link createUnsupportedPlugin} on member access. */
export class UnsupportedLibraryError extends Error {}

/**
 * Builds a library plugin whose every member access throws, for libraries the
 * current host cannot provide (GraphicsWindow/Shapes on the text-only hosts).
 * The `then` trap keeps the proxy from being mistaken for a thenable.
 */
export function createUnsupportedPlugin<T>(message: string): T {
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(_target: Record<string | symbol, unknown>, property: string | symbol): unknown {
      if (property === "then") {
        return undefined;
      }

      throw new UnsupportedLibraryError(message);
    }
  }) as unknown as T;
}
