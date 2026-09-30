import { describe, expect, it } from "vitest";
import {
  WebDebugSessionBroker,
  type DebugWebviewChannel,
  type DebugWebviewMessage
} from "../src/web/debug-broker";
import { DEBUG_PROTOCOL_VERSION, type WebDebugEvent } from "../src/web/debug-protocol";

const SESSION = "session-under-test";

class FakeChannel implements DebugWebviewChannel {
  public readonly posted: Array<Record<string, unknown>> = [];
  public pageReady = true;
  public closed = false;
  private readonly messageHandlers = new Set<(message: DebugWebviewMessage) => void>();
  private readonly disposeHandlers = new Set<() => void>();

  public post(message: unknown): void {
    this.posted.push(message as Record<string, unknown>);
  }

  public onMessage(handler: (message: DebugWebviewMessage) => void): { dispose(): void } {
    this.messageHandlers.add(handler);
    return { dispose: () => this.messageHandlers.delete(handler) };
  }

  public onDispose(handler: () => void): { dispose(): void } {
    this.disposeHandlers.add(handler);
    return { dispose: () => this.disposeHandlers.delete(handler) };
  }

  public whenReady(): Promise<boolean> {
    return Promise.resolve(this.pageReady);
  }

  public emit(message: DebugWebviewMessage): void {
    for (const handler of [...this.messageHandlers]) {
      handler(message);
    }
  }

  public close(): void {
    this.closed = true;
    for (const handler of [...this.disposeHandlers]) {
      handler();
    }
  }

  public emitEvent(event: Record<string, unknown>, sessionId = SESSION): void {
    this.emit({
      type: "debug-event",
      sessionId,
      json: JSON.stringify({ protocolVersion: DEBUG_PROTOCOL_VERSION, sessionId, ...event })
    });
  }

  public commands(): Array<Record<string, unknown>> {
    return this.posted
      .filter((message) => message.type === "debug-command")
      .map((message) => JSON.parse(String(message.json)) as Record<string, unknown>);
  }
}

/** Waits for the microtask queue so the broker's ready gate has flushed. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function createBroker(channel: FakeChannel, requestTimeoutMs = 1000): WebDebugSessionBroker {
  return new WebDebugSessionBroker(SESSION, channel, { requestTimeoutMs, launchTimeoutMs: 1000 });
}

async function launch(channel: FakeChannel, broker: WebDebugSessionBroker): Promise<void> {
  const launched = broker.launch({ backend: "blazor", name: "program.sb", source: "x = 1", stopOnEntry: true });
  channel.emitEvent({ type: "ready" });
  await launched;
}

describe("web debug session broker", () => {
  it("boots the webview with a launch message and waits for the runtime ready", async () => {
    const channel = new FakeChannel();
    const broker = createBroker(channel);

    const launched = broker.launch({ backend: "blazor", name: "program.sb", source: "x = 1", stopOnEntry: true });
    expect(channel.posted[0]).toEqual({
      type: "debug-launch",
      sessionId: SESSION,
      backend: "blazor",
      name: "program.sb",
      source: "x = 1",
      stopOnEntry: true
    });

    channel.emitEvent({ type: "ready" });
    await expect(launched).resolves.toBeUndefined();
  });

  it("fails launch when the page never loads the payload", async () => {
    const channel = new FakeChannel();
    channel.pageReady = false;
    const broker = createBroker(channel);

    await expect(broker.launch({ backend: "blazor", name: "p.sb", source: "", stopOnEntry: false }))
      .rejects.toThrow(/Webview 页面未就绪/);
  });

  it("fails launch when the runtime never reports ready", async () => {
    const channel = new FakeChannel();
    const broker = new WebDebugSessionBroker(SESSION, channel, { launchTimeoutMs: 20, requestTimeoutMs: 20 });

    await expect(broker.launch({ backend: "blazor", name: "p.sb", source: "", stopOnEntry: false }))
      .rejects.toThrow(/超时/);
  });

  it("correlates setBreakpoints requests with the validated lines", async () => {
    const channel = new FakeChannel();
    const broker = createBroker(channel);
    await launch(channel, broker);

    const pending = broker.setBreakpoints([1, 4]);
    await tick();

    const command = channel.commands().at(-1)!;
    expect(command).toMatchObject({ type: "setBreakpoints", breakpoints: [1, 4] });
    const requestId = String(command.requestId);

    channel.emitEvent({ type: "breakpointsValidated", requestId: "other", breakpoints: [99] });
    channel.emitEvent({ type: "breakpointsValidated", requestId, breakpoints: [2, 5] });

    await expect(pending).resolves.toEqual([2, 5]);
  });

  it("serializes commands after the runtime is ready and ignores late sessions", async () => {
    const channel = new FakeChannel();
    const broker = createBroker(channel);

    const launched = broker.launch({ backend: "blazor", name: "p.sb", source: "", stopOnEntry: false });
    broker.control("continue", 0);
    broker.start([0]);
    expect(channel.commands()).toHaveLength(0);

    channel.emitEvent({ type: "ready" });
    await launched;
    await tick();

    expect(channel.commands().map((command) => command.type)).toEqual(["control", "start"]);

    const events: WebDebugEvent[] = [];
    broker.onEvent((event) => events.push(event));

    // A late event from another session must not reach subscribers.
    channel.emitEvent({ type: "output", text: "foreign" }, "another-session");
    channel.emit({ type: "output", text: "foreign", sessionId: "another-session" });
    expect(events).toHaveLength(0);

    channel.emit({ type: "output", text: "mine", sessionId: SESSION });
    expect(events).toEqual([{ kind: "output", text: "mine" }]);
  });

  it("terminates through the command channel and resolves on the terminated event", async () => {
    const channel = new FakeChannel();
    const broker = createBroker(channel);
    await launch(channel, broker);

    const terminated = broker.terminate();
    await tick();
    const command = channel.commands().at(-1)!;
    expect(command).toMatchObject({ type: "stop" });
    expect(typeof command.requestId).toBe("string");

    channel.emitEvent({ type: "terminated", exitCode: 0 });
    await expect(terminated).resolves.toBeUndefined();
    expect(broker.isTerminated).toBe(true);

    // Nothing may be posted once the session is terminated.
    channel.posted.length = 0;
    broker.control("continue", 0);
    await tick();
    expect(channel.posted).toHaveLength(0);
  });

  it("times out a request that is never answered", async () => {
    const channel = new FakeChannel();
    const broker = new WebDebugSessionBroker(SESSION, channel, { launchTimeoutMs: 1000, requestTimeoutMs: 20 });
    await launch(channel, broker);

    await expect(broker.setBreakpoints([1])).rejects.toThrow(/超时/);
  });

  it("rejects pending requests and reports termination when the webview is disposed", async () => {
    const channel = new FakeChannel();
    const broker = createBroker(channel);
    await launch(channel, broker);

    const events: WebDebugEvent[] = [];
    broker.onEvent((event) => events.push(event));
    const pending = broker.setBreakpoints([1]);
    await tick();

    channel.close();
    await expect(pending).rejects.toThrow(/Webview 已关闭/);
    expect(events).toEqual([{ kind: "terminated", exitCode: 0 }]);
  });

  it("rejects launch when the page reports a failure", async () => {
    const channel = new FakeChannel();
    const broker = createBroker(channel);
    const launched = broker.launch({ backend: "blazor", name: "p.sb", source: "", stopOnEntry: false });
    channel.emit({ type: "failed", text: "boot failed" });
    await expect(launched).rejects.toThrow(/boot failed/);
  });
});
