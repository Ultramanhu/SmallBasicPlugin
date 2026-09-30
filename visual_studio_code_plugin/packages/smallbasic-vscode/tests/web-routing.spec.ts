import { describe, expect, it } from "vitest";
import { routeWebDebugRequest } from "../src/web/run-routing";

describe("web run/debug routing", () => {
  it("debugs text programs with the inline JavaScript adapter and runs them in the webview", () => {
    expect(routeWebDebugRequest({ backend: "javascript" }, false)).toEqual({ kind: "inline-debug", backend: "javascript" });
    expect(routeWebDebugRequest({ backend: "javascript", noDebug: true }, false)).toEqual({
      kind: "run-in-webview",
      backend: "javascript",
      note: undefined
    });
  });

  it("infers the backend from the program when none was configured", () => {
    expect(routeWebDebugRequest({}, false)).toEqual({ kind: "inline-debug", backend: "javascript" });
    expect(routeWebDebugRequest({ noDebug: true }, true)).toEqual({
      kind: "run-in-webview",
      backend: "blazor",
      note: undefined
    });
    // A graphics program without an explicit backend is debugged on Blazor.
    expect(routeWebDebugRequest({}, true)).toEqual({ kind: "inline-debug", backend: "blazor" });
  });

  it("debugs Blazor requests through the inline Blazor adapter (F5)", () => {
    expect(routeWebDebugRequest({ backend: "blazor" }, false)).toEqual({ kind: "inline-debug", backend: "blazor" });
    expect(routeWebDebugRequest({ backend: "blazor" }, true)).toEqual({ kind: "inline-debug", backend: "blazor" });
  });

  it("runs Blazor requests from Run Without Debugging in the webview (Ctrl+F5)", () => {
    expect(routeWebDebugRequest({ backend: "blazor", noDebug: true }, false)).toEqual({
      kind: "run-in-webview",
      backend: "blazor",
      note: undefined
    });
    expect(routeWebDebugRequest({ backend: "blazor", noDebug: true }, true)).toEqual({
      kind: "run-in-webview",
      backend: "blazor",
      note: undefined
    });
  });

  it("refuses to debug a graphics program when JavaScript was requested explicitly", () => {
    const routing = routeWebDebugRequest({ backend: "javascript" }, true);
    expect(routing.kind).toBe("reject");
    expect(routing.kind === "reject" && routing.message).toContain("GraphicsWindow");
  });

  it("falls back to the webview for graphics programs on Ctrl+F5 and says so", () => {
    expect(routeWebDebugRequest({ backend: "javascript", noDebug: true }, true)).toEqual({
      kind: "run-in-webview",
      backend: "blazor",
      note: expect.stringContaining("JavaScript 后端无法运行")
    });
  });

  it("rejects the local C# host and treats unknown backends as unspecified", () => {
    expect(routeWebDebugRequest({ backend: "csharp", noDebug: true }, true).kind).toBe("reject");
    expect(routeWebDebugRequest({ backend: "csharp" }, false).kind).toBe("reject");
    expect(routeWebDebugRequest({ backend: "nonsense" }, false)).toEqual({ kind: "inline-debug", backend: "javascript" });
    expect(routeWebDebugRequest({ backend: "nonsense", noDebug: true }, true)).toEqual({
      kind: "run-in-webview",
      backend: "blazor",
      note: undefined
    });
  });
});
