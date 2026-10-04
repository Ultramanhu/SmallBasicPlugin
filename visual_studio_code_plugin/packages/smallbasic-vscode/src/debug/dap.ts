import type { DebugProtocol } from "@vscode/debugprotocol";

/**
 * DAP constants and small helpers shared by the DAP adapters (`session.ts`,
 * `webview-debug-adapter.ts`) and the desktop CLI transport, so the protocol
 * conventions (thread id, line basis, error codes) live in exactly one place.
 */

/** The runtime exposes a single thread; every adapter publishes this id. */
export const DEBUG_THREAD_ID = 1;

/** DAP lines are 1-based; every runtime/protocol line in this codebase is 0-based. */
export function toDapLine(protocolLine: number): number {
  return protocolLine + 1;
}

/** Inverse of {@link toDapLine}. */
export function fromDapLine(dapLine: number): number {
  return dapLine - 1;
}

/** `evaluate` error code for expressions the runtime cannot resolve. */
export const EVALUATE_FAILED_ERROR_CODE = 2002;

export function evaluateFailedMessage(expression: string): string {
  return `无法计算表达式: ${expression}`;
}

/** Breakpoint message for a condition the runtime failed to compile. */
export function conditionCompileFailedMessage(condition: string): string {
  return `无法编译条件: ${condition}`;
}

/**
 * Builds a DAP `stopped` event, bypassing `@vscode/debugadapter`'s
 * `StoppedEvent` class, which cannot carry a description. All adapters publish
 * input waits with a description, so they share this constructor.
 */
export function rawStoppedEvent(
  reason: string,
  description?: string
): DebugProtocol.StoppedEvent {
  return {
    seq: 0,
    type: "event",
    event: "stopped",
    body: {
      reason,
      threadId: DEBUG_THREAD_ID,
      allThreadsStopped: true,
      ...(description ? { description } : {})
    }
  };
}
