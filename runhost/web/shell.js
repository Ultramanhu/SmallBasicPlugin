/*
 * Small Basic web RunHost shell.
 *
 * The page hosts two fully local (no server) execution backends:
 *   - "javascript": smallbasic-js.js, the TypeScript compiler/engine compiled for
 *     the browser. TextWindow only; output goes to the page console and to the
 *     browser console.
 *   - "blazor": the Blazor WebAssembly RunHost in #app (SmallBasic.Blazor.Client),
 *     loaded on demand. It supports GraphicsWindow/Shapes/Turtle, renders the SVG
 *     scene and mirrors TextWindow output to the browser console through the
 *     SmallBasicWebHost.write hook defined below.
 *
 * Programs come from samples/index.json (the build stages the repository's test
 * folder there) or from a local .sb file the user picks/drops; the page has no
 * editor.
 *
 * The same page is also served by the CLI RunHost (SmallBasic.Blazor.RunHost)
 * with ?session=<id>; in that case the shell hides its toolbar and just starts the
 * WebAssembly runtime, which pulls the session descriptor from the RunHost API.
 */
(() => {
    "use strict";

    const BACKEND_JAVASCRIPT = "javascript";
    const BACKEND_BLAZOR = "blazor";
    const BLAZOR_ASSEMBLY = "SmallBasic.Blazor.Client";
    const LOCAL_PROGRAM_PATH = "local:";

    // The CLI RunHost opens this same page with ?session=<id>; in that case the
    // Blazor runtime must fetch its session descriptor instead of being driven by
    // the shell, so the shell hides its toolbar and reports the mode below.
    const IS_CLI_MODE = new URLSearchParams(location.search).has("session");

    // TextWindowColor (SmallBasicOnline) indexes, matching the ANSI/console palette.
    const TEXT_COLORS = [
        "#000000", "#000080", "#008000", "#008080", "#800000", "#800080", "#808000", "#c0c0c0",
        "#808080", "#0000ff", "#00ff00", "#00ffff", "#ff0000", "#ff00ff", "#ffff00", "#ffffff"
    ];
    const DEFAULT_FOREGROUND = 15; // White
    const DEFAULT_BACKGROUND = 0;  // Black

    // Only used when samples/index.json is unavailable (for example the CLI host,
    // which does not stage the repository samples).
    const FALLBACK_PROGRAM = {
        path: "builtin:",
        name: "Hello, World!（内置）",
        graphics: false,
        source: [
            "TextWindow.WriteLine(\"Hello, World!\")",
            "",
            "TextWindow.Write(\"What is your name? \")",
            "name = TextWindow.Read()",
            "TextWindow.WriteLine(\"Hello, \" + name + \"!\")"
        ].join("\n")
    };

    const state = {
        backend: BACKEND_JAVASCRIPT,
        running: false,
        stopped: false,
        programs: [],
        program: null,
        blazorStart: null,
        jsBackend: null,
        pendingInput: null,
        responded: false
    };

    const dom = {};

    function bindDom() {
        dom.page = document.getElementById("web-runhost");
        dom.program = document.getElementById("program-select");
        dom.backend = document.getElementById("backend-select");
        dom.run = document.getElementById("run-button");
        dom.stop = document.getElementById("stop-button");
        dom.status = document.getElementById("status");
        dom.file = document.getElementById("file-input");
        dom.diagnostics = document.getElementById("diagnostics");
        dom.console = document.getElementById("console");
        dom.inputRow = document.getElementById("input-row");
        dom.inputPrompt = document.getElementById("input-prompt");
        dom.inputField = document.getElementById("input-field");
        dom.outputNote = document.getElementById("output-note");
        dom.blazorHost = document.getElementById("blazor-host");
    }

    /* --------------------------------------------------------------- helpers */

    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    function setStatus(text) {
        dom.status.textContent = text;
    }

    function setRunning(running) {
        state.running = running;
        dom.run.disabled = running;
        dom.stop.disabled = !running;
    }

    function showDiagnostics(text) {
        if (!text) {
            dom.diagnostics.hidden = true;
            dom.diagnostics.textContent = "";
            return;
        }

        dom.diagnostics.hidden = false;
        dom.diagnostics.textContent = text;
        console.error(text);
    }

    function banner(text) {
        const node = document.createElement("div");
        node.className = "web-banner";
        node.innerHTML = text;
        dom.page.insertBefore(node, dom.page.firstChild);
    }

    function stripBom(text) {
        return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    }

    /* ------------------------------------------------------ console plumbing */

    function clearConsole() {
        dom.console.textContent = "";
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

    // Everything a program writes also lands in the browser console, which is the
    // behaviour shared by both backends.
    function mirrorToConsole(text) {
        if (!text) {
            return;
        }

        const line = text.replace(/\n$/, "");
        if (line.length > 0) {
            console.log(line);
        }
    }

    function requestInput(kind) {
        return new Promise((resolve) => {
            state.pendingInput = { resolve, kind };
            dom.inputPrompt.textContent = kind === "number" ? "ReadNumber" : "Read";
            dom.inputField.value = "";
            dom.inputRow.hidden = false;
            dom.inputField.focus();
        });
    }

    function submitInput(event) {
        event.preventDefault();
        const pending = state.pendingInput;
        if (!pending) {
            return;
        }

        state.pendingInput = null;
        dom.inputRow.hidden = true;
        const value = dom.inputField.value;
        dom.inputField.value = "";
        appendConsole(value + "\n", DEFAULT_FOREGROUND, DEFAULT_BACKGROUND);
        mirrorToConsole(value);
        pending.resolve(value);
    }

    function resolvePendingInput() {
        const pending = state.pendingInput;
        state.pendingInput = null;
        dom.inputRow.hidden = true;
        if (pending) {
            pending.resolve("");
        }
    }

    /* -------------------------------------------------------- script loading */

    function loadScript(source, attributes) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-shell-src="${source}"]`);
            const node = existing ?? document.createElement("script");
            const done = () => {
                node.dataset.loaded = "true";
                resolve();
            };
            const failed = () => reject(new Error(`无法加载 ${source}`));

            if (existing) {
                if (existing.dataset.loaded === "true") {
                    resolve();
                    return;
                }

                existing.addEventListener("load", done, { once: true });
                existing.addEventListener("error", failed, { once: true });
                return;
            }

            node.src = source;
            node.dataset.shellSrc = source;
            for (const [name, value] of Object.entries(attributes ?? {})) {
                node.setAttribute(name, value);
            }

            node.addEventListener("load", done, { once: true });
            node.addEventListener("error", failed, { once: true });
            document.head.appendChild(node);
        });
    }

    function loadJavaScriptBackend() {
        if (!state.jsBackend) {
            state.jsBackend = loadScript("smallbasic-js.js")
                .then(() => {
                    const backend = window.SmallBasicWeb;
                    if (!backend || typeof backend.runJavaScript !== "function") {
                        throw new Error("smallbasic-js.js 未导出 SmallBasicWeb.runJavaScript");
                    }

                    return backend;
                })
                .catch((error) => {
                    state.jsBackend = null;
                    throw error;
                });
        }

        return state.jsBackend;
    }

    function startBlazor() {
        if (!state.blazorStart) {
            state.blazorStart = (async () => {
                // autostart=false keeps the loader from booting before we are ready
                // to await Blazor.start(), which signals a fully initialized app.
                await loadScript("_framework/blazor.webassembly.js", { autostart: "false" });
                if (!window.Blazor || typeof window.Blazor.start !== "function") {
                    throw new Error("_framework/blazor.webassembly.js 未提供 Blazor.start");
                }

                await window.Blazor.start();
                await waitForDotNet();
            })().catch((error) => {
                state.blazorStart = null;
                throw error;
            });
        }

        return state.blazorStart;
    }

    async function waitForDotNet() {
        for (let attempt = 0; attempt < 100; attempt += 1) {
            if (window.DotNet && typeof window.DotNet.invokeMethodAsync === "function") {
                return;
            }

            await sleep(50);
        }

        throw new Error("DotNet 互操作接口不可用");
    }

    function invokeBlazor(method, ...args) {
        return window.DotNet.invokeMethodAsync(BLAZOR_ASSEMBLY, method, ...args);
    }

    /* ----------------------------------------------------------- host facade */

    // Called by the Blazor runner (WebShellTransport) for text output, and by the
    // shell itself when the JavaScript backend writes.
    window.SmallBasicWebHost = {
        /** Probed by the runner (WebRunHost.IsEmbeddedAsync) to pick its hosting mode. */
        isWebRunHost: () => !IS_CLI_MODE,

        write(text) {
            mirrorToConsole(text);
        },

        notify(json) {
            state.responded = true;
            let message;
            try {
                message = JSON.parse(json);
            } catch {
                return;
            }

            if (message.type === "ready") {
                setStatus("Running");
                return;
            }

            if (message.type === "stopped") {
                setStatus(`Paused: ${message.reason ?? "breakpoint"}`);
                return;
            }

            if (message.type === "terminated") {
                setRunning(false);
                setStatus(exitStatus(message.exitCode));
            }
        }
    };

    function exitStatus(exitCode) {
        if (state.stopped) {
            return "Stopped";
        }

        return exitCode === 0 ? "Completed" : `Exited with code ${exitCode}`;
    }

    /* --------------------------------------------------------------- running */

    function applyBackend() {
        const blazor = state.backend === BACKEND_BLAZOR;
        dom.console.hidden = blazor;
        dom.inputRow.hidden = blazor || !state.pendingInput;
        dom.blazorHost.hidden = !blazor;
        dom.outputNote.textContent = blazor
            ? "Blazor WASM 后端：GraphicsWindow 绘制在下方，TextWindow 输出同时写入浏览器控制台。"
            : "TextWindow 输出同时写入浏览器控制台（F12 / Console）。";
        dom.page.dataset.backend = state.backend;
    }

    function selectBackend(backend) {
        state.backend = backend;
        dom.backend.value = backend;
        applyBackend();
    }

    async function runJavaScript() {
        const source = state.program ? state.program.source : "";
        if (!source.trim()) {
            setStatus("Nothing to run");
            return;
        }

        let backend;
        try {
            setStatus("Loading JavaScript engine…");
            backend = await loadJavaScriptBackend();
        } catch (error) {
            showDiagnostics(
                "JavaScript 后端不可用：" + (error && error.message ? error.message : String(error)) +
                "\n请使用完整的 runhost/web 分发（其中包含 smallbasic-js.js），或改用 Blazor WASM 后端。");
            setStatus("Failed");
            return;
        }

        setRunning(true);
        setStatus("Running");
        try {
            const exitCode = await backend.runJavaScript(source, {
                writeText(text, newLine, foreground, background) {
                    const chunk = newLine ? text + "\n" : text;
                    appendConsole(chunk, foreground, background);
                    mirrorToConsole(chunk);
                },
                readInput: requestInput,
                writeError: showDiagnostics
            });

            setRunning(false);
            setStatus(exitStatus(exitCode));
        } catch (error) {
            showDiagnostics(error && error.stack ? error.stack : String(error));
            setRunning(false);
            setStatus("Failed");
        } finally {
            resolvePendingInput();
        }
    }

    async function runBlazor() {
        const source = state.program ? state.program.source : "";
        if (!source.trim()) {
            setStatus("Nothing to run");
            return;
        }

        setRunning(true);
        try {
            if (!state.blazorStart) {
                setStatus("Loading Blazor WASM runtime…");
            }

            await startBlazor();
            setStatus("Starting program…");
            state.responded = false;
            const name = state.program && state.program.name ? state.program.name : "program.sb";
            await invokeBlazor("SetSession", JSON.stringify({ name, source }));
            armStartupWatchdog();
        } catch (error) {
            showDiagnostics(
                "Blazor WASM 运行时加载失败：" + (error && error.message ? error.message : String(error)) +
                "\n请确认当前页面通过 HTTP 提供（使用 node runhost/web/serve.mjs，或双击 run.cmd），而不是直接用 file:// 打开。");
            setRunning(false);
            setStatus("Failed");
        }
    }

    // A program always reports back within milliseconds, so silence means the
    // WebAssembly runtime failed to start. Without this the Run button would stay
    // disabled until the page is reloaded.
    function armStartupWatchdog() {
        window.setTimeout(() => {
            if (state.responded || !state.running) {
                return;
            }

            setRunning(false);
            setStatus("Blazor runtime did not respond");
            showDiagnostics("Blazor WASM 运行时未在 30 秒内响应，请查看页面底部的错误提示后重新加载页面。");
        }, 30000);
    }

    async function stopRun() {
        if (!state.running) {
            return;
        }

        state.stopped = true;
        if (state.backend === BACKEND_JAVASCRIPT) {
            if (window.SmallBasicWeb && typeof window.SmallBasicWeb.stopJavaScript === "function") {
                window.SmallBasicWeb.stopJavaScript();
            }

            resolvePendingInput();
            setStatus("Stopping…");
            return;
        }

        setStatus("Stopping…");
        try {
            await invokeBlazor("Stop");
        } catch (error) {
            console.warn("Stop failed:", error);
        }
    }

    async function run() {
        if (!state.program) {
            setStatus("Select a program first");
            return;
        }

        showDiagnostics("");
        clearConsole();
        state.stopped = false;
        if (state.backend === BACKEND_BLAZOR) {
            await runBlazor();
        } else {
            await runJavaScript();
        }
    }

    /* ------------------------------------------------------- program loading */

    function addProgramOption(label, value) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        dom.program.appendChild(option);
        return option;
    }

    function setProgram(program) {
        state.program = program;
        dom.program.value = program.path;
        if (!state.running) {
            setStatus(`Loaded ${program.name}`);
        }

        // Programs that draw (GraphicsWindow/Shapes/Turtle) need the Blazor
        // backend; the manifest marks them so the right one is preselected.
        if (program.graphics && state.backend !== BACKEND_BLAZOR) {
            selectBackend(BACKEND_BLAZOR);
        }
    }

    async function selectProgram(path) {
        const program = state.programs.find((item) => item.path === path);
        if (!program) {
            return;
        }

        try {
            if (program.source === undefined) {
                const response = await fetch(program.path, { cache: "no-store" });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                program.source = stripBom(await response.text());
            }

            setProgram(program);
        } catch (error) {
            showDiagnostics(`无法加载 ${program.name}：${error && error.message ? error.message : String(error)}`);
            setStatus("Failed");
        }
    }

    function useLocalProgram(name, text) {
        let program = state.programs.find((item) => item.local === true);
        const label = `本地文件：${name}`;
        if (program) {
            program.name = label;
            program.source = stripBom(text);
            const option = dom.program.querySelector(`option[value="${LOCAL_PROGRAM_PATH}"]`);
            if (option) {
                option.textContent = label;
            }
        } else {
            program = { path: LOCAL_PROGRAM_PATH, name: label, source: stripBom(text), local: true, graphics: false };
            state.programs.push(program);
            addProgramOption(label, LOCAL_PROGRAM_PATH);
        }

        setProgram(program);
    }

    async function loadFile(file) {
        if (!file) {
            return;
        }

        useLocalProgram(file.name, await file.text());
    }

    async function loadProgramList() {
        let manifest = null;
        try {
            const response = await fetch("samples/index.json", { cache: "no-store" });
            if (response.ok) {
                manifest = await response.json();
            }
        } catch {
            manifest = null;
        }

        dom.program.textContent = "";
        const items = manifest && Array.isArray(manifest.items)
            ? manifest.items.filter((item) => item && item.path)
            : [];

        if (items.length === 0) {
            // No staged samples (for example the CLI host): stay usable with the
            // built-in program and let the user pick a local file.
            state.programs = [FALLBACK_PROGRAM];
            addProgramOption(FALLBACK_PROGRAM.name, FALLBACK_PROGRAM.path);
            setProgram(FALLBACK_PROGRAM);
            return;
        }

        state.programs = items;
        for (const item of items) {
            addProgramOption(item.name || item.path, item.path);
        }

        const preferred = items.find((item) => item.path === manifest.default) || items[0];
        await selectProgram(preferred.path);
    }

    // When Program.Delay's timer elapses, the runtime re-runs the delay
    // instruction once before advancing past it; the resulting failed argument
    // pop is harmless (the Node.js host dies on it, browsers only log it).
    function isBenignDelayRejection(reason) {
        const text = String(reason && reason.message ? reason.message : reason);
        const source = state.program && state.program.source ? state.program.source : "";
        return text.indexOf("Evaluation stack empty") >= 0
            && /program\s*\.\s*delay\s*\(/i.test(source);
    }

    function wireEvents() {
        dom.run.addEventListener("click", () => { void run(); });
        dom.stop.addEventListener("click", () => { void stopRun(); });
        dom.inputRow.addEventListener("submit", submitInput);
        dom.program.addEventListener("change", () => {
            void selectProgram(dom.program.value);
        });
        dom.backend.addEventListener("change", async () => {
            if (state.running) {
                await stopRun();
            }

            selectBackend(dom.backend.value);
        });
        dom.file.addEventListener("change", () => {
            void loadFile(dom.file.files && dom.file.files[0]);
            dom.file.value = "";
        });

        for (const type of ["dragover", "drop"]) {
            document.addEventListener(type, (event) => event.preventDefault());
        }

        document.addEventListener("drop", (event) => {
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            void loadFile(file);
        });

        // Engine failures usually surface as rejected promises (the runtime calls
        // library methods without awaiting them), so log them instead of
        // overwriting the diagnostics the backend already reported.
        window.addEventListener("unhandledrejection", (event) => {
            if (isBenignDelayRejection(event.reason)) {
                // Keeps the browser from also reporting it as an uncaught rejection.
                event.preventDefault();
                return;
            }

            console.error("Small Basic runtime failure:", event.reason);
            if (state.running) {
                setRunning(false);
                setStatus("Failed");
            }
        });
    }

    /* ------------------------------------------------------------- bootstrap */

    function startCliSession() {
        document.body.classList.add("web-cli-mode");
        state.backend = BACKEND_BLAZOR;
        applyBackend();
        setStatus("Starting Blazor WASM runtime…");
        startBlazor().catch((error) => {
            showDiagnostics(String(error && error.stack ? error.stack : error));
            setStatus("Failed");
        });
    }

    // The CLI RunHost does not stage smallbasic-js.js, so the JavaScript backend
    // is only offered when the file is really there.
    async function probeJavaScriptBackend() {
        let available = false;
        try {
            const response = await fetch("smallbasic-js.js", { method: "HEAD", cache: "no-store" });
            available = response.ok;
        } catch {
            available = false;
        }

        if (available) {
            return;
        }

        const option = dom.backend.querySelector(`option[value="${BACKEND_JAVASCRIPT}"]`);
        if (option) {
            option.remove();
        }

        if (state.backend === BACKEND_JAVASCRIPT) {
            selectBackend(BACKEND_BLAZOR);
        }

        setStatus("Blazor backend only");
        banner("当前分发缺少 <code>smallbasic-js.js</code>（浏览器 JavaScript 后端），只提供 Blazor WASM 后端。" +
            "完整分发请执行 <code>runhost\\Build-RunHost.ps1</code>，它会打包 <code>visual_studio_code_plugin</code> 的浏览器 bundle。");
    }

    async function main() {
        bindDom();
        wireEvents();
        selectBackend(BACKEND_JAVASCRIPT);

        if (IS_CLI_MODE) {
            startCliSession();
            return;
        }

        if (location.protocol === "file:") {
            banner("当前页面通过 <code>file://</code> 打开，浏览器不允许从 <code>file://</code> 加载 WebAssembly。" +
                "请双击 <code>run.cmd</code>（或执行 <code>node serve.mjs</code>），脚本会启动本地静态服务器并自动打开浏览器。");
            setStatus("Needs a local server");
            return;
        }

        await probeJavaScriptBackend();
        await loadProgramList();
    }

    void main();
})();
