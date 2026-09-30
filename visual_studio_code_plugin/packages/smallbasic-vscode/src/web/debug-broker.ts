import {
  DEBUG_LAUNCH_TIMEOUT_MS,
  DEBUG_REQUEST_TIMEOUT_MS,
  decodeRuntimeEvent,
  encodeHostCommand,
  type WebDebugCommand,
  type WebDebugControl,
  type WebDebugEvent
} from "./debug-protocol";

/**
 * The webview side of a Blazor debug session: it owns the session id, turns
 * requests from the DAP adapter into the wire commands of `debug-protocol.ts`,
 * and turns runtime events back into semantic events.
 *
 * It deliberately depends on nothing but a small structural channel interface,
 * so it runs in the desktop (Node) extension host, in the Web Worker extension
 * host and in unit tests with a fake channel.
 *
 * Channel messages (mirrored by
 * visual_studio_plugin/src/SmallBasic.Blazor.Client/wwwroot/vscode-webview.js):
 *
 *   host -> page : { type: "debug-launch", sessionId, name, source, stopOnEntry }
 *                  { type: "debug-command", sessionId, json }
 *   page -> host : { type: "debug-event", sessionId, json }
 *                  { type: "output", text, sessionId } | { type: "failed", text }
 *                  { type: "ready" }
 */

/** Minimal page message shape; every field is optional on the wire. */
export interface DebugWebviewMessage {
  type?: string;
  text?: string;
  json?: string;
  sessionId?: string;
  requestId?: string;
  path?: string;
}

export interface DisposableLike {
  dispose(): void;
}

/**
 * The subset of `BlazorWebviewHost` (and of `vscode.Webview` wrapped by it) that
 * the broker needs. Kept structural so the broker stays free of the `vscode`
 * module.
 */
export interface DebugWebviewChannel {
  post(message: unknown): void;
  onMessage(handler: (message: DebugWebviewMessage) => void): DisposableLike;
  onDispose(handler: () => void): DisposableLike;
  whenReady(timeoutMs: number): Promise<boolean>;
}

export interface DebugBrokerOptions {
  launchTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface DebugLaunchRequest {
  /** Which in-page engine runs the program: the JavaScript runtime or Blazor WASM. */
  backend: "javascript" | "blazor";
  name: string;
  source: string;
  stopOnEntry: boolean;
}

interface PendingRequest {
  resolve: (event: WebDebugEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Event kinds that satisfy the request. */
  accepts: (event: WebDebugEvent) => boolean;
}

/**
 * Owns one debug session on the webview side. State transitions are
 * `creating -> configuring -> running/paused -> terminated`; a command that
 * arrives after termination is ignored instead of reviving a dead session.
 */
export class WebDebugSessionBroker {
  private readonly sessionId: string;
  private readonly channel: DebugWebviewChannel;
  private readonly launchTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly subscribers = new Set<(event: WebDebugEvent) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly channelSubscriptions: DisposableLike[] = [];
  private readonly readyPromise: Promise<void>;

  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private nextRequestId = 0;
  private ready = false;
  private terminated = false;
  private disposed = false;
  private launchSent = false;

  public constructor(sessionId: string, channel: DebugWebviewChannel, options: DebugBrokerOptions = {}) {
    this.sessionId = sessionId;
    this.channel = channel;
    this.launchTimeoutMs = options.launchTimeoutMs ?? DEBUG_LAUNCH_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEBUG_REQUEST_TIMEOUT_MS;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      // The ready promise is only consumed after launch(); keep the rejection
      // handled so an early failure cannot become an unhandled rejection.
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.readyPromise.catch(() => undefined);

    this.channelSubscriptions.push(this.channel.onMessage((message) => this.handleMessage(message)));
    this.channelSubscriptions.push(this.channel.onDispose(() => this.handleDispose()));
  }

  public get id(): string {
    return this.sessionId;
  }

  public get isTerminated(): boolean {
    return this.terminated;
  }

  public onEvent(handler: (event: WebDebugEvent) => void): DisposableLike {
    this.subscribers.add(handler);
    return { dispose: () => this.subscribers.delete(handler) };
  }

  /**
   * Boots the runtime in the webview and resolves once it reports `ready`.
   * Blazor (WASM download, ICU, assemblies) is slower than the JavaScript
   * backend, hence the longer timeout.
   */
  public async launch(request: DebugLaunchRequest): Promise<void> {
    if (this.launchSent) {
      throw new Error("调试会话已经启动，不能重复 launch。");
    }

    this.launchSent = true;
    const pageReady = this.channel.whenReady(this.launchTimeoutMs);
    this.channel.post({
      type: "debug-launch",
      sessionId: this.sessionId,
      backend: request.backend,
      name: request.name,
      source: request.source,
      stopOnEntry: request.stopOnEntry
    });

    if (!await pageReady) {
      throw new Error("Webview 页面未就绪（未能加载 Blazor 载荷），调试会话启动失败。");
    }

    await this.withTimeout(this.readyPromise, this.launchTimeoutMs, "等待 Blazor WebAssembly 运行时就绪超时。");
  }

