import { expect, test, type Page } from "@playwright/test";
import { requireBuiltWebRunHost, serveDirectory, type StaticServer } from "./support/servers";

const modifierKey = process.platform === "darwin" ? "Meta" : "Control";
const PLAYGROUND_PROGRAM = [
  "Sub Greet",
  '  TextWindow.WriteLine("playground ok")',
  "EndSub",
  "Greet()"
].join("\n");
const INVALID_PROGRAM = "If Then";
const ARITHMETIC_PROGRAM = [
  'TextWindow.WriteLine("div=" + (17 \\ 5))',
  'TextWindow.WriteLine("mod=" + (17 Mod 5))',
  'TextWindow.WriteLine("mathDiv=" + Math.Div(-7, 2))',
  'TextWindow.WriteLine("mathMod=" + Math.Mod(-7, 2))',
  'TextWindow.WriteLine("zero=" + Math.Mod(9, 0))'
].join("\n");

test.describe("runhost/web static distribution", () => {
  let server: StaticServer;
  let diagnostics: string[];

  test.beforeAll(async () => {
    server = await serveDirectory(requireBuiltWebRunHost());
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ page }) => {
    diagnostics = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        diagnostics.push(message.text());
      }
    });
    page.on("pageerror", (error) => diagnostics.push(String(error)));
  });

  test("routes the root entry to the right page and preserves query/hash", async ({ page }) => {
    await page.goto(`${server.origin}/index.html?hello=1#intro`);
    await expect.poll(() => page.url()).toContain("/playground.html?hello=1#intro");

    await page.goto(`${server.origin}/index.html?view=runhost#legacy`);
    await expect.poll(() => page.url()).toContain("/runhost.html?view=runhost#legacy");
    expect(diagnostics).toEqual([]);
  });

  test("debugs with a gutter breakpoint, then continues to completion", async ({ page }) => {
    await page.goto(`${server.origin}/playground.html`);
    await page.locator("#editor-host .monaco-editor").waitFor({ timeout: 120_000 });
    await page.locator("#backend-select").selectOption("javascript");
    await expect(page.locator("#status")).toContainText("Loaded", { timeout: 60_000 });

    // Toggle a breakpoint through the glyph margin on line 5 of hello.sb
    // (`TextWindow.WriteLine(a2)`), so a1/a2 are defined when it hits.
    const editorBox = await page.locator("#editor-host .monaco-editor").first().boundingBox();
    const line5 = await page.locator("#editor-host .view-line").nth(4).boundingBox();
    await page.mouse.click(editorBox.x + 12, line5.y + line5.height / 2);
    await expect(page.locator("#editor-host .debug-breakpoint-unverified-glyph, #editor-host .debug-breakpoint-glyph")).toHaveCount(1);

    // The toolbar is persistent and fully disabled before a session starts.
    await expect(page.locator("#debug-toolbar")).toBeVisible();
    await expect(page.locator("#debug-toggle")).toBeDisabled();

    await page.locator("#debug-button").click();
    await expect(page.locator("#status")).toContainText("Paused: breakpoint", { timeout: 60_000 });
    await expect(page.locator("#editor-host .debug-current-line")).toBeVisible();
    await expect(page.locator("#debug-panel")).toBeVisible();
    await expect(page.locator("#debug-variables")).toContainText("a1", { timeout: 60_000 });
    // The floating toolbar shows the VS Code continue glyph while paused.
    await expect(page.locator("#debug-toggle .codicon-debug-continue")).toBeVisible();

    // Step Over must stop again on the next executable line (line 7). With a
    // missing stack depth it would silently run to completion instead.
    await page.locator("#debug-step-over").click();
    await expect(page.locator("#status")).toContainText("Paused: step", { timeout: 60_000 });

    await page.locator("#debug-toggle").click();
    await expect(page.locator("#status")).toHaveText(/Completed/, { timeout: 120_000 });
    await expect(page.locator("#debug-panel")).toBeHidden();
    await expect(page.locator("#debug-button")).toBeEnabled();
    // Ending the session must clear the current-stack-frame marker again.
    await expect(page.locator("#editor-host .debug-current-line")).toHaveCount(0);
    await expect(page.locator("#debug-toggle")).toBeDisabled();
    expect(diagnostics).toEqual([]);
  });

  test("debugs the Blazor backend with breakpoints and keeps graphics available", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`${server.origin}/playground.html`);
    await page.locator("#editor-host .monaco-editor").waitFor({ timeout: 120_000 });
    await page.locator("#backend-select").selectOption("blazor");
    await expect(page.locator("#status")).toContainText("Loaded", { timeout: 60_000 });

    // Breakpoint on line 3 (`a1 = 1`), one of the first statements the Blazor
    // engine executes.
    const editorBox = await page.locator("#editor-host .monaco-editor").first().boundingBox();
    const line3 = await page.locator("#editor-host .view-line").nth(2).boundingBox();
    await page.mouse.click(editorBox.x + 12, line3.y + line3.height / 2);
    await expect(page.locator("#editor-host .debug-breakpoint-unverified-glyph, #editor-host .debug-breakpoint-glyph")).toHaveCount(1);

    // Debug on the Blazor backend: the WebAssembly runtime boots in the page,
    // then the same web debug protocol drives it through JS interop.
    await page.locator("#debug-button").click();
    await expect(page.locator("#status")).toContainText("Paused: breakpoint", { timeout: 180_000 });
    await expect(page.locator("#debug-panel")).toBeVisible();
    await expect(page.locator("#debug-toggle .codicon-debug-continue")).toBeVisible();

    await page.locator("#debug-toggle").click();
    await expect(page.locator("#status")).toHaveText(/Completed/, { timeout: 180_000 });
    await expect(page.locator("#debug-button")).toBeEnabled();
    expect(diagnostics).toEqual([]);
  });

  test("keeps the legacy runhost page running the default sample", async ({ page }) => {
    await page.goto(`${server.origin}/runhost.html`);
    await expect(page.locator("#status")).toContainText("Loaded", { timeout: 60_000 });
    await page.locator("#run-button").click();
    await expect(page.locator("#console")).toContainText("Hello, World!", { timeout: 120_000 });
    await expect(page.locator("#status")).toHaveText(/Completed/, { timeout: 120_000 });
    expect(diagnostics).toEqual([]);
  });

  test("runs integer division and modulo on both browser backends", async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto(`${server.origin}/playground.html`);
    await page.locator("#editor-host .monaco-editor").waitFor({ timeout: 120_000 });

    for (const backend of ["javascript", "blazor"]) {
      await page.locator("#backend-select").selectOption(backend);
      await replaceEditorText(page, ARITHMETIC_PROGRAM);
      await page.locator("#run-button").click();
      await expect(page.locator("#status")).toHaveText(/Completed/, { timeout: 180_000 });
      await expect(page.locator("#console")).toContainText("div=3");
      await expect(page.locator("#console")).toContainText("mod=2");
      await expect(page.locator("#console")).toContainText("mathDiv=-3");
      await expect(page.locator("#console")).toContainText("mathMod=-1");
      await expect(page.locator("#console")).toContainText("zero=0");
    }

    expect(diagnostics).toEqual([]);
  });

  test("loads the Monaco playground, shows symbols/diagnostics, and runs edited code", async ({ page }) => {
    await page.goto(`${server.origin}/playground.html`);
    await page.locator("#editor-host .monaco-editor").waitFor({ timeout: 120_000 });
    // The Playwright context runs with an English locale, so the static UI
    // hints must have been swapped off the baked-in Chinese defaults.
    await expect(page.locator('[data-i18n="editorNote"]')).toContainText("Shared VS Code language layer");
    await expect(page.locator("#file-field")).toHaveAttribute("title", /Open a local \.sb file/);
    await page.locator("#backend-select").selectOption("javascript");
    await expect(page.locator("#console")).toBeVisible();

    await replaceEditorText(page, PLAYGROUND_PROGRAM);
    await page.locator("#outline-button").click();
    await expect(page.locator("#outline")).toBeVisible();
    await expect(page.locator("#outline-list")).toContainText("Greet", { timeout: 60_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator("#outline")).toBeHidden();

    await replaceEditorText(page, INVALID_PROGRAM);
    await expect(page.locator("#diagnostics")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#diagnostics")).not.toHaveText(/^\s*$/);

    await replaceEditorText(page, PLAYGROUND_PROGRAM);
    await expect
      .poll(async () => await page.locator("#diagnostics").isHidden(), { timeout: 60_000 })
      .toBe(true);

    await page.locator("#run-button").click();
    await expect(page.locator("#console")).toContainText("playground ok", { timeout: 120_000 });
    await expect(page.locator("#status")).toHaveText(/Completed/, { timeout: 120_000 });
    expect(diagnostics).toEqual([]);

    // The header toggle overrides browser-language detection both ways. The
    // click reloads the page, so the button label doubles as the wait signal.
    await page.locator("#locale-button").click();
    await expect(page.locator("#locale-button")).toHaveText("EN", { timeout: 60_000 });
    await expect(page.locator('[data-i18n="editorNote"]')).toContainText("共用 VS Code 语言层", { timeout: 60_000 });

    // Hover documentation follows the UI locale. Monaco's hover needs a
    // continuous mouse path (a single teleporting move does not trigger it).
    // After the reload the editor shows the default sample again, whose line
    // 1 is `TextWindow.WriteLine("Hello, World!")` — wait for the language
    // worker to settle, then glide onto the library object.
    await expect(page.locator("#status")).toContainText("Loaded", { timeout: 60_000 });
    await page.waitForTimeout(800);
    const lineBox = await page.locator("#editor-host .view-line").first().boundingBox();
    await page.mouse.move(lineBox.x + 400, lineBox.y + 400, { steps: 4 });
    await page.mouse.move(lineBox.x + 60, lineBox.y + lineBox.height / 2, { steps: 8 });
    const contentHover = page.locator(".monaco-hover").filter({ visible: true });
    await expect(contentHover).toContainText(/[\u4e00-\u9fff]/, { timeout: 60_000 });

    await page.locator("#locale-button").click();
    await expect(page.locator("#locale-button")).toHaveText("中文", { timeout: 60_000 });
    await expect(page.locator('[data-i18n="editorNote"]')).toContainText("Shared VS Code language layer", { timeout: 60_000 });
  });
});

async function replaceEditorText(page: Page, source: string): Promise<void> {
  const editor = page.locator("#editor-host .monaco-editor").first();
  await editor.click({ position: { x: 120, y: 24 }, force: true });
  await page.keyboard.press(`${modifierKey}+A`);
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(source);
}
