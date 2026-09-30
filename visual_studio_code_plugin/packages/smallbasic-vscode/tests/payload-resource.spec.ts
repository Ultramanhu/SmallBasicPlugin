import { describe, expect, it } from "vitest";
import { payloadResourceCandidates } from "../src/web/payload-resource";

describe("Blazor payload resource routing", () => {
  it("routes ICU data through the CDN-safe uncompressed alias first", () => {
    expect(payloadResourceCandidates("_framework/icudt_CJK.dat")).toEqual([
      "_framework-webview/icudt_CJK.dat.br",
      "_framework/icudt_CJK.dat"
    ]);
  });

  it("leaves WASM, JSON and JavaScript resources unchanged", () => {
    expect(payloadResourceCandidates("_framework/dotnet.native.wasm")).toEqual([
      "_framework/dotnet.native.wasm"
    ]);
    expect(payloadResourceCandidates("_framework/blazor.boot.json")).toEqual([
      "_framework/blazor.boot.json"
    ]);
  });

  it("rejects absolute and traversing paths", () => {
    expect(payloadResourceCandidates("../outside.dat")).toEqual([]);
    expect(payloadResourceCandidates("_framework/../outside.dat")).toEqual([]);
    expect(payloadResourceCandidates("/_framework/icudt_CJK.dat")).toEqual([]);
    expect(payloadResourceCandidates("_framework\\icudt_CJK.dat")).toEqual([]);
  });
});
