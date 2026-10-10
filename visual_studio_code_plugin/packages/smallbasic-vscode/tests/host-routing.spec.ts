import { describe, expect, it } from "vitest";
import { normalizeLaunchMode, routeWebHostLaunch } from "../src/web/run-routing";

describe("web host launch routing (cli and web modes)", () => {
  it("debugs cli + JavaScript in the extension host, without a webview", () => {
    expect(routeWebHostLaunch({ mode: "cli", backend: "javascript" }, false)).toEqual({
      kind: "inline-debug",
      surface: "extension-host",
      backend: "javascript"
    });
  });

  it("runs cli + JavaScript without debugging in an extension-host terminal", () => {
    expect(routeWebHostLaunch({ mode: "cli", backend: "javascript", noDebug: true }, false)).toEqual({
      kind: "run-in-extension-host",
      backend: "javascript"
    });
  });

  it("defaults cli to the JavaScript backend, which needs no local process", () => {
    expect(normalizeLaunchMode("cli")).toBe("cli");
    expect(routeWebHostLaunch({ mode: "cli" }, false)).toEqual({
      kind: "inline-debug",
      surface: "extension-host",
      backend: "javascript"
    });
    expect(routeWebHostLaunch({ mode: "cli", noDebug: true }, false)).toEqual({
      kind: "run-in-extension-host",
      backend: "javascript"
    });
  });

  it("refuses cli C#, which cannot run in a browser at all", () => {
    const routing = routeWebHostLaunch({ mode: "cli", backend: "csharp" }, false);
    expect(routing.kind).toBe("reject");
    expect(routing.kind === "reject" && routing.message).toContain("本机 RunHost");
    expect(routeWebHostLaunch({ mode: "cli", backend: "csharp", noDebug: true }, false).kind).toBe("reject");
  });

  it("keeps the webview fallback for cli Blazor and says so", () => {
    expect(routeWebHostLaunch({ mode: "cli", backend: "blazor" }, false)).toEqual({
      kind: "inline-debug",
      surface: "webview",
      backend: "blazor",
      note: expect.stringContaining("Web 模式")
    });
    expect(routeWebHostLaunch({ mode: "cli", backend: "blazor", noDebug: true }, true)).toEqual({
      kind: "run-in-webview",
      backend: "blazor",
      note: expect.stringContaining("Webview")
    });
  });

  it("keeps the web-mode result for a cli JavaScript graphics program", () => {
    // F5 is refused with the graphics message, Ctrl+F5 falls back to Blazor -
    // exactly what an explicit mode: "web" + backend: "javascript" does.
    const debug = routeWebHostLaunch({ mode: "cli", backend: "javascript" }, true);
    expect(debug.kind).toBe("reject");
    expect(debug.kind === "reject" && debug.message).toContain("GraphicsWindow");

    expect(routeWebHostLaunch({ mode: "cli", backend: "javascript", noDebug: true }, true)).toEqual({
      kind: "run-in-webview",
      backend: "blazor",
      note: expect.stringContaining("JavaScript 后端无法运行")
    });
  });

  it("keeps the web-mode table unchanged", () => {
    expect(routeWebHostLaunch({ mode: "web", backend: "javascript" }, false)).toEqual({
      kind: "inline-debug",
      surface: "webview",
      backend: "javascript"
    });
    expect(routeWebHostLaunch({ mode: "web", backend: "javascript", noDebug: true }, false)).toEqual({
      kind: "run-in-webview",
      backend: "javascript",
      note: undefined
    });
    expect(routeWebHostLaunch({ mode: "web", backend: "blazor" }, true)).toEqual({
      kind: "inline-debug",
      surface: "webview",
      backend: "blazor"
    });
    expect(routeWebHostLaunch({ mode: "web" }, true)).toEqual({
      kind: "inline-debug",
      surface: "webview",
      backend: "blazor"
    });
    expect(routeWebHostLaunch({ mode: "web", backend: "csharp" }, false).kind).toBe("reject");
  });

  it("treats an unspecified mode as web, so the browser default is unchanged", () => {
    expect(normalizeLaunchMode(undefined)).toBe("web");
    expect(normalizeLaunchMode("nonsense")).toBe("web");
    expect(routeWebHostLaunch({ backend: "javascript" }, false)).toEqual({
      kind: "inline-debug",
      surface: "webview",
      backend: "javascript"
    });
    expect(routeWebHostLaunch({ noDebug: true }, true)).toEqual({
      kind: "run-in-webview",
      backend: "blazor",
      note: undefined
    });
  });
});
