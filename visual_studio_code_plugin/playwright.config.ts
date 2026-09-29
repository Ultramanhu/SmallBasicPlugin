import { defineConfig } from "@playwright/test";

// Bundled Chromium by default (run `npx playwright install chromium` once). Set
// SB_WEB_BROWSER=msedge (or chrome) to drive an installed browser instead, which
// avoids the browser download entirely.
const installedBrowser = process.env.SB_WEB_BROWSER?.trim();

/**
 * Playwright harness for the browser-side parts of the extension:
 *
 *   tests/webview/webview-document.spec.ts  - the Blazor webview document itself
 *                                             (CSP, cross-origin payload, WASM, SVG)
 *   tests/webview/vscode-web.spec.ts        - the local VS Code Web workbench
 *                                             (`code serve-web`) running the web
 *                                             extension and its webview
 *
 * Both specs start their own static servers and use an isolated browser profile,
 * so nothing in the developer's VS Code installation can interfere.
 */
export default defineConfig({
  testDir: "./tests/webview",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./tests/webview/artifacts",
  use: {
    ...(installedBrowser ? { channel: installedBrowser as "msedge" | "chrome" } : {}),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 }
  }
});
