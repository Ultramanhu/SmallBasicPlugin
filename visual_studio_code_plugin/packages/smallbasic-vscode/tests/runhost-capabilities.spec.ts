import { describe, expect, it } from "vitest";
import { RUN_HOST_CAPABILITIES, supportsFunctionCapability, supportsRequiredCapabilities } from "../src/run/capabilities";

describe("RunHost capability handshake", () => {
  it("accepts the v2 Function-capable host contract", () => {
    expect(RUN_HOST_CAPABILITIES).toEqual({
      protocolVersion: 2,
      capabilities: ["function-v1", "gosub-v1", "error-handling-v1"]
    });
    expect(supportsFunctionCapability(`${JSON.stringify(RUN_HOST_CAPABILITIES)}\n`)).toBe(true);
  });

  it("requires the GoSub and On Error capabilities of the current hosts", () => {
    expect(supportsRequiredCapabilities(`${JSON.stringify(RUN_HOST_CAPABILITIES)}\n`)).toBe(true);
    expect(supportsRequiredCapabilities(
      `{"protocolVersion":2,"capabilities":["function-v1"]}`
    )).toBe(false);
  });

  it.each([
    '{"protocolVersion":1,"capabilities":["function-v1"]}',
    '{"protocolVersion":2,"capabilities":[]}',
    '{"protocolVersion":2,"capabilities":"function-v1"}',
    "not-json"
  ])("rejects an incompatible host response: %s", (response) => {
    expect(supportsFunctionCapability(response)).toBe(false);
  });
});
