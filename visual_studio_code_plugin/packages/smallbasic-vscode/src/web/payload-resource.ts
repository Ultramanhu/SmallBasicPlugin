/**
 * Returns the paths the extension host should try for one webview boot resource.
 *
 * The Marketplace's vscode-unpkg host rejects raw `.dat` files, including the
 * ICU data required before Blazor can start. `stage-runhost.mjs` therefore puts
 * an uncompressed copy behind an internal `.br`-suffixed alias, an extension the
 * CDN does serve. The alias contains the original bytes (it is not compressed),
 * so the runtime still receives data matching the hash in blazor.boot.json.
 */
export function payloadResourceCandidates(requestedPath: string | undefined): readonly string[] {
  if (!isSafePayloadPath(requestedPath)) {
    return [];
  }

  const frameworkPrefix = "_framework/";
  if (requestedPath.startsWith(frameworkPrefix) && requestedPath.toLowerCase().endsWith(".dat")) {
    const frameworkPath = requestedPath.slice(frameworkPrefix.length);
    return [`_framework-webview/${frameworkPath}.br`, requestedPath];
  }

  return [requestedPath];
}

function isSafePayloadPath(requestedPath: string | undefined): requestedPath is string {
  if (typeof requestedPath !== "string" || requestedPath.length === 0 || requestedPath.length > 512) {
    return false;
  }

  if (requestedPath.includes("\\") || requestedPath.startsWith("/")) {
    return false;
  }

  const segments = requestedPath.split("/");
  return !segments.some((segment) => segment.length === 0 || segment === "." || segment === "..");
}
