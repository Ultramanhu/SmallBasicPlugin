// visual_studio_code_plugin/node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// visual_studio_code_plugin/node_modules/@tauri-apps/api/core.js
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}
var Channel = class {
  constructor(onmessage) {
    _Channel_onmessage.set(this, void 0);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, void 0);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
    }), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  /**
   * The handler called for every message sent by the Rust side of this channel.
   *
   * Assigning a new handler replaces the previous one; messages that arrived
   * before a handler was set are not replayed, so set it (or pass it to the
   * constructor) before sending the channel to the backend.
   */
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
var Resource = class {
  get rid() {
    return __classPrivateFieldGet(this, _Resource_rid, "f");
  }
  constructor(rid) {
    _Resource_rid.set(this, void 0);
    __classPrivateFieldSet(this, _Resource_rid, rid, "f");
  }
  /**
   * Destroys and cleans up this resource from memory.
   * **You should not call any method on this object anymore and should drop any reference to it.**
   *
   * @remarks Uses the `core:resources:allow-close` permission, which is part of
   * the `core:resources:default` permission set enabled by default.
   */
  async close() {
    return invoke("plugin:resources|close", {
      rid: this.rid
    });
  }
  async [(_Resource_rid = /* @__PURE__ */ new WeakMap(), Symbol.asyncDispose)]() {
    await this.close();
  }
};

// visual_studio_code_plugin/packages/smallbasic-playground-desktop/src/desktop-bridge.ts
function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
function createTauriBridge() {
  return new TauriDesktopBridge();
}
var TauriDesktopBridge = class {
  async capabilities() {
    return invoke("desktop_capabilities");
  }
  async runProgram(request) {
    return this.startSession("run_program", request);
  }
  async startDebug(request) {
    return this.startSession("start_debug", request);
  }
  async startSession(command, request) {
    const channel = new Channel();
    channel.onmessage = (message) => request.onEvent(message);
    return invoke(command, {
      backend: request.backend,
      name: request.name,
      source: request.source,
      onEvent: channel
    });
  }
  async sendInput(sessionId, text) {
    await invoke("send_input", { sessionId, text });
  }
  async debugRequest(sessionId, command, args) {
    return invoke("debug_request", { sessionId, command, args: args ?? {} });
  }
  async terminateSession(sessionId) {
    await invoke("terminate_session", { sessionId });
  }
  async pickProgramFile() {
    return invoke("pick_program_file");
  }
  async saveProgramFile(defaultName, source) {
    return invoke("save_program_file", { defaultName, source });
  }
};

// visual_studio_code_plugin/packages/smallbasic-playground-desktop/src/backend-capabilities.ts
function resolveCliBackends(capabilities) {
  return [
    {
      id: "cli-csharp-net48",
      label: "C# (.NET Framework 4.8)",
      available: capabilities.backends.cliCsharpNet48,
      supportsGraphics: capabilities.graphics.cliCsharpNet48,
      supportsStdin: true
    },
    {
      id: "cli-csharp-net8",
      label: "C# (.NET 8.0)",
      available: capabilities.backends.cliCsharpNet8,
      supportsGraphics: capabilities.graphics.cliCsharpNet8,
      supportsStdin: true
    }
  ];
}

// visual_studio_code_plugin/packages/smallbasic-vscode/src/common/errors.ts
function describeError(error, includeStack = false) {
  if (error instanceof Error) {
    if (includeStack && error.stack) {
      return error.stack;
    }
    return error.message;
  }
  return String(error);
}

// visual_studio_code_plugin/packages/smallbasic-vscode/src/debug/dap.ts
var DEBUG_THREAD_ID = 1;
function toDapLine(protocolLine) {
  return protocolLine + 1;
}
function fromDapLine(dapLine) {
  return dapLine - 1;
}

