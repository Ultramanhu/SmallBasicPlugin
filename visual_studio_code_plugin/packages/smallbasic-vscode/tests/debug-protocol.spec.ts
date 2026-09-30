import { describe, expect, it } from "vitest";
import {
  DEBUG_PROTOCOL_VERSION,
  decodeRuntimeEvent,
  encodeHostCommand,
  isDebugControl,
  type WebDebugCommand
} from "../src/web/debug-protocol";

const SESSION = "session-1";

describe("web debug protocol", () => {
  describe("host commands", () => {
    it("stamps the protocol version and session id on every command", () => {
      for (const command of allCommands()) {
        const wire = JSON.parse(encodeHostCommand(SESSION, command)) as Record<string, unknown>;
        // This literal is the contract with SmallBasic.Blazor.Shared/Protocol.cs:
        // the C# side deserializes the same camelCase JSON.
        expect(wire.protocolVersion).toBe(DEBUG_PROTOCOL_VERSION);
        expect(wire.sessionId).toBe(SESSION);
        expect(typeof wire.type).toBe("string");
      }
    });

    it("encodes start with the validated breakpoint lines", () => {
      expect(JSON.parse(encodeHostCommand(SESSION, { kind: "start", breakpoints: [0, 2] }))).toEqual({
        protocolVersion: DEBUG_PROTOCOL_VERSION,
        sessionId: SESSION,
        type: "start",
        breakpoints: [0, 2]
      });
    });

    it("encodes setBreakpoints as request/response and keeps 0-based lines", () => {
      expect(JSON.parse(encodeHostCommand(SESSION, { kind: "setBreakpoints", requestId: "r1", lines: [1, 4] }))).toEqual({
        protocolVersion: DEBUG_PROTOCOL_VERSION,
        sessionId: SESSION,
        type: "setBreakpoints",
        requestId: "r1",
        breakpoints: [1, 4]
      });
    });

    it("carries conditional breakpoints aligned with the lines (JavaScript only)", () => {
      expect(JSON.parse(encodeHostCommand(SESSION, {
        kind: "setBreakpoints",
        requestId: "r1",
        lines: [1, 4],
        conditions: [undefined, "i = 3"]
      }))).toEqual({
        protocolVersion: DEBUG_PROTOCOL_VERSION,
        sessionId: SESSION,
        type: "setBreakpoints",
        requestId: "r1",
        breakpoints: [1, 4],
        conditions: ["", "i = 3"]
      });

      // No condition anywhere: the field stays out so older runtimes see the
      // exact payload they already handle.
      expect(JSON.parse(encodeHostCommand(SESSION, {
        kind: "setBreakpoints",
        requestId: "r1",
        lines: [1],
        conditions: [undefined]
      }))).not.toHaveProperty("conditions");
    });

    it("encodes the run controls under a single control command", () => {
      expect(JSON.parse(encodeHostCommand(SESSION, { kind: "control", control: "stepOut", depth: 3 }))).toEqual({
        protocolVersion: DEBUG_PROTOCOL_VERSION,
        sessionId: SESSION,
        type: "control",
        control: "stepOut",
        depth: 3
      });
    });

    it("encodes input and terminate (stop) with a request id", () => {
      expect(JSON.parse(encodeHostCommand(SESSION, { kind: "input", text: "42" }))).toEqual({
        protocolVersion: DEBUG_PROTOCOL_VERSION,
        sessionId: SESSION,
        type: "input",
        text: "42"
      });
      expect(JSON.parse(encodeHostCommand(SESSION, { kind: "terminate", requestId: "r2" }))).toEqual({
        protocolVersion: DEBUG_PROTOCOL_VERSION,
        sessionId: SESSION,
        type: "stop",
        requestId: "r2"
      });
    });
  });

  describe("runtime events", () => {
    it("accepts ready even without a session id (published before the descriptor)", () => {
      expect(decodeRuntimeEvent(JSON.stringify({ type: "ready" }), SESSION)).toEqual({ kind: "ready" });
      expect(decodeRuntimeEvent(JSON.stringify({ protocolVersion: DEBUG_PROTOCOL_VERSION, type: "ready" }), SESSION)).toEqual({ kind: "ready" });
    });

    it("returns the validated lines for setBreakpoints", () => {
      const event = decodeRuntimeEvent(
        JSON.stringify({ protocolVersion: DEBUG_PROTOCOL_VERSION, sessionId: SESSION, type: "breakpointsValidated", requestId: "r1", breakpoints: [2, 5] }),
        SESSION
      );
      expect(event).toEqual({ kind: "breakpointsValidated", requestId: "r1", lines: [2, 5] });
    });

    it("maps stopped / input snapshots including nested array variables", () => {
      const event = decodeRuntimeEvent(
        JSON.stringify({
          protocolVersion: DEBUG_PROTOCOL_VERSION,
          sessionId: SESSION,
          type: "stopped",
          reason: "breakpoint",
          line: 3,
          frames: [{ name: "Program", line: 3 }],
          variables: [{ name: "a", value: "1", children: [{ name: "0", value: "9" }] }]
        }),
        SESSION
      );
      expect(event).toEqual({
        kind: "stopped",
        reason: "breakpoint",
        line: 3,
        frames: [{ name: "Program", line: 3 }],
        variables: [{ name: "a", value: "1", children: [{ name: "0", value: "9", children: [] }] }]
      });

      const input = decodeRuntimeEvent(
        JSON.stringify({ sessionId: SESSION, type: "input", numberInput: true, line: 1 }),
        SESSION
      );
      expect(input).toMatchObject({ kind: "input", numberInput: true, line: 1, frames: [], variables: [] });
    });

    it("maps output, terminated and error", () => {
      expect(decodeRuntimeEvent(JSON.stringify({ sessionId: SESSION, type: "output", text: "hi" }), SESSION))
        .toEqual({ kind: "output", text: "hi" });
      expect(decodeRuntimeEvent(JSON.stringify({ sessionId: SESSION, type: "terminated", exitCode: 3 }), SESSION))
        .toEqual({ kind: "terminated", exitCode: 3 });
      expect(decodeRuntimeEvent(JSON.stringify({ sessionId: SESSION, type: "terminated" }), SESSION))
        .toEqual({ kind: "terminated", exitCode: 0 });
      expect(decodeRuntimeEvent(JSON.stringify({ sessionId: SESSION, type: "error", message: "boom" }), SESSION))
        .toEqual({ kind: "error", message: "boom" });
    });
  });

  describe("isolation and malformed messages", () => {
    it("drops messages from another session, another version or unknown types", () => {
      expect(decodeRuntimeEvent(JSON.stringify({ sessionId: "other", type: "output", text: "x" }), SESSION)).toBeUndefined();
      expect(decodeRuntimeEvent(JSON.stringify({ protocolVersion: 99, sessionId: SESSION, type: "output", text: "x" }), SESSION)).toBeUndefined();
      expect(decodeRuntimeEvent(JSON.stringify({ sessionId: SESSION, type: "nonsense" }), SESSION)).toBeUndefined();
      expect(decodeRuntimeEvent(JSON.stringify({ sessionId: SESSION, type: "breakpointsValidated" }), SESSION)).toBeUndefined();
      expect(decodeRuntimeEvent(JSON.stringify({ sessionId: SESSION, type: "stopped" }), SESSION))
        .toEqual({ kind: "stopped", reason: "pause", line: 0, frames: [], variables: [] });
    });

    it("survives malformed JSON and missing payloads", () => {
      expect(decodeRuntimeEvent("{not json", SESSION)).toBeUndefined();
      expect(decodeRuntimeEvent(undefined, SESSION)).toBeUndefined();
      expect(decodeRuntimeEvent("null", SESSION)).toBeUndefined();
    });

    it("recognizes the run controls", () => {
      for (const control of ["continue", "pause", "next", "stepIn", "stepOut"]) {
        expect(isDebugControl(control)).toBe(true);
      }

      expect(isDebugControl("stop")).toBe(false);
      expect(isDebugControl(42)).toBe(false);
    });
  });
});

function allCommands(): WebDebugCommand[] {
  return [
    { kind: "start", breakpoints: [] },
    { kind: "setBreakpoints", requestId: "r", lines: [] },
    { kind: "control", control: "continue", depth: 0 },
    { kind: "input", text: "" },
    { kind: "terminate", requestId: "r" }
  ];
}
