import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, buildWebviewHtml } from "../src/web/webview-html";

const CSP_SOURCE = "https://file+.vscode-resource.vscode-cdn.net";
const PAYLOAD = `${CSP_SOURCE}/extensions/ultramanhu.smallbasic-tools-vsc-0.1.3/runhost/blazor/wwwroot`;

describe("Blazor webview document", () => {
  it("allows wasm instantiation, the boot fetches and Blazor's inline styles", () => {
    const csp = buildContentSecurityPolicy(CSP_SOURCE);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain(`connect-src ${CSP_SOURCE}`);
    expect(csp).toContain(`style-src ${CSP_SOURCE} 'unsafe-inline'`);
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });

  it("references the payload with absolute URLs and leaves document.baseURI alone", () => {
    const html = buildWebviewHtml({ cspSource: CSP_SOURCE, payloadUri: PAYLOAD });
    expect(html).toContain(`<link rel="stylesheet" href="${PAYLOAD}/app.css" />`);
    expect(html).toContain(`<script src="${PAYLOAD}/_framework/blazor.webassembly.js" autostart="false"></script>`);
    expect(html).toContain(`<script src="${PAYLOAD}/vscode-webview.js"></script>`);
    expect(html).toContain('<div id="app"></div>');

    // A <base href> pointing at the payload host (a different origin than the
    // webview document) makes NavigationManager.ToBaseRelativePath throw during
    // startup: "The URI ... is not contained by the base URI ...".
    expect(html).not.toContain("<base");
  });

  it("tolerates a trailing slash on the payload URI", () => {
    const html = buildWebviewHtml({ cspSource: CSP_SOURCE, payloadUri: `${PAYLOAD}/` });
    expect(html).toContain(`<script src="${PAYLOAD}/_framework/blazor.webassembly.js"`);
    expect(html).not.toContain(`${PAYLOAD}//`);
  });

  it("contains no inline script, so script-src can stay strict", () => {
    const html = buildWebviewHtml({ cspSource: CSP_SOURCE, payloadUri: PAYLOAD });
    expect(/<script(?![^>]*\bsrc=)/i.test(html)).toBe(false);
  });
});