// visual_studio_code_plugin/packages/smallbasic-playground-desktop/src/local-cli-debug-transport.ts
var REQUEST_TIMEOUT_MS = 1e4;
var VARIABLE_CHILDREN_LIMIT = 100;
var NUMBER_INPUT_HINT = /debug console/i;
var NUMBER_INPUT_KEYWORD = /number|数字/i;
var LocalCliDebugTransport = class {
  constructor(bridge, backend, sinks) {
    this.bridge = bridge;
    this.backend = backend;
    this.sinks = sinks;
  }
  pending = /* @__PURE__ */ new Map();
  /** Responses that arrived before `debug_request` resolved its seq number. */
  earlyResponses = /* @__PURE__ */ new Map();
  started = false;
  disposed = false;
  session;
  programName = "program.sb";
  exitCode;
  /** Last output hint about numeric input, used for the input-row prompt. */
  numberInputHint = false;
  async launch(payload) {
    this.programName = payload.name || this.programName;
    this.session = await this.bridge.startDebug({
      backend: this.backend,
      name: payload.name,
      source: payload.source,
      onEvent: (event) => this.onSessionEvent(event)
    });
    this.started = true;
  }
  async send(command) {
    if (!this.started || this.disposed) {
      return;
    }
    try {
      switch (command.type) {
        case "setBreakpoints":
          await this.setBreakpoints(command.breakpoints);
          break;
        case "start":
          await this.launchProgram();
          break;
        case "control":
          await this.sendControl(command.control, command.depth);
          break;
        case "input":
          await this.request("evaluate", { expression: command.text, context: "repl" });
          break;
        case "stop":
          await this.bridge.debugRequest(this.sessionId(), "disconnect", {}).catch(() => void 0);
          await this.bridge.terminateSession(this.sessionId()).catch(() => void 0);
          break;
      }
    } catch (error) {
      if (!this.disposed) {
        this.sinks.emit({ type: "error", message: describeError(error) });
      }
    }
  }
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Debug session ended."));
    }
    this.pending.clear();
    if (this.started) {
      void this.bridge.terminateSession(this.sessionId()).catch(() => void 0);
    }
  }
  sessionId() {
    if (!this.session) {
      throw new Error("The CLI debug session has not started.");
    }
    return this.session.sessionId;
  }
  async setBreakpoints(breakpoints) {
    const body = await this.request("setBreakpoints", {
      source: { name: this.programName, path: this.session?.programPath ?? this.programName },
      lines: breakpoints.map(toDapLine),
      breakpoints: breakpoints.map((line) => ({ line: toDapLine(line) }))
    });
    const declared = Array.isArray(body.breakpoints) ? body.breakpoints : [];
    const validated = declared.filter((item) => item.verified === true && typeof item.line === "number").map((item) => fromDapLine(item.line));
    if (validated.length > 0) {
      this.sinks.emit({ type: "breakpointsValidated", breakpoints: validated });
    }
  }
  async launchProgram() {
    if (!this.session) {
      throw new Error("The CLI debug session has not started.");
    }
    const body = await this.request("launch", {
      program: this.session.programPath,
      name: this.programName,
      stopOnEntry: false
    }).catch(async (error) => {
      this.sinks.emit({ type: "error", message: error.message });
      throw error;
    });
    void body;
    await this.request("configurationDone", {});
  }
  async sendControl(control, depth) {
    void depth;
    switch (control) {
      case "pause":
        await this.request("pause", { threadId: DEBUG_THREAD_ID });
        break;
      case "continue":
        await this.request("continue", { threadId: DEBUG_THREAD_ID });
        break;
      case "next":
        await this.request("next", { threadId: DEBUG_THREAD_ID });
        break;
      case "stepIn":
        await this.request("stepIn", { threadId: DEBUG_THREAD_ID });
        break;
      case "stepOut":
        await this.request("stepOut", { threadId: DEBUG_THREAD_ID });
        break;
    }
  }
  onSessionEvent(event) {
    if (event.kind !== "dap") {
      return;
    }
    const message = event.message;
    if (message.type === "response") {
      const requestSeq = message.request_seq ?? -1;
      const pending = this.pending.get(requestSeq);
      const success = message.success === true;
      if (!pending) {
        this.earlyResponses.set(requestSeq, { success, message });
        return;
      }
      this.pending.delete(requestSeq);
      if (success) {
        pending.resolve(message.body ?? {});
      } else {
        pending.reject(new Error(formatDapError(message)));
      }
      return;
    }
    if (message.type === "event") {
      this.onDapEvent(message);
    }
  }
  onDapEvent(message) {
    if (this.disposed) {
      return;
    }
    const body = message.body ?? {};
    switch (message.event) {
      case "initialized":
        this.sinks.emit({ type: "ready" });
        break;
      case "output": {
        const text = typeof body.output === "string" ? body.output : "";
        if (text) {
          if (NUMBER_INPUT_HINT.test(text) && NUMBER_INPUT_KEYWORD.test(text)) {
            this.numberInputHint = true;
          }
          this.sinks.onOutput(text);
        }
        break;
      }
      case "stopped":
        void this.onStopped(body);
        break;
      case "breakpoint": {
        const breakpoint = body.breakpoint ?? {};
        if (breakpoint.verified === true && typeof breakpoint.line === "number" && breakpoint.line > 0) {
          this.sinks.emit({ type: "breakpointsValidated", breakpoints: [fromDapLine(breakpoint.line)] });
        }
        break;
      }
      case "exited":
        if (typeof body.exitCode === "number") {
          this.exitCode = body.exitCode;
        }
        break;
      case "terminated":
        this.sinks.emit({ type: "terminated", exitCode: this.exitCode ?? 0 });
        break;
      default:
        break;
    }
  }
  /** DAP `stopped` -> web `stopped`/`input`, fetching stack and variables. */
  async onStopped(body) {
    const description = `${String(body.description ?? "")} ${String(body.text ?? "")}`;
    const waitingForInput = /input/i.test(description);
    let frames = [];
    let variables = [];
    try {
      const stack = await this.request("stackTrace", { threadId: DEBUG_THREAD_ID, levels: 20 });
      frames = this.toFrames(stack);
      variables = await this.collectVariables(frames);
    } catch {
    }
    const line = typeof body.line === "number" && body.line > 0 ? fromDapLine(body.line) : frames[0]?.line ?? 0;
    if (waitingForInput) {
      this.sinks.emit({
        type: "input",
        line,
        frames,
        variables,
        numberInput: this.numberInputHint
      });
      this.numberInputHint = false;
      return;
    }
    this.sinks.emit({
      type: "stopped",
      reason: typeof body.reason === "string" ? body.reason : void 0,
      line,
      frames,
      variables
    });
  }
  toFrames(stack) {
    const declared = Array.isArray(stack.stackFrames) ? stack.stackFrames : [];
    const frames = [];
    for (const frame of declared) {
      if (typeof frame.line !== "number" || frame.line <= 0) {
        continue;
      }
      frames.push({
        name: typeof frame.name === "string" ? frame.name : "Main",
        line: fromDapLine(frame.line)
      });
    }
    return frames;
  }
  async collectVariables(frames) {
    if (frames.length === 0) {
      return [];
    }
    const scopes = await this.request("scopes", { frameId: 1 });
    const declared = Array.isArray(scopes.scopes) ? scopes.scopes : [];
    const globals = declared.find((scope) => String(scope.name ?? "").toLowerCase() === "globals") ?? declared[0];
    if (!globals || typeof globals.variablesReference !== "number" || globals.variablesReference <= 0) {
      return [];
    }
    const rootVariables = await this.request("variables", { variablesReference: globals.variablesReference });
    return this.toVariableTree(rootVariables, 0);
  }
  async toVariableTree(body, depth) {
    const declared = Array.isArray(body.variables) ? body.variables : [];
    const variables = [];
    for (const item of declared.slice(0, VARIABLE_CHILDREN_LIMIT)) {
      const variable = {
        name: String(item.name ?? ""),
        value: String(item.value ?? "")
      };
      const reference = typeof item.variablesReference === "number" ? item.variablesReference : 0;
      if (reference > 0 && depth < 1) {
        try {
          const children = await this.request("variables", { variablesReference: reference });
          variable.children = await this.toVariableTree(children, depth + 1);
        } catch {
        }
      }
      variables.push(variable);
    }
    return variables;
  }
  request(command, args) {
    if (!this.started || this.disposed) {
      return Promise.reject(new Error("The CLI debug session has ended."));
    }
    const registration = { timedOut: false };
    const registered = this.bridge.debugRequest(this.sessionId(), command, args);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        registration.timedOut = true;
        if (registration.seq !== void 0) {
          this.pending.delete(registration.seq);
        }
        reject(new Error(`DAP request '${command}' timed out.`));
      }, REQUEST_TIMEOUT_MS);
      const settleResolve = (body) => {
        window.clearTimeout(timer);
        resolve(body);
      };
      const settleReject = (error) => {
        window.clearTimeout(timer);
        reject(error);
      };
      registered.then((seq) => {
        if (registration.timedOut) {
          return;
        }
        const early = this.earlyResponses.get(seq);
        if (early) {
          this.earlyResponses.delete(seq);
          if (early.success) {
            settleResolve(early.message.body ?? {});
          } else {
            settleReject(new Error(formatDapError(early.message)));
          }
          return;
        }
        registration.seq = seq;
        this.pending.set(seq, { resolve: settleResolve, reject: settleReject });
      }, (error) => {
        settleReject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
};
function formatDapError(message) {
  const body = message.body ?? {};
  return body.error?.format || message.message || "The CLI debug adapter rejected the request.";
}

// visual_studio_code_plugin/packages/smallbasic-vscode/src/playground/console-echo.ts
function echoToConsole(controller, text) {
  controller.appendConsole(text, 15, 0);
  controller.mirrorToConsole(text);
}

// visual_studio_code_plugin/packages/smallbasic-playground-desktop/src/desktop-entry.ts
async function activateDesktopPlayground() {
  if (!isTauriRuntime()) {
    return;
  }
  const api = window.SmallBasicPlayground;
  if (!api) {
    console.warn("SmallBasicPlayground bootstrap API is missing; desktop backends stay disabled.");
    return;
  }
  const context = await api.whenReady;
  const bridge = createTauriBridge();
  const capabilities = await bridge.capabilities();
  const available = resolveCliBackends(capabilities).filter((backend) => backend.available);
  if (available.length === 0) {
    context.controller.setStatus("Desktop backends unavailable");
    return;
  }
  const sessions = /* @__PURE__ */ new Map();
  for (const backend of available) {
    const session = new CliRunSession(bridge, context, backend);
    sessions.set(backend.id, session);
    api.registerBackend(backend.id, {
      label: backend.label,
      run: (snapshot) => session.run(snapshot),
      stop: () => session.stop(),
      onInput: (text) => session.sendInput(text)
    });
    api.registerDebugBackend(
      backend.id,
      () => Promise.resolve(new LocalCliDebugTransport(bridge, backend.id, {
        // Route protocol events through the shared notification path so the
        // CLI sessions drive the same status bar as the Web sessions.
        emit: (event) => context.notify(event),
        onOutput: (text) => echoToConsole(context.controller, text)
      }))
    );
  }
  api.addModelChangedListener(() => {
    for (const session of sessions.values()) {
      session.endFromEdit();
    }
  });
  api.registerSaveHandler(async (name, source) => {
    const saved = await bridge.saveProgramFile(name, source);
    if (saved) {
      context.controller.setStatus(`Saved ${saved}`);
    }
    return saved;
  });
  const graphicsBackend = available.find(
    (backend) => backend.id === "cli-csharp-net8" && backend.supportsGraphics
  ) ?? available.find(
    (backend) => backend.id === "cli-csharp-net48" && backend.supportsGraphics
  );
  api.setGraphicsBackendResolver(() => graphicsBackend?.id ?? null);
}
var CliRunSession = class {
  constructor(bridge, context, descriptor) {
    this.bridge = bridge;
    this.context = context;
    this.descriptor = descriptor;
  }
  info = null;
  stopping = false;
  async run(snapshot) {
    await this.endActive();
    this.stopping = false;
    const controller = this.context.controller;
    controller.setRunning(true);
    controller.setStatus(`Starting ${this.descriptor.label}\u2026`);
    if (this.descriptor.supportsGraphics && usesGraphics(snapshot.source)) {
      controller.setSessionInputVisible(false);
    } else {
      controller.setSessionInputVisible(true);
    }
    try {
      this.info = await this.bridge.runProgram({
        backend: this.descriptor.id,
        name: snapshot.name,
        source: snapshot.source,
        onEvent: (event) => this.onEvent(event)
      });
      controller.setStatus(`Running ${snapshot.name}\u2026`);
    } catch (error) {
      this.info = null;
      controller.setSessionInputVisible(false);
      controller.setRunning(false);
      controller.setStatus("Failed");
      controller.showRuntimeDiagnostics(describeError(error));
    }
  }
  async stop() {
    if (!this.info) {
      return;
    }
    this.stopping = true;
    this.context.controller.setStatus("Stopping\u2026");
    await this.terminate(this.info.sessionId);
  }
  sendInput(text) {
    if (!this.info) {
      return;
    }
    void this.bridge.sendInput(this.info.sessionId, text).catch((error) => {
      this.context.controller.showRuntimeDiagnostics(describeError(error));
    });
  }
  /** First edit during a session terminates it (same rule as debugging). */
  endFromEdit() {
    if (!this.info || this.stopping) {
      return;
    }
    this.stopping = true;
    this.context.controller.setSessionInputVisible(false);
    this.context.controller.setRunning(false);
    this.context.controller.setStatus("Editing ended the CLI session.");
    void this.terminate(this.info.sessionId);
  }
  async endActive() {
    const current = this.info;
    if (!current) {
      return;
    }
    this.stopping = true;
    this.info = null;
    await this.terminate(current.sessionId);
  }
  async terminate(sessionId) {
    try {
      await this.bridge.terminateSession(sessionId);
    } catch {
    }
  }
  onEvent(event) {
    const controller = this.context.controller;
    switch (event.kind) {
      case "stdout":
        echoToConsole(controller, event.text);
        break;
      case "stderr":
        controller.appendConsole(event.text, 15, 0);
        console.error(event.text.replace(/\n$/, ""));
        break;
      case "exited": {
        this.info = null;
        controller.setSessionInputVisible(false);
        controller.setRunning(false);
        controller.setStatus(sessionExitStatus(event.exitCode, this.stopping));
        break;
      }
      default:
        break;
    }
  }
};
function sessionExitStatus(exitCode, stopped) {
  if (stopped || exitCode === null) {
    return "Stopped";
  }
  return exitCode === 0 ? "Completed" : `Exited with code ${exitCode}`;
}
function usesGraphics(source) {
  return /\b(GraphicsWindow|Shapes|Turtle)\s*[\.(]/i.test(source || "");
}
void activateDesktopPlayground();
export {
  activateDesktopPlayground
};
//# sourceMappingURL=desktop.js.map