  /**
   * Requests breakpoint validation and resolves with the actual executable
   * lines. `conditions` is positionally aligned with `lines`; only the
   * JavaScript runtime evaluates them.
   */
  public async setBreakpoints(
    lines: readonly number[],
    conditions: readonly (string | undefined)[] = []
  ): Promise<number[]> {
    const requestId = `bp-${++this.nextRequestId}`;
    const event = await this.request(
      requestId,
      { kind: "setBreakpoints", requestId, lines: [...lines], conditions: [...conditions] },
      (candidate) => candidate.kind === "breakpointsValidated" && candidate.requestId === requestId
    );
    return event.kind === "breakpointsValidated" ? [...event.lines] : [];
  }

  /** Tells the runtime to begin (or resume) execution under the debugger. */
  public start(breakpoints: readonly number[] = []): void {
    this.post({ kind: "start", breakpoints: [...breakpoints] });
  }

  public control(control: WebDebugControl, depth: number): void {
    this.post({ kind: "control", control, depth });
  }

  public input(text: string): void {
    this.post({ kind: "input", text });
  }

  /**
   * Terminates through the command channel (not `engine.Terminate()` directly)
   * so a session blocked in `ReadAsync`/input is woken instead of leaking.
   */
  public async terminate(): Promise<void> {
    if (this.terminated) {
      return;
    }

    const requestId = `term-${++this.nextRequestId}`;
    try {
      await this.request(requestId, { kind: "terminate", requestId }, (event) => event.kind === "terminated");
    } catch {
      // A session that already unwound on its own is not an error.
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.terminated = true;
    for (const subscription of this.channelSubscriptions.splice(0)) {
      subscription.dispose();
    }

    this.rejectPending(new Error("调试会话已释放。"));
    this.subscribers.clear();
    this.rejectReadyIfPending(new Error("调试会话已释放。"));
  }

  private post(command: WebDebugCommand): void {
    if (this.terminated || this.disposed) {
      return;
    }

    const json = encodeHostCommand(this.sessionId, command);
    // `launch` (and therefore `ready`) precedes every other command, so the
    // ready gate only serializes the very first ones.
    if (!this.launchSent) {
      this.channel.post({ type: "debug-command", sessionId: this.sessionId, json });
      return;
    }

    void this.readyPromise
      .then(() => this.channel.post({ type: "debug-command", sessionId: this.sessionId, json }))
      .catch(() => undefined);
  }

  private request(
    requestId: string,
    command: WebDebugCommand,
    accepts: (event: WebDebugEvent) => boolean
  ): Promise<WebDebugEvent> {
    if (this.terminated && command.kind !== "terminate") {
      return Promise.reject(new Error("调试会话已经结束。"));
    }

    const promise = new Promise<WebDebugEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`调试命令超时：${command.kind}`));
      }, this.requestTimeoutMs);

      this.pending.set(requestId, { resolve, reject, timer, accepts });
      this.post(command);
    });

    return promise;
  }

  private handleMessage(message: DebugWebviewMessage): void {
    if (this.disposed || !message || typeof message.type !== "string") {
      return;
    }

    if (message.type === "debug-event") {
      if (message.sessionId !== this.sessionId) {
        return;
      }

      const event = decodeRuntimeEvent(message.json, this.sessionId);
      if (event) {
        this.deliver(event);
      }

      return;
    }

    if (message.type === "output" && message.sessionId === this.sessionId) {
      this.deliver({ kind: "output", text: message.text ?? "" });
      return;
    }

    if (message.type === "failed") {
      this.deliver({ kind: "error", message: message.text ?? "Webview 运行失败。" });
    }
  }

  private deliver(event: WebDebugEvent): void {
    if (event.kind === "ready" && !this.ready) {
      this.ready = true;
      this.resolveReady();
    }

    if (event.kind === "terminated") {
      this.terminated = true;
    }

    for (const [requestId, request] of [...this.pending]) {
      if (request.accepts(event)) {
        this.pending.delete(requestId);
        clearTimeout(request.timer);
        request.resolve(event);
      }
    }

    if (event.kind === "error" && !this.ready) {
      this.rejectReadyIfPending(new Error(event.message));
    }

    for (const subscriber of [...this.subscribers]) {
      subscriber(event);
    }
  }

  private handleDispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.terminated = true;
    this.rejectPending(new Error("Webview 已关闭。"));
    this.rejectReadyIfPending(new Error("Webview 已关闭。"));
    for (const subscriber of [...this.subscribers]) {
      subscriber({ kind: "terminated", exitCode: 0 });
    }

    this.subscribers.clear();
  }

  private rejectPending(error: Error): void {
    for (const [requestId, request] of [...this.pending]) {
      this.pending.delete(requestId);
      clearTimeout(request.timer);
      request.reject(error);
    }
  }

  private rejectReadyIfPending(error: Error): void {
    if (!this.ready) {
      this.rejectReady(error);
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }
}
