import { expect, test, type Page } from "@playwright/test";
import { buildWebviewHtml } from "../../packages/smallbasic-vscode/src/web/webview-html";
import { requireStagedPayload, serveDirectory, serveDocument, type StaticServer } from "./support/servers";

/**
 * Runs the exact document the VS Code extension hands to the webview
 * (`buildWebviewHtml`) against the staged Blazor payload, on two different
 * origins - the webview document lives on vscode-webview://<id> while the payload
 * comes from the extension resource host, so CSP, CORS and the credential-free
 * boot fetches are all exercised.
 *
 *   npm run test:web -- --grep webview-document
 *   npm run test:web -- --headed --debug            # step through in a browser
 */

interface HostMessage {
  type: string;
  text?: string;
  json?: string;
}

const graphicsProgram = [
  "GraphicsWindow.Width = 480",
  "GraphicsWindow.Height = 320",
  'GraphicsWindow.BrushColor = "Red"',
  "GraphicsWindow.FillRectangle(20, 20, 200, 120)",
  'GraphicsWindow.PenColor = "Navy"',
  "GraphicsWindow.DrawLine(0, 0, 480, 320)",
  "TextWindow.WriteLine(12345)"
].join("\n");

test.describe("Blazor webview document", () => {
  let payload: StaticServer;
  let pageHost: StaticServer;
  let errors: string[];

  test.beforeAll(async () => {
    const payloadRoot = requireStagedPayload();
    payload = await serveDirectory(payloadRoot, "/payload");
    pageHost = await serveDocument(
      buildWebviewHtml({ cspSource: payload.origin, payloadUri: `${payload.origin}/payload` })
    );
  });

  test.afterAll(async () => {
    await pageHost.close();
    await payload.close();
  });

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    // The webview host API is injected by VS Code; emulate it and keep the
    // messages the page posts back for assertions.
    await page.addInitScript(() => {
      (window as unknown as { __hostMessages: HostMessage[] }).__hostMessages = [];
      (window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
        postMessage: (message: HostMessage) => {
          (window as unknown as { __hostMessages: HostMessage[] }).__hostMessages.push(message);
        }
      });
    });

    await page.goto(pageHost.origin);
  });

  test("runs a graphics program and mirrors its output", async ({ page }) => {
    await startRun(page, "graphics.sb", graphicsProgram);

    const messages = await hostMessages(page);
    expect(messages.map((message) => message.type)).toContain("ready");
    expect(notifies(messages)).toEqual(["ready", "terminated"]);

    // TextWindow output is forwarded to the host (the extension mirrors it into
    // an output channel) and the SVG scene holds the drawn geometry.
    expect(messages.filter((message) => message.type === "output").map((message) => message.text).join(""))
      .toBe("12345\n");
    expect(await page.locator("#app svg").count()).toBe(1);
    expect(await page.locator("#app svg rect").count()).toBeGreaterThan(0);
    expect(await page.locator("#app svg line").count()).toBeGreaterThan(0);

    // Any CSP violation or WASM/CORS problem would surface here.
    expect(errors).toEqual([]);

    await page.screenshot({ path: "tests/webview/artifacts/webview-document.png", fullPage: true });
  });

  test("stops a running program on request", async ({ page }) => {
    await startRun(
      page,
      "loop.sb",
      ["For i = 1 To 200", "  Program.Delay(200)", "  TextWindow.WriteLine(i)", "EndFor"].join("\n"),
      { waitForCompletion: false }
    );

    await expect.poll(async () => (await hostMessages(page)).some((message) => message.type === "output")).toBe(true);
    await page.evaluate(() => window.postMessage({ type: "stop" }, "*"));

    await expect
      .poll(async () => notifies(await hostMessages(page)).includes("terminated"), { timeout: 30_000 })
      .toBe(true);

    const after = (await hostMessages(page)).filter((message) => message.type === "output").length;
    await page.waitForTimeout(1500);
    expect((await hostMessages(page)).filter((message) => message.type === "output").length).toBe(after);
    expect(errors).toEqual([]);
  });
});

async function startRun(
  page: Page,
  name: string,
  source: string,
  options: { waitForCompletion?: boolean } = {}
): Promise<void> {
  await page.evaluate(
    (payload) => window.postMessage({ type: "run", name: payload.name, source: payload.source }, "*"),
    { name, source }
  );

  if (options.waitForCompletion === false) {
    return;
  }

  await expect
    .poll(async () => notifies(await hostMessages(page)).includes("terminated"), { timeout: 150_000 })
    .toBe(true);
}

function hostMessages(page: Page): Promise<HostMessage[]> {
  return page.evaluate(() => (window as unknown as { __hostMessages: HostMessage[] }).__hostMessages);
}

function notifies(messages: HostMessage[]): string[] {
  return messages
    .filter((message) => message.type === "notify" && message.json)
    .map((message) => (JSON.parse(message.json as string) as { type: string }).type);
}
