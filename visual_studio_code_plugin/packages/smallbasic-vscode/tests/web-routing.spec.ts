import { describe, expect, it } from "vitest";
import { routeWebDebugRequest } from "../src/web/run-routing";

describe("web run/debug routing", () => {
  it("keeps text programs on the JavaScript backend, with or without a debugger", () => {
    expect(routeWebDebugRequest({ backend: "javascript" }, false)).toEqual({ kind: "javascript" });
    expect(routeWebDebugRequest({ backend: "javascript", noDebug: true }, false)).toEqual({ kind: "javascript" });
  });

  it("infers the backend from the program when none was configured", () => {
    expect(routeWebDebugRequest({}, false)).toEqual({ kind: "javascript" });
    expect(routeWebDebugRequest({ noDebug: true }, true)).toEqual({ kind: "webview", note: undefined });
  });

  it("runs Blazor requests from Run Without Debugging in the webview (Ctrl+F5)", () => {
    expect(routeWebDebugRequest({ backend: "blazor", noDebug: true }, false)).toEqual({
      kind: "webview",
      note: undefined
    });
    expect(routeWebDebugRequest({ backend: "blazor", noDebug: true }, true)).toEqual({
      kind: "webview",
      note: undefined
    });
  });

  it("explains that Blazor cannot be stepped instead of starting a broken session", () => {
    const routing = routeWebDebugRequest({ backend: "blazor" }, false);
    expect(routing.kind).toBe("reject");
    expect(routing.kind === "reject" && routing.message).toContain("Ctrl+F5");
  });

  it("refuses to debug a graphics program even when JavaScript was requested", () => {
    const routing = routeWebDebugRequest({ backend: "javascript" }, true);
    expect(routing.kind).toBe("reject");
    expect(routing.kind === "reject" && routing.message).toContain("GraphicsWindow");
  });

  it("falls back to the webview for graphics programs and says so", () => {
    const routing = routeWebDebugRequest({ backend: "javascript", noDebug: true }, true);
    expect(routing).toEqual({ kind: "webview", note: expect.stringContaining("JavaScript 后端无法运行") });
  });

  it("rejects the local C# host and treats unknown backends as unspecified", () => {
    expect(routeWebDebugRequest({ backend: "csharp", noDebug: true }, true).kind).toBe("reject");
    expect(routeWebDebugRequest({ backend: "nonsense" }, false)).toEqual({ kind: "javascript" });
    expect(routeWebDebugRequest({ backend: "nonsense", noDebug: true }, true)).toEqual({
      kind: "webview",
      note: undefined
    });
  });
});
