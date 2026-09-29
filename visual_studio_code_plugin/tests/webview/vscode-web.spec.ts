import { expect, test, type Frame, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { extensionPackageRoot, pluginRoot, requireStagedPayload, serveDirectory } from "./support/servers";

/**
 * End-to-end local debugging of the web extension: a real VS Code Web workbench
 * served by the installed VS Code (`code serve-web`), the extension folder served
 * over HTTP and installed through "Developer: Install Extension from Location...",
 * and a Blazor graphics program executed in the webview panel.
 *
 * Prerequisites (the spec fails with instructions when they are missing):
 *
 *   .\runhost\Build-RunHost.ps1
 *   cd visual_studio_code_plugin; npm run build; npm run stage:blazor -w smallbasic-tools-vsc
 *
 * Run it with:
 *
 *   npm run test:web -- --grep workbench
 *   npm run test:web -- --grep workbench --headed      # watch it in a browser
 *   SB_WEB_BROWSER=msedge npm run test:web             # reuse an installed browser
 */

const repositoryRoot = path.resolve(pluginRoot, "..");
const workspaceFolder = path.join(repositoryRoot, "test");
const programUnderTest = path.join(workspaceFolder, "tutorial", "level1.sb");
const ARTIFACTS = path.join(__dirname, "artifacts");
const WORKBENCH_PORT = 9899;

let workbench: ChildProcess | undefined;
let extensionServer: { origin: string; close(): Promise<void> };

/**
 * Opt-in: driving a real workbench through the command palette needs a clean
 * environment. On a machine whose VS Code web workbench runs in restricted mode
 * (workspace trust prompts) or that hosts an extension grabbing focus (chat/agent
 * panels reuse the quick-input DOM), the install-from-location and palette steps
 * cannot be automated reliably. The page-level spec in this folder covers CSP,
 * CORS, WASM and graphics; use the `SmallBasic Web Extension (VS Code Web host)`
 * launch configuration in .vscode/launch.json (F5) for interactive debugging.
 *
 *   SB_WEB_WORKBENCH=1 npm run test:web -- --grep workbench --headed
 */
const workbenchEnabled = process.env.SB_WEB_WORKBENCH === "1";

test.describe("VS Code Web workbench", () => {
  test.skip(!workbenchEnabled, "Set SB_WEB_WORKBENCH=1 to drive a real VS Code Web workbench");

  test.beforeAll(async () => {
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    requireStagedPayload();

    const webBundle = path.join(extensionPackageRoot, "dist", "web", "extension.js");
    if (!fs.existsSync(webBundle)) {
      throw new Error(`Web extension bundle not found: ${webBundle}\nBuild it with: cd visual_studio_code_plugin; npm run build`);
    }

    if (!fs.existsSync(programUnderTest)) {
      throw new Error(`Sample program not found: ${programUnderTest}`);
    }

    // The workbench installs the extension from a URL, exactly like vscode.dev.
    extensionServer = await serveDirectory(extensionPackageRoot);
    await startWorkbench();
  });

  test.afterAll(async () => {
    await extensionServer.close();
    if (workbench && !workbench.killed) {
      spawn("taskkill", ["/pid", String(workbench.pid), "/T", "/F"], { stdio: "ignore" });
    }
  });

  test("runs a graphics program in the Blazor webview", async ({ page }) => {
    test.slow();
    const diagnostics: string[] = [];

    await page.goto(`http://127.0.0.1:${WORKBENCH_PORT}/`);
    await page.locator(".monaco-workbench").waitFor({ timeout: 90_000 });
    // --default-folder opens the repository's test folder.
    await expect(page.locator(".explorer-folders-view")).toContainText("tutorial", { timeout: 60_000 });

    await installExtensionFromLocation(page, extensionServer.origin, diagnostics);
    await openProgram(page, diagnostics);
    await expectExtensionCommands(page, diagnostics);
    await runCommand(page, "smallbasic.runBlazor", diagnostics);

    const svg = await waitForWebviewLocator(page, "#app svg", 180_000);
    expect(svg, `No Blazor webview appeared. Diagnostics:\n${diagnostics.join("\n")}`).toBeDefined();

    const shapes = await waitForWebviewLocator(page, "#app svg rect, #app svg line, #app svg ellipse, #app svg polygon", 60_000);
    expect(await shapes!.count()).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(ARTIFACTS, "vscode-web-workbench.png"), fullPage: true });
  });
});

