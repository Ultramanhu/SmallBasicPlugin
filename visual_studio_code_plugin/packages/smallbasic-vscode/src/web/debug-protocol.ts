/**
 * The web debug protocol: the message contract between the browser-compatible
 * DAP adapter in the extension host and the Small Basic runtime in the webview
 * (`SmallBasic.Blazor.Client` WebAssembly, see
 * visual_studio_plugin/src/SmallBasic.Blazor.Client/Runtime/WebRunHost.cs).
 *
 * It is the same shape as the CLI bridge (`HostMessage` / `BrowserMessage` in
 * `SmallBasic.Blazor.Shared/Protocol.cs`) with an envelope added so that a
 * message can be safely relayed across extension host → webview → WASM:
 *
 *   - every message carries `protocolVersion` and `sessionId`; a message that
 *     names another session (a late message from a run that already ended) is
 *     dropped instead of applied to the wrong program;
 *   - commands that need an answer carry `requestId`, and the runtime replies
 *     with the same `requestId` (at least `setBreakpoints` and `terminate`);
 *   - all source lines on the wire are **0-based**; the DAP boundary converts to
 *     and from the 1-based protocol DAP uses;
 *   - commands are `start`, `setBreakpoints`, `control` (continue/pause/next/
 *     stepIn/stepOut), `input` and `stop` (terminate);
 *   - events are `ready`, `breakpointsValidated`, `output`, `stopped`, `input`,
 *     `terminated` and `error`.
 *
 * This module deliberately has no `vscode` and no Node.js dependency: it is
 * bundled into both the desktop (Node) and the Web Worker extension host, and is
 * unit-testable without either. The C# side mirrors the same JSON, and
 * `tests/debug-protocol.spec.ts` pins the wire shape so the two cannot drift
 * silently.
 */

/** Bumped whenever the wire shape changes incompatibly. */
export const DEBUG_PROTOCOL_VERSION = 1;

/** Milliseconds a `setBreakpoints` / `terminate` round trip may take. */
export const DEBUG_REQUEST_TIMEOUT_MS = 15_000;

/** Milliseconds `launch` may take to reach `ready` (WASM boot included). */
export const DEBUG_LAUNCH_TIMEOUT_MS = 120_000;

export type WebDebugControl = "continue" | "pause" | "next" | "stepIn" | "stepOut";

export function isDebugControl(value: unknown): value is WebDebugControl {
  return value === "continue" || value === "pause" || value === "next" || value === "stepIn" || value === "stepOut";
}

/** One frame of the call stack, 0-based line. */
export interface WebDebugFrame {
  name: string;
  line: number;
}

/** One variable, optionally with an array's children (recursive DTO). */
export interface WebDebugVariable {
  name: string;
  value: string;
  children: WebDebugVariable[];
}

/* ------------------------------------------------------------------ commands */

export interface StartDebugCommand {
  readonly kind: "start";
  /** Breakpoint lines that were already validated (0-based); may be empty. */
  readonly breakpoints: readonly number[];
}

export interface SetBreakpointsCommand {
  readonly kind: "setBreakpoints";
  readonly requestId: string;
  /** Requested lines, 0-based; the runtime snaps them to executable lines. */
  readonly lines: readonly number[];
  /**
   * Optional condition per line (`undefined`/empty = unconditional),
   * positionally aligned with {@link lines}. Only the JavaScript runtime
   * evaluates conditions (Blazor aligns with `SmallBasic.Blazor.RunHost`, which
   * has none yet), and the field is ignored by runtime versions that do not
   * know it.
   */
  readonly conditions?: readonly (string | undefined)[];
}

export interface ControlDebugCommand {
  readonly kind: "control";
  readonly control: WebDebugControl;
  /** Stack depth when the control was requested, for next/stepOut. */
  readonly depth: number;
}

export interface InputDebugCommand {
  readonly kind: "input";
  readonly text: string;
}

export interface TerminateDebugCommand {
  readonly kind: "terminate";
  readonly requestId: string;
}

export type WebDebugCommand =
  | StartDebugCommand
  | SetBreakpointsCommand
  | ControlDebugCommand
  | InputDebugCommand
  | TerminateDebugCommand;

/* -------------------------------------------------------------------- events */

export interface ReadyEvent {
  readonly kind: "ready";
}

export interface BreakpointsValidatedEvent {
  readonly kind: "breakpointsValidated";
  readonly requestId: string;
  /** Actual executable lines the runtime accepted, 0-based. */
  readonly lines: readonly number[];
}

export interface OutputEvent {
  readonly kind: "output";
  readonly text: string;
}

export interface StoppedEvent {
  readonly kind: "stopped";
  readonly reason: string;
  readonly line: number;
  readonly frames: readonly WebDebugFrame[];
  readonly variables: readonly WebDebugVariable[];
}

export interface InputRequestedEvent {
  readonly kind: "input";
  readonly numberInput: boolean;
  readonly line: number;
  readonly frames: readonly WebDebugFrame[];
  readonly variables: readonly WebDebugVariable[];
}

export interface TerminatedEvent {
  readonly kind: "terminated";
  readonly exitCode: number;
}

