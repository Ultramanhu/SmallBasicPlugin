/*
 * VS Code Webview glue shared by the JavaScript and Blazor WASM backends.
 *
 * The extension loads the browser JavaScript runtime from dist/web-runhost.js
 * and the Blazor payload from this folder, then drives both with the same
 * protocol used by the standalone runhost/web shell:
 *
 *   host -> page : { type: "run", backend, name, source } | { type: "stop" }
 *                  { type: "debug-launch", sessionId, name, source, stopOnEntry }
 *                  { type: "debug-command", sessionId, json }
 *                  { type: "resource-response", requestId, ok, data/error }
 *   page -> host : { type: "ready" } | { type: "output", text, sessionId? }
 *                  { type: "notify", json }            // run mode
 *                  { type: "debug-event", sessionId, json }  // debug mode
 *                  { type: "failed", text }
 *                  { type: "resource-request", requestId, path }
 *
 * The debug protocol itself (`json` above) is defined in
 * visual_studio_code_plugin/packages/smallbasic-vscode/src/web/debug-protocol.ts
 * and mirrored by SmallBasic.Blazor.Shared/Protocol.cs; this file only forwards
 * it, it does not interpret it.
 */
(() => {
    "use strict";

    const BACKEND_JAVASCRIPT = "javascript";
    const BACKEND_BLAZOR = "blazor";
    const ASSEMBLY = "SmallBasic.Blazor.Client";
    const TEXT_COLORS = [
        "#000000", "#000080", "#008000", "#008080", "#800000", "#800080", "#808000", "#c0c0c0",
        "#808080", "#0000ff", "#00ff00", "#00ffff", "#ff0000", "#ff00ff", "#ffff00", "#ffffff"
    ];
    const DEFAULT_FOREGROUND = 15;
    const DEFAULT_BACKGROUND = 0;
    const api = typeof acquireVsCodeApi === "function"
        ? acquireVsCodeApi()
        : { postMessage: (message) => console.log("[smallbasic-webview]", message) };
    const post = (message) => api.postMessage(message);

    const dom = {
        page: document.getElementById("web-runhost"),
        console: document.getElementById("console"),
        inputRow: document.getElementById("input-row"),
        inputPrompt: document.getElementById("input-prompt"),
        inputField: document.getElementById("input-field"),
        outputNote: document.getElementById("output-note"),
        blazorHost: document.getElementById("blazor-host"),
        diagnostics: document.getElementById("diagnostics")
    };

    let activeBackend = BACKEND_BLAZOR;
    let pendingInput = null;
    /** Non-null while the extension drives a debug session through this page. */
    let debugSessionId = null;
    /** Backend of the active debug session: the page drives it through `SmallBasicWeb` or Blazor. */
    let debugBackend = BACKEND_BLAZOR;

    function showDiagnostics(text) {
        dom.diagnostics.hidden = !text;
        dom.diagnostics.textContent = text || "";
        if (text) {
            console.error(text);
        }
    }

    function clearConsole() {
        dom.console.textContent = "";
    }

    function mirrorOutput(text) {
        const chunk = String(text || "");
        const line = chunk.replace(/\n$/, "");
        if (line) {
            console.log(line);
        }

        const message = { type: "output", text: chunk };
        if (debugSessionId) {
            message.sessionId = debugSessionId;
        }

        post(message);
    }

    function appendConsole(text, foreground, background) {
        if (!text) {
            return;
        }

        const span = document.createElement("span");
        span.textContent = text;
        span.style.color = TEXT_COLORS[foreground] || TEXT_COLORS[DEFAULT_FOREGROUND];
        span.style.backgroundColor = TEXT_COLORS[background] || TEXT_COLORS[DEFAULT_BACKGROUND];
        dom.console.appendChild(span);
        dom.console.scrollTop = dom.console.scrollHeight;
    }

    function selectBackend(backend) {
        activeBackend = backend === BACKEND_JAVASCRIPT ? BACKEND_JAVASCRIPT : BACKEND_BLAZOR;
        const javascript = activeBackend === BACKEND_JAVASCRIPT;
        dom.console.hidden = !javascript;
        dom.inputRow.hidden = !javascript || !pendingInput;
        dom.blazorHost.hidden = javascript;
        dom.outputNote.textContent = javascript
            ? "JavaScript 后端：TextWindow 在 Webview 内运行，输出同时写入“输出”面板。"
            : "Blazor WASM 后端：GraphicsWindow 绘制在下方，TextWindow 输出同时写入“输出”面板。";
        dom.page.dataset.backend = activeBackend;
    }

    function requestInput(kind) {
        return new Promise((resolve) => {
            pendingInput = { resolve, kind };
            dom.inputPrompt.textContent = kind === "number" ? "ReadNumber" : "Read";
            dom.inputField.value = "";
            dom.inputRow.hidden = false;
            dom.inputField.focus();
        });
    }

    function resolvePendingInput(value = "") {
        const pending = pendingInput;
        pendingInput = null;
        dom.inputRow.hidden = true;
        if (pending) {
            pending.resolve(value);
        }
    }

    dom.inputRow.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = dom.inputField.value;
        dom.inputField.value = "";
        appendConsole(value + "\n", DEFAULT_FOREGROUND, DEFAULT_BACKGROUND);
        mirrorOutput(value + "\n");
        resolvePendingInput(value);
    });

    /* ------------------------------------------------------ Blazor boot bridge */

    function resolvePayloadBase() {
        const script = document.querySelector('script[src*="vscode-webview.js"]');
        const source = script && script.src ? script.src : "";
        const separator = source.lastIndexOf("/");
        return separator > 0 ? source.slice(0, separator + 1) : "";
    }

    const payloadBase = resolvePayloadBase();
    let nextResourceRequest = 0;
    const pendingResources = new Map();

    function requestBootResource(type, name) {
        const requestId = `boot-${++nextResourceRequest}`;
        const path = `_framework/${name}`;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingResources.delete(requestId);
                reject(new Error(`读取 Blazor 资源超时：${path}`));
            }, 120000);

            pendingResources.set(requestId, { resolve, reject, timeout, type, name });
            post({ type: "resource-request", requestId, path });
        });
    }

    function resourceContentType(type, name) {
        if (type === "dotnetwasm" || name.endsWith(".wasm")) {
            return "application/wasm";
        }

        if (type === "manifest" || type === "configuration" || name.endsWith(".json")) {
            return "application/json";
        }

        return "application/octet-stream";
    }

    function completeResourceRequest(message) {
        const pending = pendingResources.get(message.requestId);
        if (!pending) {
            return;
        }

        pendingResources.delete(message.requestId);
        clearTimeout(pending.timeout);

        if (message.ok === false) {
            pending.reject(new Error(message.error || `读取 Blazor 资源失败：${pending.name}`));
            return;
        }

        let body;
        if (message.data instanceof ArrayBuffer) {
            body = message.data;
        } else if (ArrayBuffer.isView(message.data)) {
            body = new Uint8Array(message.data.buffer, message.data.byteOffset, message.data.byteLength);
        } else {
            pending.reject(new Error(`Blazor 资源返回了无效数据：${pending.name}`));
            return;
        }

        pending.resolve(new Response(body, {
            status: 200,
            headers: { "content-type": resourceContentType(pending.type, pending.name) }
        }));
    }

    function loadBootResource(type, name, defaultUri) {
        if (type === "dotnetjs" && name === "dotnet.js") {
            return `${payloadBase}_framework/dotnet.js`;
        }

        if (type === "dotnetjs") {
            return defaultUri;
        }

        return requestBootResource(type, name);
    }

    let blazorStart = null;

    function startBlazor() {
        if (!blazorStart) {
            blazorStart = (async () => {
                if (!window.Blazor || typeof window.Blazor.start !== "function") {
                    throw new Error("_framework/blazor.webassembly.js 未提供 Blazor.start");
                }

                await window.Blazor.start({ loadBootResource });
            })().catch((error) => {
                blazorStart = null;
                throw error;
            });
        }

        return blazorStart;
    }

    async function invoke(method, ...args) {
        for (let attempt = 0; attempt < 100 && !window.DotNet; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        if (!window.DotNet || typeof window.DotNet.invokeMethodAsync !== "function") {
            throw new Error("DotNet 互操作接口不可用");
        }

        return window.DotNet.invokeMethodAsync(ASSEMBLY, method, ...args);
    }

    window.SmallBasicWebHost = {
        isWebRunHost: () => true,
        write(text) {
            // Debug output of the JavaScript backend is rendered by this page
            // (the Blazor backend renders it in its own component instead).
            if (debugSessionId && activeBackend === BACKEND_JAVASCRIPT) {
                appendConsole(text, DEFAULT_FOREGROUND, DEFAULT_BACKGROUND);
            }

            mirrorOutput(text);
        },
        notify(json) {
            // Debug events are routed through their own channel so the extension
            // can isolate them by session; plain runs keep the legacy "notify".
            if (debugSessionId) {
                post({ type: "debug-event", sessionId: debugSessionId, json });
            } else {
                post({ type: "notify", json });
            }
        }
    };

    /* --------------------------------------------------------------- running */

    async function runJavaScript(message) {
        const backend = window.SmallBasicWeb;
        if (!backend || typeof backend.runJavaScript !== "function") {
            throw new Error("web-runhost.js 未导出 SmallBasicWeb.runJavaScript");
        }

        post({ type: "notify", json: JSON.stringify({ type: "ready" }) });
        const exitCode = await backend.runJavaScript(message.source || "", {
            writeText(text, newLine, foreground, background) {
                const chunk = newLine ? text + "\n" : text;
                appendConsole(chunk, foreground, background);
                mirrorOutput(chunk);
            },
            readInput: requestInput,
            writeError: showDiagnostics
        });
        resolvePendingInput();
        post({ type: "notify", json: JSON.stringify({ type: "terminated", exitCode }) });
    }

    async function runBlazor(message) {
        await startBlazor();
        await invoke("SetSession", JSON.stringify({
            name: message.name || "program.sb",
            source: message.source || ""
        }));
    }

    /* --------------------------------------------------------- debug driving */

    async function debugLaunch(message) {
        debugSessionId = typeof message.sessionId === "string" ? message.sessionId : null;
        debugBackend = message.backend === BACKEND_JAVASCRIPT ? BACKEND_JAVASCRIPT : BACKEND_BLAZOR;
        selectBackend(debugBackend);
        clearConsole();
        showDiagnostics("");

        if (debugBackend === BACKEND_JAVASCRIPT) {
            // The JavaScript engine runs in this page, exactly like the Blazor
            // engine runs in the Blazor component, so both backends are debugged
            // through the same document.
            const backend = window.SmallBasicWeb;
            if (!backend || typeof backend.debugStart !== "function") {
                throw new Error("web-runhost.js 未导出 SmallBasicWeb.debugStart");
            }

            backend.debugStart(JSON.stringify({
                sessionId: debugSessionId,
                name: message.name || "program.sb",
                source: message.source || "",
                stopOnEntry: message.stopOnEntry === true
            }));
            return;
        }

        await startBlazor();
        await invoke("SetSession", JSON.stringify({
            name: message.name || "program.sb",
            source: message.source || "",
            sessionId: debugSessionId,
            debug: true,
            stopOnEntry: message.stopOnEntry === true
        }));
    }

    async function debugCommand(message) {
        if (!debugSessionId || message.sessionId !== debugSessionId || typeof message.json !== "string") {
            return;
        }

        if (debugBackend === BACKEND_JAVASCRIPT) {
            const backend = window.SmallBasicWeb;
            if (backend && typeof backend.debugCommand === "function") {
                backend.debugCommand(message.json);
            }
            return;
        }

        await startBlazor();
        await invoke("DispatchDebugCommand", message.json);
    }

    async function stop() {
        if (debugSessionId) {
            // The DAP adapter owns the debug lifecycle; a Stop at the page level
            // (for example when the panel is reused for a run) just terminates
            // the active backend's session.
            try {
                if (debugBackend === BACKEND_JAVASCRIPT && window.SmallBasicWeb && typeof window.SmallBasicWeb.debugStop === "function") {
                    window.SmallBasicWeb.debugStop();
                } else {
                    await invoke("Stop");
                }
            } catch (error) {
                showDiagnostics(error && error.stack ? error.stack : String(error));
            }

            debugSessionId = null;
            return;
        }

        if (activeBackend === BACKEND_JAVASCRIPT) {
            if (window.SmallBasicWeb && typeof window.SmallBasicWeb.stopJavaScript === "function") {
                window.SmallBasicWeb.stopJavaScript();
            }
            resolvePendingInput();
            return;
        }

        await invoke("Stop");
    }

    window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message.type !== "string") {
            return;
        }

        if (message.type === "resource-response") {
            completeResourceRequest(message);
            return;
        }

        void (async () => {
            try {
                if (message.type === "run") {
                    debugSessionId = null;
                    selectBackend(message.backend);
                    clearConsole();
                    showDiagnostics("");
                    if (activeBackend === BACKEND_JAVASCRIPT) {
                        await runJavaScript(message);
                    } else {
                        await runBlazor(message);
                    }
                } else if (message.type === "debug-launch") {
                    await debugLaunch(message);
                } else if (message.type === "debug-command") {
                    await debugCommand(message);
                } else if (message.type === "stop") {
                    await stop();
                }
            } catch (error) {
                resolvePendingInput();
                const text = error && error.stack ? error.stack : String(error);
                showDiagnostics(text);
                post({ type: "failed", text });
            }
        })();
    });

    selectBackend(BACKEND_BLAZOR);
    post({ type: "ready" });
})();