function startWorkbench(): Promise<void> {
  const command = process.platform === "win32" ? "code.cmd" : "code";
  workbench = spawn(
    command,
    [
      "serve-web",
      "--port", String(WORKBENCH_PORT),
      "--host", "127.0.0.1",
      "--without-connection-token",
      "--disable-telemetry",
      "--accept-server-license-terms",
      // Without this the workbench opens in restricted mode: extensions are
      // installed but not activated, so no SmallBasic command would exist.
      "--disable-workspace-trust",
      "--default-folder", workspaceFolder
    ],
    { cwd: pluginRoot, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] }
  );

  let log = "";
  for (const stream of [workbench.stdout, workbench.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      log += chunk.toString();
      fs.writeFileSync(path.join(ARTIFACTS, "serve-web.log"), log);
    });
  }

  const url = `http://127.0.0.1:${WORKBENCH_PORT}/`;
  const deadline = Date.now() + 60_000;
  return (async () => {
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { redirect: "manual" });
        if (response.status < 500) {
          return;
        }
      } catch {
        // not listening yet
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`VS Code Web workbench did not start on ${url}. See tests/webview/artifacts/serve-web.log\n${log}`);
  })();
}

async function installExtensionFromLocation(page: Page, location: string, diagnostics: string[]): Promise<void> {
  await page.locator(".monaco-workbench").click({ position: { x: 500, y: 400 } });
  await openQuickInput(page, ">workbench.extensions.action.installExtensionFromLocation");

  const input = page.locator(".quick-input-widget input.input").last();
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await input.fill(location);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(8000);

  diagnostics.push(`install notifications: ${JSON.stringify(await notificationTexts(page))}`);

  // Installing an extension in the web workbench activates it after a reload.
  await page.reload();
  await page.locator(".monaco-workbench").waitFor({ timeout: 120_000 });
  await expect(page.locator(".explorer-folders-view")).toContainText("tutorial", { timeout: 60_000 });
}

async function openProgram(page: Page, diagnostics: string[]): Promise<void> {
  await page.locator(".monaco-workbench").click({ position: { x: 500, y: 400 } });
  await page.keyboard.press("Control+P");
  await page.waitForTimeout(800);
  await page.keyboard.type("level1");
  await page.waitForTimeout(1500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);

  diagnostics.push(`open editors: ${JSON.stringify(await page.locator(".tabs-container .tab").allInnerTexts())}`);
  await expect(page.locator(".tabs-container .tab", { hasText: "level1" }).first()).toBeVisible({ timeout: 30_000 });
}

async function runCommand(page: Page, commandId: string, diagnostics: string[]): Promise<void> {
  const items = await openQuickInput(page, `>${commandId}`);
  diagnostics.push(`palette(${commandId}): ${JSON.stringify(items.slice(0, 3))}`);
  diagnostics.push(`notifications: ${JSON.stringify(await notificationTexts(page))}`);
}

/**
 * Fails early with a readable message when the extension was not installed or
 * activated - running the command would otherwise just do nothing.
 */
async function expectExtensionCommands(page: Page, diagnostics: string[]): Promise<void> {
  const items = await openQuickInput(page, ">SmallBasic", { select: false });
  diagnostics.push(`palette(SmallBasic): ${JSON.stringify(items.slice(0, 5))}`);
  expect(
    items.some((item) => /SmallBasic:/i.test(item)),
    `The SmallBasic commands are not registered - the extension is not installed/activated.\n` +
      `notifications: ${JSON.stringify(await notificationTexts(page))}`
  ).toBe(true);
}

/** Opens the command palette, types a query and reports what it matched. */
async function openQuickInput(
  page: Page,
  query: string,
  options: { select?: boolean } = {}
): Promise<string[]> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+Shift+P");
  await page.locator(".quick-input-widget").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.keyboard.type(query);
  await page.waitForTimeout(1500);

  const items = await page.locator(".quick-input-list .monaco-list-row").allInnerTexts();
  if (options.select !== false) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
  } else {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  return items;
}

async function notificationTexts(page: Page): Promise<string[]> {
  return page.locator(".notifications-toasts .notification-list-item").allInnerTexts().catch(() => []);
}

/** Searches every frame (the webview lives in nested cross-origin iframes). */
async function waitForWebviewLocator(page: Page, selector: string, timeout: number) {
  const deadline = Date.now() + timeout;
  let candidate: ReturnType<Frame["locator"]> | undefined;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const locator = frame.locator(selector);
      if (await locator.count().catch(() => 0)) {
        candidate = locator;
        break;
      }
    }

    if (candidate) {
      return candidate;
    }

    await page.waitForTimeout(1500);
  }

  return undefined;
}
