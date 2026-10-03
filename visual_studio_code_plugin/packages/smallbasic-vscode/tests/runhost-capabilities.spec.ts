import { describe, expect, it } from "vitest";
import { RUN_HOST_CAPABILITIES, supportsFunctionCapability } from "../src/run/capabilities";

describe("RunHost capability handshake", () => {
  it("accepts the v2 Function-capable host contract", () => {
    expect(RUN_HOST_CAPABILITIES).toEqual({
      protocolVersion: 2,
      capabilities: ["function-v1"]
    });
    expect(supportsFunctionCapability(`${JSON.stringify(RUN_HOST_CAPABILITIES)}\n`)).toBe(true);
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
