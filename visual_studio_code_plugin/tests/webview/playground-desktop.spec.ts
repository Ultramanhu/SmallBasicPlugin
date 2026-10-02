import { expect, test } from "@playwright/test";
import { hasStagedPlaygroundApp, serveDirectory, stagedPlaygroundAppRoot, type StaticServer } from "./support/servers";

/**
 * The staged Tauri application serves the same Playground page as `runhost/web`
 * plus one extra `desktop.js`. Outside the Tauri runtime that bridge must stay
 * completely inert: the page keeps the two Web backends, runs programs and
 * surfaces no console errors - the regression guard for "the desktop variant
 * does not change the browser Playground" (design doc 10, §19.4).
 */
test.describe("staged desktop playground app", () => {
  let server: StaticServer;

  // `runhost/playground/` is a generated staging root; skip on a clean checkout.
  test.skip(!hasStagedPlaygroundApp(), "runhost/playground/app is not staged ('npm run stage' in smallbasic-playground-desktop).");

  test.beforeAll(async () => {
    server = await serveDirectory(stagedPlaygroundAppRoot);
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("loads the desktop bridge without activating CLI backends in a browser", async ({ page }) => {
    const diagnostics: string[] = [];
    const desktopRequests: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        diagnostics.push(message.text());
      }
    });
    page.on("pageerror", (error) => diagnostics.push(String(error)));
    page.on("response", (response) => {
      if (response.url().endsWith("/desktop.js")) {
        desktopRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(`${server.origin}/playground.html`);
    await page.locator("#editor-host .monaco-editor").waitFor({ timeout: 120_000 });
    await expect(page.locator("#status")).toContainText("Loaded", { timeout: 60_000 });

    // The bridge is fetched (so a packaging mistake is caught) but the page
    // must not grow CLI backends: capability probing only works under Tauri.
    expect(desktopRequests.length).toBeGreaterThan(0);
    expect(desktopRequests[0].startsWith("200 ")).toBe(true);
    const options = await page.locator("#backend-select option").allTextContents();
    expect(options).toHaveLength(2);
    expect(options.some((text) => text.includes("CLI"))).toBe(false);

    // The Web JavaScript backend keeps running the default sample unchanged.
    await page.locator("#backend-select").selectOption("javascript");
    await page.locator("#run-button").click();
    await expect(page.locator("#console")).toContainText("Hello, World!", { timeout: 120_000 });
    await expect(page.locator("#status")).toHaveText(/Completed/, { timeout: 120_000 });
    expect(diagnostics).toEqual([]);
  });

  /**
   * The desktop entry can only register its backends after `whenReady` resolved
   * (it needs the live controller), which is *after* `bootstrap()` drained the
   * queued registrations. Late registrations must therefore be forwarded to the
   * controller; this is the regression guard for "the Tauri build shows only the
   * two Web backends" (design doc 10, §19.3 phase 2).
   *
   * The CLI offering is the two .NET RunHost flavours (doc 10, §17.2).
   */
  test("registers both C# CLI flavours when a Tauri IPC bridge is present", async ({ page }) => {
    const diagnostics: string[] = [];
    page.on("pageerror", (error) => diagnostics.push(String(error)));

    // Minimal stand-in for the Tauri v2 IPC surface: capability probing is the
    // only command the page issues at load time.
    await page.addInitScript(() => {
      const host = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: unknown) => Promise<unknown>;
          transformCallback: () => number;
          unregisterCallback: () => void;
        };
      };
      host.__TAURI_INTERNALS__ = {
        invoke: async (command) => {
          if (command === "desktop_capabilities") {
            return {
              platform: "x86_64-pc-windows-msvc",
              backends: { cliCsharpNet48: true, cliCsharpNet8: true },
              graphics: { cliCsharpNet48: true, cliCsharpNet8: true }
            };
          }

          return null;
        },
        transformCallback: () => 1,
        unregisterCallback: () => undefined
      };
    });

    await page.goto(`${server.origin}/playground.html`);
    await page.locator("#editor-host .monaco-editor").waitFor({ timeout: 120_000 });
    await expect(page.locator("#status")).toContainText("Loaded", { timeout: 60_000 });

    const options = page.locator("#backend-select option");
    await expect(options).toHaveCount(4, { timeout: 60_000 });
    // Two Web backends plus the two .NET RunHost flavours.
    expect(await options.allTextContents()).toEqual([
      "JavaScript (TextWindow)",
      "Blazor WASM (GraphicsWindow)",
      "C# (.NET Framework 4.8)",
      "C# (.NET 8.0)"
    ]);
    await expect(page.locator('#backend-select option[value="cli-csharp-net48"]'))
      .toHaveText("C# (.NET Framework 4.8)");
    await expect(page.locator('#backend-select option[value="cli-csharp-net8"]'))
      .toHaveText("C# (.NET 8.0)");
    // The removed CLI backends and the old unversioned C# id must not reappear.
    await expect(page.locator('#backend-select option[value="cli-javascript"]')).toHaveCount(0);
    await expect(page.locator('#backend-select option[value="cli-blazor"]')).toHaveCount(0);
    await expect(page.locator('#backend-select option[value="cli-csharp"]')).toHaveCount(0);
    expect(diagnostics).toEqual([]);
  });
});
