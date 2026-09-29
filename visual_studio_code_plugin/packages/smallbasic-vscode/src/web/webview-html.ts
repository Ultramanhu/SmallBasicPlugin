/**
 * HTML document that hosts the JavaScript and Blazor WebAssembly backends inside
 * a VS Code webview (used by src/web/blazor-webview.ts).
 *
 * Kept free of the `vscode` module on purpose: the document is a pure function of
 * the CSP source and the base URI, which keeps it unit-testable and lets the same
 * markup be rendered by a plain static server for manual testing.
 */

export interface WebviewHtmlOptions {
  /**
   * `webview.cspSource` of the panel (or the origin of the payload when the page
   * is served by a plain static server for testing).
   */
  cspSource: string;

  /**
   * Absolute URL of the Blazor payload folder (`runhost/blazor/wwwroot` mapped
   * through `webview.asWebviewUri`), for example
   * `https://<id>.vscode-cdn.net/extensions/.../runhost/blazor/wwwroot`.
   *
   * Everything below is referenced as an absolute URL under this folder and the
   * document deliberately has **no `<base>` element**: Blazor validates at startup
   * that the current location is contained by `document.baseURI`, and pointing the
   * base at the payload host (a different origin than the webview document) makes
   * that check throw
   * "The URI ... is not contained by the base URI ...".
   * Without `<base>` the base URI is the document URL itself, which always
   * contains the location, and the runtime resolves its own resources relative to
   * `_framework/dotnet.js` - see the `loadBootResource` hook in
   * visual_studio_plugin/src/SmallBasic.Blazor.Client/wwwroot/vscode-webview.js.
   */
  payloadUri: string;

  /** Absolute webview URI of the bundled browser JavaScript runtime. */
  javascriptUri: string;

  title?: string;
}

/**
 * The webview CSP has to allow three things the VS Code default template does not
 * mention:
 *
 * - `connect-src`: `dotnet.js` fetches the boot resources with `fetch()`. With
 *   `default-src 'none'` (the recommended baseline) every fetch is blocked unless
 *   `connect-src` is present.
 * - `'wasm-unsafe-eval'`: required to compile WebAssembly; without it Chromium and
 *   Firefox refuse the instantiation. Safari (and older browsers) do not support
 *   this keyword and need `'unsafe-eval'`, which is therefore included as well.
 * - `style-src ... 'unsafe-inline'`: the runner renders SVG geometry with `style`
 *   attributes (for example the GraphicsWindow visibility) and Blazor emits them
 *   for dynamic values. Scripts stay strict (`'unsafe-inline'` is *not* granted to
 *   `script-src`), and the page only loads extension-owned resources under
 *   `localResourceRoots` while `default-src 'none'` keeps everything else out.
 */
export function buildContentSecurityPolicy(cspSource: string): string {
  return [
    "default-src 'none'",
    `script-src ${cspSource} 'wasm-unsafe-eval' 'unsafe-eval'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: https:`,
    `font-src ${cspSource}`,
    `connect-src ${cspSource}`,
    `worker-src ${cspSource} blob:`
  ].join("; ");
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const title = options.title ?? "Small Basic (Web)";
  const payload = options.payloadUri.endsWith("/") ? options.payloadUri.slice(0, -1) : options.payloadUri;

  // No inline script or style anywhere: the CSP above only allows the webview's
  // own resources, and the glue lives in vscode-webview.js next to this markup.
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${buildContentSecurityPolicy(options.cspSource)}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="${payload}/app.css" />
</head>
<body>
<div class="web-runhost" id="web-runhost">
<section class="web-pane web-output-pane" id="output-pane">
<div class="web-pane-header">
<span class="web-pane-title">Small Basic</span>
<span class="web-pane-note" id="output-note"></span>
</div>
<pre class="web-console" id="console" hidden></pre>
<form class="web-input-row" hidden id="input-row">
<span id="input-prompt">Read</span>
<input autocomplete="off" id="input-field" type="text" />
<button type="submit">Send</button>
</form>
<div class="web-blazor-host" id="blazor-host">
<div id="app"></div>
</div>
<div class="web-diagnostics" hidden id="diagnostics"></div>
</section>
</div>
<div id="blazor-error-ui">
运行 Small Basic Blazor WASM 后端时发生未处理的错误。
<span class="dismiss">🗙</span>
</div>
<script src="${options.javascriptUri}"></script>
<script src="${payload}/_framework/blazor.webassembly.js" autostart="false"></script>
<script src="${payload}/vscode-webview.js"></script>
</body>
</html>
`;
}