export interface ErrorEvent {
  readonly kind: "error";
  readonly message: string;
}

export type WebDebugEvent =
  | ReadyEvent
  | BreakpointsValidatedEvent
  | OutputEvent
  | StoppedEvent
  | InputRequestedEvent
  | TerminatedEvent
  | ErrorEvent;

/* --------------------------------------------------------------------- wire */

/** The JSON the runtime (`DispatchDebugCommand`) deserializes. */
interface WireHostCommand {
  protocolVersion: number;
  sessionId: string;
  type: string;
  requestId?: string;
  control?: string;
  depth?: number;
  breakpoints?: number[];
  conditions?: string[];
  text?: string;
}

/** The JSON the runtime (`SmallBasicWebHost.notify`) emits. */
interface WireRuntimeEvent {
  protocolVersion?: number;
  sessionId?: string;
  type?: string;
  requestId?: string;
  reason?: string;
  text?: string;
  line?: number;
  exitCode?: number;
  numberInput?: boolean;
  frames?: unknown;
  variables?: unknown;
  breakpoints?: unknown;
  message?: string;
}

/** Serializes a command into the JSON the webview forwards to `DispatchDebugCommand`. */
export function encodeHostCommand(sessionId: string, command: WebDebugCommand): string {
  const wire: WireHostCommand = {
    protocolVersion: DEBUG_PROTOCOL_VERSION,
    sessionId,
    type: wireTypeOf(command)
  };

  switch (command.kind) {
    case "start":
      wire.breakpoints = [...command.breakpoints];
      break;
    case "setBreakpoints":
      wire.requestId = command.requestId;
      wire.breakpoints = [...command.lines];
      if (command.conditions?.some((condition) => !!condition)) {
        wire.conditions = command.lines.map((_line, index) => command.conditions?.[index] ?? "");
      }

      break;
    case "control":
      wire.control = command.control;
      wire.depth = command.depth;
      break;
    case "input":
      wire.text = command.text;
      break;
    case "terminate":
      wire.requestId = command.requestId;
      break;
  }

  return JSON.stringify(wire);
}

function wireTypeOf(command: WebDebugCommand): string {
  switch (command.kind) {
    case "start":
      return "start";
    case "setBreakpoints":
      return "setBreakpoints";
    case "control":
      return "control";
    case "input":
      return "input";
    case "terminate":
      // The runtime (and the CLI bridge) already use "stop" for termination.
      return "stop";
  }
}

/**
 * Parses a runtime event emitted through `SmallBasicWebHost.notify` and returns
 * the semantic event, or `undefined` when the message is not a valid event for
 * `sessionId` (unknown version, unknown type, wrong session or malformed field).
 */
export function decodeRuntimeEvent(json: string | undefined, sessionId: string): WebDebugEvent | undefined {
  if (!json) {
    return undefined;
  }

  let wire: WireRuntimeEvent;
  try {
    wire = JSON.parse(json) as WireRuntimeEvent;
  } catch {
    return undefined;
  }

  if (!wire || typeof wire !== "object") {
    return undefined;
  }

  if (wire.protocolVersion !== undefined && wire.protocolVersion !== DEBUG_PROTOCOL_VERSION) {
    return undefined;
  }

  // `ready` is published before the runner knows its descriptor, so the runtime
  // may omit the session id there; every other event must name this session.
  if (wire.type !== "ready" && wire.sessionId !== sessionId) {
    return undefined;
  }

  switch (wire.type) {
    case "ready":
      return { kind: "ready" };
    case "breakpointsValidated":
      return typeof wire.requestId === "string"
        ? { kind: "breakpointsValidated", requestId: wire.requestId, lines: toLines(wire.breakpoints) }
        : undefined;
    case "output":
      return typeof wire.text === "string" ? { kind: "output", text: wire.text } : undefined;
    case "stopped":
      return { kind: "stopped", reason: wire.reason ?? "pause", line: lineOf(wire.line), frames: toFrames(wire.frames), variables: toVariables(wire.variables) };
    case "input":
      return { kind: "input", numberInput: wire.numberInput === true, line: lineOf(wire.line), frames: toFrames(wire.frames), variables: toVariables(wire.variables) };
    case "terminated":
      return { kind: "terminated", exitCode: typeof wire.exitCode === "number" ? wire.exitCode : 0 };
    case "error":
      return typeof wire.message === "string" ? { kind: "error", message: wire.message } : undefined;
    default:
      return undefined;
  }
}

function lineOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function toLines(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry)).map((entry) => Math.max(0, Math.trunc(entry)));
}

function toFrames(value: unknown): WebDebugFrame[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is { name?: unknown; line?: unknown } => !!entry && typeof entry === "object")
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "Program",
      line: lineOf(entry.line)
    }));
}

function toVariables(value: unknown): WebDebugVariable[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is { name?: unknown; value?: unknown; children?: unknown } => !!entry && typeof entry === "object")
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "?",
      value: typeof entry.value === "string" ? entry.value : String(entry.value ?? ""),
      children: toVariables(entry.children)
    }));
}
