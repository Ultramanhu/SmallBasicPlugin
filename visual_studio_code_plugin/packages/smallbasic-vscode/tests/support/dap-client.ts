import { PassThrough } from "node:stream";
import type { DebugSession } from "@vscode/debugadapter";

export type DapMessage = {
  type: string;
  event?: string;
  command?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: Record<string, unknown>;
};

/**
 * Drives any `DebugSession` over an in-memory DAP stream. Shared by the
 * JavaScript adapter tests (`debug-session.spec.ts`) and the Blazor web adapter
 * tests (`blazor-debug-adapter.spec.ts`) so both exercise the real DAP wire
 * format instead of calling the adapter internals.
 */
export class DapClient {
  private readonly clientToAdapter = new PassThrough();
  private readonly adapterToClient = new PassThrough();
  private readonly pending = new Map<number, (message: DapMessage) => void>();
  private readonly events: DapMessage[] = [];
  private buffer = Buffer.alloc(0);
  private seq = 0;

  public constructor(session: DebugSession) {
    session.setRunAsServer(true);
    session.start(this.clientToAdapter, this.adapterToClient);
    this.adapterToClient.on("data", (chunk: Buffer) => this.onData(chunk));
  }

  public request(command: string, args?: Record<string, unknown>): Promise<DapMessage> {
    this.seq += 1;
    const message: Record<string, unknown> = { seq: this.seq, type: "request", command };
    if (args) {
      message.arguments = args;
    }

    return new Promise<DapMessage>((resolve, reject) => {
      this.pending.set(this.seq, (response) => {
        if (response.success === false) {
          reject(new Error(`${command} failed: ${response.message}`));
        } else {
          resolve(response);
        }
      });

      const json = JSON.stringify(message);
      this.clientToAdapter.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`, "utf8");
    });
  }

  public async waitForEvent(eventName: string, occurrence = 1, timeoutMs = 5000): Promise<DapMessage> {
    const startedAt = Date.now();
    for (;;) {
      const matches = this.events.filter((event) => event.event === eventName);
      if (matches.length >= occurrence) {
        return matches[occurrence - 1];
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for event '${eventName}'. Seen: ${this.events.map((event) => event.event).join(", ")}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  public eventCount(eventName: string): number {
    return this.events.filter((event) => event.event === eventName).length;
  }

  public outputText(): string {
    return this.events
      .filter((event) => event.event === "output")
      .map((event) => String(event.body?.output ?? ""))
      .join("");
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }

      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        throw new Error(`Malformed DAP header: ${header}`);
      }

      const length = Number.parseInt(match[1], 10);
      if (this.buffer.length < headerEnd + 4 + length) {
        return;
      }

      const body = this.buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      this.buffer = this.buffer.slice(headerEnd + 4 + length);
      const message = JSON.parse(body) as DapMessage;
      if (message.type === "response") {
        const handler = this.pending.get(message.request_seq ?? -1);
        if (handler) {
          this.pending.delete(message.request_seq ?? -1);
          handler(message);
        }
      } else if (message.type === "event") {
        this.events.push(message);
      }
    }
  }
}
