import * as vscode from "vscode";
import { buildWebviewHtml } from "./webview-html";

/**
 * The browser execution surface shared by the Run flow (`blazor-webview.ts`) and
 * the Blazor debug flow (`blazor-debug-broker.ts`): one webview panel that loads
 * the staged Blazor payload plus the bundled JavaScript backend, serves boot
 * resources through the extension host (see the module comment in
 * `blazor-webview.ts` for why CORS makes that necessary) and routes page
 * messages to whoever owns the panel.
 *
 * Extracted so the two flows do not each grow their own copy of the panel
 * lifecycle, resource bridge and ready bookkeeping.
 */

const PAYLOAD_SEGMENTS = ["runhost", "blazor", "wwwroot"];
const ENTRY_SEGMENTS = ["_framework", "blazor.webassembly.js"];
const DIST_SEGMENTS = ["dist"];
const JAVASCRIPT_SEGMENTS = [...DIST_SEGMENTS, "web-runhost.js"];

export interface WebviewMessage {
  type?: string;
  text?: string;
  json?: string;
  sessionId?: string;
  requestId?: string;
  path?: string;
}

export type WebviewMessageHandler = (message: WebviewMessage) => void;

export interface WebviewHostOptions {
  /** `viewType` of the panel; each flow uses its own so panels are independent. */
  viewType: string;
  title: string;
  payloadRoot: vscode.Uri;
  /** Absolute URI of the bundled JavaScript backend (`dist/web-runhost.js`). */
  javascriptUri: vscode.Uri;
  /** Optional sink for panel diagnostics (resource failures, lifecycle). */
  log?: (line: string) => void;
}

/** Absolute URI of the staged Blazor entry script, for error messages. */
export function blazorPayloadEntry(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.extensionUri, ...PAYLOAD_SEGMENTS, ...ENTRY_SEGMENTS);
}

/** Absolute URI of the bundled JavaScript backend, for error messages. */
export function javascriptPayloadEntry(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.extensionUri, ...JAVASCRIPT_SEGMENTS);
}

/** Root folder of the staged Blazor payload, or undefined when it is missing. */
export async function resolveBlazorPayload(context: vscode.ExtensionContext): Promise<vscode.Uri | undefined> {
  const root = vscode.Uri.joinPath(context.extensionUri, ...PAYLOAD_SEGMENTS);
  try {
    // workspace.fs works for extension resources in web extension hosts.
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ...ENTRY_SEGMENTS));
    return root;
  } catch {
    return undefined;
  }
}

/** Bundled JavaScript backend URI, or undefined when the bundle is missing. */
export async function resolveJavaScriptPayload(context: vscode.ExtensionContext): Promise<vscode.Uri | undefined> {
  const javascript = vscode.Uri.joinPath(context.extensionUri, ...JAVASCRIPT_SEGMENTS);
  try {
    await vscode.workspace.fs.stat(javascript);
    return javascript;
  } catch {
    return undefined;
  }
}

/**
 * One webview panel plus the host side of its message channel. The page keeps
 * posting `{ type: "ready" }` after load; consumers can await it via
 * {@link whenReady} or subscribe to every page message with {@link onMessage}.
 */
