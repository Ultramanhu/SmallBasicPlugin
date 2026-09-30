import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { buildWebviewHtml } from "../../packages/smallbasic-vscode/src/web/webview-html";
import { payloadResourceCandidates } from "../../packages/smallbasic-vscode/src/web/payload-resource";
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
  sessionId?: string;
  requestId?: string;
  path?: string;
}

/** A decoded `debug-event` payload: the web debug protocol of debug-protocol.ts. */
interface DebugEvent {
  type: string;
  reason?: string;
  line?: number;
  /** Raw wire field of `breakpointsValidated` (the adapter renames it to `lines`). */
  breakpoints?: number[];
  requestId?: string;
  exitCode?: number;
  frames?: Array<{ name: string; line: number }>;
  variables?: Array<{ name: string; value: string }>;
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

/** TextWindow-only loop used by the debug scenario. */
const debugProgram = [
  "For i = 1 To 3",
  "TextWindow.WriteLine(i)",
  "EndFor"
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

      let lastError: unknown;
      for (const candidate of payloadResourceCandidates(relativePath)) {
        // Reproduce the Marketplace failure that prompted the host-side alias:
        // vscode-unpkg returns 403 for raw ICU `.dat` extension resources.
        if (candidate.toLowerCase().endsWith(".dat")) {
          lastError = new Error(`Marketplace resource host rejected ${candidate} (403)`);
          continue;
        }

        try {
          return fs.readFileSync(path.join(payloadRoot, ...candidate.split("/"))).toString("base64");
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError ?? new Error(`No test resource candidate: ${relativePath}`);
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

  /**
   * Drives the same wire protocol the extension's `WebDebugSessionBroker` uses,
   * against the real Blazor WebAssembly runtime: debug-launch -> ready ->
   * setBreakpoints/start -> stopped -> control -> terminated. This is the page
   * level counterpart of the unit tests in
   * packages/smallbasic-vscode/tests/blazor-debug-adapter.spec.ts.
   */
  test("drives a Blazor debug session through the web debug protocol", async ({ page }) => {
    // Phase 1: breakpoint verification (with an out-of-range request) and a stop.
    const sessionA = "e2e-debug-a";
    await launchDebugSession(page, sessionA, "debug.sb", debugProgram, false);
    expect((await waitForDebugEvent(page, sessionA, "ready")).type).toBe("ready");

    await sendDebugCommand(page, sessionA, { type: "setBreakpoints", requestId: "bp-out", breakpoints: [99] });
    expect((await waitForDebugEvent(page, sessionA, "breakpointsValidated", 1, "bp-out")).breakpoints).toEqual([]);

    await sendDebugCommand(page, sessionA, { type: "setBreakpoints", requestId: "bp-1", breakpoints: [1] });
    expect((await waitForDebugEvent(page, sessionA, "breakpointsValidated", 1, "bp-1")).breakpoints).toEqual([1]);

    await sendDebugCommand(page, sessionA, { type: "start", breakpoints: [1] });
    const stopped = await waitForDebugEvent(page, sessionA, "stopped");
    expect(stopped.reason).toBe("breakpoint");
    expect(stopped.line).toBe(1);
    expect(stopped.frames?.length ?? 0).toBeGreaterThan(0);
    expect(stopped.variables?.some((variable) => variable.name === "i")).toBe(true);

    await sendDebugCommand(page, sessionA, { type: "stop", requestId: "term-a" });
    expect((await waitForDebugEvent(page, sessionA, "terminated")).type).toBe("terminated");

    // Phase 2: stop on entry, step twice and mirror TextWindow output.
    const sessionB = "e2e-debug-b";
    await launchDebugSession(page, sessionB, "debug.sb", debugProgram, true);
    expect((await waitForDebugEvent(page, sessionB, "ready")).type).toBe("ready");
    await sendDebugCommand(page, sessionB, { type: "start", breakpoints: [] });

    const entry = await waitForDebugEvent(page, sessionB, "stopped");
    expect(entry.reason).toBe("entry");

    await sendDebugCommand(page, sessionB, { type: "control", control: "next", depth: entry.frames?.length ?? 0 });
    const stepped = await waitForDebugEvent(page, sessionB, "stopped", 2);
    expect(stepped.reason).toBe("step");

    // The second step executes `TextWindow.WriteLine(i)`, so output must now be
    // mirrored to the extension with this session id.
    await sendDebugCommand(page, sessionB, { type: "control", control: "next", depth: stepped.frames?.length ?? 0 });
    await waitForDebugEvent(page, sessionB, "stopped", 3);
    const debugOutput = (await hostMessages(page))
      .filter((message) => message.type === "output" && message.sessionId === sessionB)
      .map((message) => message.text ?? "")
      .join("");
    expect(debugOutput).toContain("1");

    await sendDebugCommand(page, sessionB, { type: "stop", requestId: "term-b" });
    expect((await waitForDebugEvent(page, sessionB, "terminated")).type).toBe("terminated");

    // A late command from the finished session must not revive it.
    await sendDebugCommand(page, sessionB, { type: "control", control: "continue", depth: 0 });
    await page.waitForTimeout(500);
    expect((await debugEvents(page, sessionB)).filter((event) => event.type === "stopped")).toHaveLength(3);

    expect(errors).toEqual([]);
  });

  /**
   * The JavaScript backend is debugged in the page exactly like Blazor: same
   * `debug-launch` / `debug-command` / `debug-event` protocol, same visible
   * `#console` surface. This is what makes both web-mode backends feel the same.
   */
  test("drives a JavaScript debug session through the same web debug protocol", async ({ page }) => {
    const sessionId = "e2e-js-debug";
    await launchDebugSession(page, sessionId, "debug.sb", debugProgram, false, "javascript");
    expect((await waitForDebugEvent(page, sessionId, "ready")).type).toBe("ready");
    await expect(page.locator("#console")).toBeVisible();

    await sendDebugCommand(page, sessionId, { type: "setBreakpoints", requestId: "bp-js", breakpoints: [1] });
    expect((await waitForDebugEvent(page, sessionId, "breakpointsValidated", 1, "bp-js")).breakpoints).toEqual([1]);

    await sendDebugCommand(page, sessionId, { type: "start", breakpoints: [1] });
    const stopped = await waitForDebugEvent(page, sessionId, "stopped");
    expect(stopped.reason).toBe("breakpoint");
    expect(stopped.line).toBe(1);
    expect(stopped.variables?.some((variable) => variable.name === "i")).toBe(true);

    await sendDebugCommand(page, sessionId, { type: "control", control: "next", depth: stopped.frames?.length ?? 0 });
    const stepped = await waitForDebugEvent(page, sessionId, "stopped", 2);
    expect(stepped.reason).toBe("step");

    // The step executed `TextWindow.WriteLine(i)`; the text must reach both the
    // page console and the extension (mirrored with this session id).
    await expect(page.locator("#console")).toContainText("1");
    const output = (await hostMessages(page))
      .filter((message) => message.type === "output" && message.sessionId === sessionId)
      .map((message) => message.text ?? "")
      .join("");
    expect(output).toContain("1");

    await sendDebugCommand(page, sessionId, { type: "stop", requestId: "term-js" });
    expect((await waitForDebugEvent(page, sessionId, "terminated")).type).toBe("terminated");

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

interface DebugCommandPayload {
  type: string;
  requestId?: string;
  breakpoints?: number[];
  control?: string;
  depth?: number;
  text?: string;
}

async function launchDebugSession(
  page: Page,
  sessionId: string,
  name: string,
  source: string,
  stopOnEntry: boolean,
  backend: "javascript" | "blazor" = "blazor"
): Promise<void> {
  await page.evaluate(
    (payload) => window.postMessage({ type: "debug-launch", ...payload }, "*"),
    { sessionId, backend, name, source, stopOnEntry }
  );
}

async function sendDebugCommand(page: Page, sessionId: string, command: DebugCommandPayload): Promise<void> {
  await page.evaluate(
    (payload) => window.postMessage({ type: "debug-command", sessionId: payload.sessionId, json: JSON.stringify(payload.command) }, "*"),
    { sessionId, command }
  );
}

async function debugEvents(page: Page, sessionId: string): Promise<DebugEvent[]> {
  const messages = await hostMessages(page);
  return messages
    .filter((message) => message.type === "debug-event" && message.sessionId === sessionId && message.json)
    .map((message) => JSON.parse(message.json as string) as DebugEvent);
}

async function waitForDebugEvent(
  page: Page,
  sessionId: string,
  type: string,
  occurrence = 1,
  requestId?: string
): Promise<DebugEvent> {
  let found: DebugEvent | undefined;
  await expect
    .poll(async () => {
      const matches = (await debugEvents(page, sessionId))
        .filter((event) => event.type === type && (!requestId || event.requestId === requestId));
      found = matches[occurrence - 1];
      return matches.length >= occurrence;
    }, { timeout: 150_000 })
    .toBe(true);

  return found!;
}
