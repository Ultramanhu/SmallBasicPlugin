import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { buildWebviewHtml } from "../../packages/smallbasic-vscode/src/web/webview-html";
import {
  extensionPackageRoot,
  requireStagedPayload,
  serveDirectory,
  serveDocument,
  type StaticServer
} from "./support/servers";

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
  requestId?: string;
  path?: string;
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
  let payloadRoot: string;
  let errors: string[];

  test.beforeAll(async () => {
    payloadRoot = requireStagedPayload();
    // Marketplace-hosted extension binaries do not grant the isolated webview
    // origin CORS access. Keep CORS only for the runtime JS modules: boot JSON,
    // ICU, WASM and assemblies must succeed exclusively through the host bridge.
    payload = await serveDirectory(extensionPackageRoot, "/extension", {
      cors: (file) => [".css", ".js"].includes(path.extname(file).toLowerCase())
    });
    pageHost = await serveDocument(
      buildWebviewHtml({
        cspSource: payload.origin,
        payloadUri: `${payload.origin}/extension/runhost/blazor/wwwroot`,
        javascriptUri: `${payload.origin}/extension/dist/web-runhost.js`
      })
    );
  });

  test.afterAll(async () => {
    await pageHost.close();
    await payload.close();
  });

  test.beforeEach(async ({ page }) => {
    errors = [];
    await page.exposeFunction("__smallBasicReadResource", async (relativePath: string) => {
      const segments = relativePath.split("/");
      if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`Invalid test resource path: ${relativePath}`);
      }

      return fs.readFileSync(path.join(payloadRoot, ...segments)).toString("base64");
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    // The webview host API is injected by VS Code; emulate it and keep the
    // messages the page posts back for assertions. Resource reads deliberately
    // happen outside the page origin, just like workspace.fs in the extension.
    await page.addInitScript(() => {
      const testWindow = window as unknown as {
        __hostMessages: HostMessage[];
        __smallBasicReadResource(path: string): Promise<string>;
        acquireVsCodeApi: unknown;
      };
      testWindow.__hostMessages = [];
      testWindow.acquireVsCodeApi = () => ({
        postMessage: (message: HostMessage) => {
          testWindow.__hostMessages.push(message);
          if (message.type !== "resource-request") {
            return;
          }

          const request = message as HostMessage & { requestId: string; path: string };
          void testWindow.__smallBasicReadResource(request.path).then(
            (base64) => {
              const binary = atob(base64);
              const bytes = new Uint8Array(binary.length);
              for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
              }

              window.postMessage({
                type: "resource-response",
                requestId: request.requestId,
                ok: true,
                data: bytes.buffer
              }, "*");
            },
            (error) => window.postMessage({
              type: "resource-response",
              requestId: request.requestId,
              ok: false,
              error: String(error)
            }, "*")
          );
        }
      });
    });

    await page.goto(pageHost.origin);
  });

  test("runs a graphics program and mirrors its output", async ({ page }) => {
    await startRun(page, "blazor", "graphics.sb", graphicsProgram);

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

  test("runs a JavaScript TextWindow program in the same webview", async ({ page }) => {
    await startRun(page, "javascript", "hello.sb", 'TextWindow.WriteLine("hello from js")');

    const messages = await hostMessages(page);
    expect(notifies(messages)).toEqual(["ready", "terminated"]);
    expect(messages.filter((message) => message.type === "output").map((message) => message.text).join(""))
      .toBe("hello from js\n");
    await expect(page.locator("#console")).toContainText("hello from js");
    await expect(page.locator("#blazor-host")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("stops a running program on request", async ({ page }) => {
    await startRun(
      page,
      "blazor",
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
  backend: "javascript" | "blazor",
  name: string,
  source: string,
  options: { waitForCompletion?: boolean } = {}
): Promise<void> {
  await page.evaluate(
    (payload) => window.postMessage({
      type: "run",
      backend: payload.backend,
      name: payload.name,
      source: payload.source
    }, "*"),
    { backend, name, source }
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