export class BlazorWebviewHost implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly payloadRoot: vscode.Uri;
  private readonly handlers = new Set<WebviewMessageHandler>();
  private readonly disposeHandlers = new Set<() => void>();
  private readonly readyWaiters: Array<(ready: boolean) => void> = [];
  private readonly logSink: ((line: string) => void) | undefined;
  private ready = false;
  private disposed = false;

  public constructor(context: vscode.ExtensionContext, options: WebviewHostOptions) {
    this.payloadRoot = options.payloadRoot;
    this.logSink = options.log;
    this.panel = vscode.window.createWebviewPanel(
      options.viewType,
      options.title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [options.payloadRoot, vscode.Uri.joinPath(context.extensionUri, ...DIST_SEGMENTS)],
        // Keeps the WebAssembly runtime (and therefore the graphics scene) alive
        // while the user switches between editors.
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = buildWebviewHtml({
      cspSource: this.panel.webview.cspSource,
      payloadUri: this.panel.webview.asWebviewUri(options.payloadRoot).toString(),
      javascriptUri: this.panel.webview.asWebviewUri(options.javascriptUri).toString()
    });

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage | undefined) => this.handleMessage(message),
      undefined,
      context.subscriptions
    );

    this.panel.onDidDispose(
      () => this.handleDispose(),
      undefined,
      context.subscriptions
    );
  }

  public get webview(): vscode.Webview {
    return this.panel.webview;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  public onMessage(handler: WebviewMessageHandler): vscode.Disposable {
    this.handlers.add(handler);
    return new vscode.Disposable(() => this.handlers.delete(handler));
  }

  public onDispose(handler: () => void): vscode.Disposable {
    this.disposeHandlers.add(handler);
    return new vscode.Disposable(() => this.disposeHandlers.delete(handler));
  }

  public post(message: unknown): void {
    if (!this.disposed) {
      void this.panel.webview.postMessage(message);
    }
  }

  public reveal(): void {
    if (!this.disposed) {
      this.panel.reveal(this.panel.viewColumn, true);
    }
  }

  /** Resolves true once the page signalled `ready`, false when it never did. */
  public whenReady(timeoutMs: number): Promise<boolean> {
    if (this.ready) {
      return Promise.resolve(true);
    }

    if (this.disposed) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.readyWaiters.push(finish);
    });
  }

  public dispose(): void {
    this.panel.dispose();
  }

  private log(line: string): void {
    this.logSink?.(line);
  }

  private handleMessage(message: WebviewMessage | undefined): void {
    if (!message || typeof message.type !== "string") {
      return;
    }

    if (message.type === "resource-request") {
      void this.provideResource(message);
      return;
    }

    if (message.type === "ready") {
      this.ready = true;
      for (const waiter of this.readyWaiters.splice(0)) {
        waiter(true);
      }
    }

    for (const handler of [...this.handlers]) {
      handler(message);
    }
  }

  private handleDispose(): void {
    this.disposed = true;
    for (const waiter of this.readyWaiters.splice(0)) {
      waiter(false);
    }

    for (const handler of [...this.disposeHandlers]) {
      handler();
    }

    this.handlers.clear();
    this.disposeHandlers.clear();
    this.log("[webview] closed");
  }

  /**
   * Reads a Blazor boot resource in the extension host and transfers it to the
   * webview. Marketplace web extensions are served from vscode-unpkg.net, whose
   * binary responses are not CORS-readable by the isolated vscode-cdn.net
   * webview. `workspace.fs` is the supported extension-resource channel and does
   * not depend on the marketplace CDN granting the webview cross-origin access.
   */
  private async provideResource(message: WebviewMessage): Promise<void> {
    const requestId = message.requestId;
    if (typeof requestId !== "string" || requestId.length === 0) {
      return;
    }

    try {
      const resource = this.resolvePayloadResource(message.path);
      if (!resource) {
        throw new Error(`非法的 Blazor 资源路径：${String(message.path ?? "")}`);
      }

      const bytes = await vscode.workspace.fs.readFile(resource);
      // VS Code >= 1.57 transfers nested ArrayBuffers efficiently. Slice to the
      // exact view because a Uint8Array is allowed to share a larger backing store.
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await this.panel.webview.postMessage({ type: "resource-response", requestId, ok: true, data });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.log(`[resource] ${message.path ?? "<missing>"}: ${text}`);
      await this.panel.webview.postMessage({ type: "resource-response", requestId, ok: false, error: text });
    }
  }

  /** Keeps webview resource requests inside runhost/blazor/wwwroot. */
  private resolvePayloadResource(requestedPath: string | undefined): vscode.Uri | undefined {
    if (typeof requestedPath !== "string" || requestedPath.length === 0 || requestedPath.length > 512) {
      return undefined;
    }

    if (requestedPath.includes("\\") || requestedPath.startsWith("/")) {
      return undefined;
    }

    const segments = requestedPath.split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
      return undefined;
    }

    return vscode.Uri.joinPath(this.payloadRoot, ...segments);
  }
}
