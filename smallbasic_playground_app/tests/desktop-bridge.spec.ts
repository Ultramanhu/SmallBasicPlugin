import { afterEach, describe, expect, it } from "vitest";
import { isTauriRuntime } from "../src/desktop-bridge";

const runtimeGlobals = globalThis as { window?: unknown };

afterEach(() => {
  delete runtimeGlobals.window;
});

describe("desktop runtime detection", () => {
  it("reports Tauri only when the IPC bridge is injected", () => {
    runtimeGlobals.window = { __TAURI_INTERNALS__: {} };
    expect(isTauriRuntime()).toBe(true);
  });

  it("keeps the browser build on the web backends", () => {
    runtimeGlobals.window = { document: {}, fetch: () => undefined };
    expect(isTauriRuntime()).toBe(false);
  });

  it("is safe when there is no window at all", () => {
    expect(isTauriRuntime()).toBe(false);
  });
});
