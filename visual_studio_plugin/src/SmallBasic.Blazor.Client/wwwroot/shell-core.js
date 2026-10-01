/*
 * Shared browser shell for the standalone RunHost (`runhost.html`) and the
 * Monaco playground (`playground.html`). The page-specific scripts supply the
 * source being run; this file owns backend selection, text I/O, lifecycle state
 * and the JavaScript/Blazor runtime bridges.
 */
(() => {
    "use strict";

    const BACKEND_JAVASCRIPT = "javascript";
    const BACKEND_BLAZOR = "blazor";
    const BLAZOR_ASSEMBLY = "SmallBasic.Blazor.Client";

    // UI hints follow the browser language: zh-* keeps the Chinese copy that
    // ships baked into the pages, everything else gets English. An explicit
    // pick made through the header toggle (saved in localStorage) wins over
    // detection, and any zh entry in the preference list counts as Chinese —
    // developers often run an English-first browser on a Chinese machine.
    const LOCALE_STORAGE_KEY = "smallbasic.uiLocale";
    const SAVED_LOCALE = (() => {
        try {
            return window.localStorage.getItem(LOCALE_STORAGE_KEY);
        } catch {
            return null;
        }
    })();
    const CHINESE_LOCALE = SAVED_LOCALE
        ? SAVED_LOCALE === "zh"
        : ((navigator.languages && navigator.languages.some((item) => item && item.toLowerCase().startsWith("zh")))
            || (navigator.language || "").toLowerCase().startsWith("zh"));

    const MESSAGES = {
        zh: {
            builtinSampleName: () => "Hello, World!（内置）",
            scriptLoadFailed: (source) => `无法加载 ${source}`,
            jsExportMissing: () => "smallbasic-js.js 未导出 SmallBasicWeb.runJavaScript",
            blazorStartMissing: () => "_framework/blazor.webassembly.js 未提供 Blazor.start",
            dotNetInteropUnavailable: () => "DotNet 互操作接口不可用",
            outputNoteBlazor: () => "Blazor WASM 后端：GraphicsWindow 绘制在下方，TextWindow 输出同时写入浏览器控制台。",
            outputNoteTextWindow: () => "TextWindow 输出同时写入浏览器控制台（F12 / Console）。",
            missingJsBundleBanner: () => "当前分发缺少 <code>smallbasic-js.js</code>（浏览器 JavaScript 后端），只提供 Blazor WASM 后端。完整分发请执行 <code>runhost\\Build-RunHost.ps1</code>，它会打包 <code>visual_studio_code_plugin</code> 的浏览器 bundle。",
            jsBackendUnavailable: (detail) => "JavaScript 后端不可用：" + detail +
                "\n请使用完整的 runhost/web 分发（其中包含 smallbasic-js.js），或改用 Blazor WASM 后端。",
            blazorLoadFailed: (detail) => "Blazor WASM 运行时加载失败：" + detail +
                "\n请确认当前页面通过 HTTP 提供（使用 node runhost/web/serve.mjs，或双击 run.bat），而不是直接用 file:// 打开。",
            blazorStartupTimeout: () => "Blazor WASM 运行时未在 30 秒内响应，请查看页面底部的错误提示后重新加载页面。",
            programLoadFailed: (name, status) => `无法加载 ${name}：HTTP ${status}`
        },
        en: {
            builtinSampleName: () => "Hello, World! (built-in)",
            scriptLoadFailed: (source) => `Failed to load ${source}`,
            jsExportMissing: () => "smallbasic-js.js does not export SmallBasicWeb.runJavaScript",
            blazorStartMissing: () => "_framework/blazor.webassembly.js does not provide Blazor.start",
            dotNetInteropUnavailable: () => "The DotNet interop interface is unavailable",
            outputNoteBlazor: () => "Blazor WASM backend: GraphicsWindow renders below; TextWindow output is also mirrored to the browser console (F12 / Console).",
            outputNoteTextWindow: () => "TextWindow output is also mirrored to the browser console (F12 / Console).",
            missingJsBundleBanner: () => 'This distribution is missing <code>smallbasic-js.js</code> (the browser JavaScript backend), so only the Blazor WASM backend is available. For the full distribution run <code>runhost\\Build-RunHost.ps1</code>, which packages the browser bundles from <code>visual_studio_code_plugin</code>.',
            jsBackendUnavailable: (detail) => "The JavaScript backend is unavailable: " + detail +
                "\nUse a complete runhost/web distribution (which includes smallbasic-js.js), or switch to the Blazor WASM backend.",
            blazorLoadFailed: (detail) => "Failed to load the Blazor WASM runtime: " + detail +
                "\nMake sure the page is served over HTTP (run node runhost/web/serve.mjs or double-click run.bat) instead of opening it via file://.",
            blazorStartupTimeout: () => "The Blazor WASM runtime did not respond within 30 seconds. Check the error at the bottom of the page, then reload.",
            programLoadFailed: (name, status) => `Failed to load ${name}: HTTP ${status}`
        }
    };
    const t = MESSAGES[CHINESE_LOCALE ? "zh" : "en"];

    const TEXT_COLORS = [
        "#000000", "#000080", "#008000", "#008080", "#800000", "#800080", "#808000", "#c0c0c0",
        "#808080", "#0000ff", "#00ff00", "#00ffff", "#ff0000", "#ff00ff", "#ffff00", "#ffffff"
    ];
    const DEFAULT_FOREGROUND = 15;
    const DEFAULT_BACKGROUND = 0;
    const FALLBACK_PROGRAM = {
        path: "builtin:",
        name: t.builtinSampleName(),
        graphics: false,
        source: [
            "TextWindow.WriteLine(\"Hello, World!\")",
            "",
            "TextWindow.Write(\"What is your name? \")",
            "name = TextWindow.Read()",
            "TextWindow.WriteLine(\"Hello, \" + name + \"!\")"
        ].join("\n")
    };

    let activeController = null;

    class RunHostController {
        constructor(options) {
            this.dom = options.dom;
            this.cliMode = !!options.cliMode;
            this.running = false;
            this.stopped = false;
            this.responded = false;
            this.pendingInput = null;
            this.blazorStart = null;
            this.jsBackend = null;
            this.languageDiagnostics = "";
            this.runtimeDiagnostics = "";

            activeController = this;
            this.bindInput();
            this.bindLocaleToggle();
            this.selectBackend(BACKEND_JAVASCRIPT);
        }

        bindLocaleToggle() {
            const button = document.getElementById("locale-button");
            if (!button) {
                return;
            }

            button.textContent = CHINESE_LOCALE ? "EN" : "中文";
            button.title = CHINESE_LOCALE
                ? "Switch the UI language to English"
                : "切换界面语言为简体中文（跟随浏览器语言，可手动覆盖）";
            button.addEventListener("click", () => {
                try {
                    window.localStorage.setItem(LOCALE_STORAGE_KEY, CHINESE_LOCALE ? "en" : "zh");
                } catch {
                    // Private modes may block storage; the reload still applies
                    // the choice for this page view.
                }
                window.location.reload();
            });
        }

        bindInput() {
            if (!this.dom.inputRow) {
                return;
            }

            this.dom.inputRow.addEventListener("submit", (event) => {
                event.preventDefault();
                const pending = this.pendingInput;
                if (!pending) {
                    return;
                }

                this.pendingInput = null;
                this.dom.inputRow.hidden = true;
                const value = this.dom.inputField.value;
                this.dom.inputField.value = "";
                this.appendConsole(value + "\n", DEFAULT_FOREGROUND, DEFAULT_BACKGROUND);
                this.mirrorToConsole(value);
                pending.resolve(value);
            });
        }

        isEmbeddedCliMode() {
            return this.cliMode;
        }

        getBackend() {
            return this.backend;
        }

        isRunning() {
            return this.running;
        }

        setStatus(text) {
            if (this.dom.status) {
                this.dom.status.textContent = text;
            }
        }

        setRunning(running) {
            this.running = running;
            if (this.dom.run) {
                this.dom.run.disabled = running;
            }
            if (this.dom.stop) {
                this.dom.stop.disabled = !running;
            }
        }

        setLanguageDiagnostics(text) {
            this.languageDiagnostics = text || "";
            this.renderDiagnostics();
        }

        showRuntimeDiagnostics(text) {
            this.runtimeDiagnostics = text || "";
            this.renderDiagnostics();
        }

        clearRuntimeDiagnostics() {
            this.runtimeDiagnostics = "";
            this.renderDiagnostics();
        }

        renderDiagnostics() {
            if (!this.dom.diagnostics) {
                return;
            }

            const sections = [];
            if (this.languageDiagnostics) {
                sections.push(this.languageDiagnostics);
            }
            if (this.runtimeDiagnostics) {
                sections.push(this.runtimeDiagnostics);
            }

            if (sections.length === 0) {
                this.dom.diagnostics.hidden = true;
                this.dom.diagnostics.textContent = "";
                return;
            }

            this.dom.diagnostics.hidden = false;
            this.dom.diagnostics.textContent = sections.join("\n\n");
            if (this.runtimeDiagnostics) {
                console.error(this.runtimeDiagnostics);
            }
        }

        clearConsole() {
            if (this.dom.console) {
                this.dom.console.textContent = "";
            }
        }

        appendConsole(text, foreground, background) {
            if (!text || !this.dom.console) {
                return;
            }

            const span = document.createElement("span");
            span.textContent = text;
            span.style.color = TEXT_COLORS[foreground] || TEXT_COLORS[DEFAULT_FOREGROUND];
            span.style.backgroundColor = TEXT_COLORS[background] || TEXT_COLORS[DEFAULT_BACKGROUND];
            this.dom.console.appendChild(span);
            this.dom.console.scrollTop = this.dom.console.scrollHeight;
        }

        mirrorToConsole(text) {
            if (!text) {
                return;
            }

            const line = text.replace(/\n$/, "");
            if (line.length > 0) {
                console.log(line);
            }
        }

        banner(text) {
            banner(this.dom.page, text);
        }

        requestInput(kind) {
            return new Promise((resolve) => {
                this.pendingInput = { resolve, kind };
                this.dom.inputPrompt.textContent = kind === "number" ? "ReadNumber" : "Read";
                this.dom.inputField.value = "";
                this.dom.inputRow.hidden = false;
                this.dom.inputField.focus();
            });
        }

        resolvePendingInput(value = "") {
            const pending = this.pendingInput;
            this.pendingInput = null;
            if (this.dom.inputRow) {
                this.dom.inputRow.hidden = true;
            }
            if (pending) {
                pending.resolve(value);
            }
        }

        async loadScript(source, attributes) {
            return new Promise((resolve, reject) => {
                const existing = document.querySelector(`script[data-shell-src="${source}"]`);
                const node = existing || document.createElement("script");
                const done = () => {
                    node.dataset.loaded = "true";
                    resolve();
                };
                const failed = () => reject(new Error(t.scriptLoadFailed(source)));

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
                for (const [name, value] of Object.entries(attributes || {})) {
                    node.setAttribute(name, value);
                }

                node.addEventListener("load", done, { once: true });
                node.addEventListener("error", failed, { once: true });
                document.head.appendChild(node);
            });
        }

        loadJavaScriptBackend() {
            if (!this.jsBackend) {
                this.jsBackend = this.loadScript("smallbasic-js.js")
                    .then(() => {
                        const backend = window.SmallBasicWeb;
                        if (!backend || typeof backend.runJavaScript !== "function") {
                            throw new Error(t.jsExportMissing());
                        }
                        return backend;
                    })
                    .catch((error) => {
                        this.jsBackend = null;
                        throw error;
                    });
            }

            return this.jsBackend;
        }

        startBlazor() {
            if (!this.blazorStart) {
                this.blazorStart = (async () => {
                    await this.loadScript("_framework/blazor.webassembly.js", { autostart: "false" });
                    if (!window.Blazor || typeof window.Blazor.start !== "function") {
                        throw new Error(t.blazorStartMissing());
                    }

                    await window.Blazor.start();
                    await this.waitForDotNet();
                })().catch((error) => {
                    this.blazorStart = null;
                    throw error;
                });
            }

            return this.blazorStart;
        }

        async waitForDotNet() {
            for (let attempt = 0; attempt < 100; attempt += 1) {
                if (window.DotNet && typeof window.DotNet.invokeMethodAsync === "function") {
                    return;
                }

                await sleep(50);
            }

            throw new Error(t.dotNetInteropUnavailable());
        }

        invokeBlazor(method, ...args) {
            return window.DotNet.invokeMethodAsync(BLAZOR_ASSEMBLY, method, ...args);
        }

        applyBackend() {
            const blazor = this.backend === BACKEND_BLAZOR;
            if (this.dom.console) {
                this.dom.console.hidden = blazor;
            }
            if (this.dom.inputRow) {
                this.dom.inputRow.hidden = blazor || !this.pendingInput;
            }
            if (this.dom.blazorHost) {
                this.dom.blazorHost.hidden = !blazor;
            }
            if (this.dom.outputNote) {
                this.dom.outputNote.textContent = blazor ? t.outputNoteBlazor() : t.outputNoteTextWindow();
            }
            if (this.dom.page) {
                this.dom.page.dataset.backend = this.backend;
            }
            if (this.dom.backend) {
                this.dom.backend.value = this.backend;
            }
        }

        selectBackend(backend) {
            this.backend = backend === BACKEND_BLAZOR ? BACKEND_BLAZOR : BACKEND_JAVASCRIPT;
            this.applyBackend();
        }

        async probeJavaScriptBackend() {
            let available = false;
            try {
                const response = await fetch("smallbasic-js.js", { method: "HEAD", cache: "no-store" });
                available = response.ok;
            } catch {
                available = false;
            }

            if (available || !this.dom.backend) {
                return;
            }

            const option = this.dom.backend.querySelector(`option[value="${BACKEND_JAVASCRIPT}"]`);
            if (option) {
                option.remove();
            }

            if (this.backend === BACKEND_JAVASCRIPT) {
                this.selectBackend(BACKEND_BLAZOR);
            }

            this.setStatus("Blazor backend only");
            this.banner(t.missingJsBundleBanner());
        }

        async runProgram(snapshot) {
            if (!snapshot || !snapshot.source || !snapshot.source.trim()) {
                this.setStatus("Nothing to run");
                return;
            }

            this.clearRuntimeDiagnostics();
            this.clearConsole();
            this.stopped = false;
            if (this.backend === BACKEND_BLAZOR) {
                await this.runBlazor(snapshot);
            } else {
                await this.runJavaScript(snapshot);
            }
        }

        async runJavaScript(snapshot) {
            let backend;
            try {
                this.setStatus("Loading JavaScript engine…");
                backend = await this.loadJavaScriptBackend();
            } catch (error) {
                this.showRuntimeDiagnostics(t.jsBackendUnavailable(describe(error)));
                this.setStatus("Failed");
                return;
            }

            this.setRunning(true);
            this.setStatus(snapshot.modelVersion ? `Running ${snapshot.name} (v${snapshot.modelVersion})…` : "Running");
            try {
                const exitCode = await backend.runJavaScript(snapshot.source, {
                    writeText: (text, newLine, foreground, background) => {
                        const chunk = newLine ? text + "\n" : text;
                        this.appendConsole(chunk, foreground, background);
                        this.mirrorToConsole(chunk);
                    },
                    readInput: (kind) => this.requestInput(kind),
                    writeError: (text) => this.showRuntimeDiagnostics(text)
                });

                this.setRunning(false);
                this.setStatus(this.exitStatus(exitCode));
            } catch (error) {
                this.showRuntimeDiagnostics(describe(error));
                this.setRunning(false);
                this.setStatus("Failed");
            } finally {
                this.resolvePendingInput();
            }
        }

        async runBlazor(snapshot) {
            this.setRunning(true);
            try {
                if (!this.blazorStart) {
                    this.setStatus("Loading Blazor WASM runtime…");
                }

                await this.startBlazor();
                this.setStatus(snapshot.modelVersion ? `Starting ${snapshot.name} (v${snapshot.modelVersion})…` : "Starting program…");
                this.responded = false;
                await this.invokeBlazor("SetSession", JSON.stringify({
                    name: snapshot.name || "program.sb",
                    source: snapshot.source
                }));
                this.armStartupWatchdog();
            } catch (error) {
                this.showRuntimeDiagnostics(t.blazorLoadFailed(describe(error)));
                this.setRunning(false);
                this.setStatus("Failed");
            }
        }

        armStartupWatchdog() {
            window.setTimeout(() => {
                if (this.responded || !this.running) {
                    return;
                }

                this.setRunning(false);
                this.setStatus("Blazor runtime did not respond");
                this.showRuntimeDiagnostics(t.blazorStartupTimeout());
            }, 30000);
        }

        async stopRun() {
            if (!this.running) {
                return;
            }

            this.stopped = true;
            if (this.backend === BACKEND_JAVASCRIPT) {
                if (window.SmallBasicWeb && typeof window.SmallBasicWeb.stopJavaScript === "function") {
                    window.SmallBasicWeb.stopJavaScript();
                }

                this.resolvePendingInput();
                this.setStatus("Stopping…");
                return;
            }

            this.setStatus("Stopping…");
            try {
                await this.invokeBlazor("Stop");
            } catch (error) {
                console.warn("Stop failed:", error);
            }
        }

        startCliSession() {
            document.body.classList.add("web-cli-mode");
            this.selectBackend(BACKEND_BLAZOR);
            this.setStatus("Starting Blazor WASM runtime…");
            this.startBlazor().catch((error) => {
                this.showRuntimeDiagnostics(describe(error));
                this.setStatus("Failed");
            });
        }

        handleHostNotification(message) {
            this.responded = true;
            if (message.type === "ready") {
                this.setStatus("Running");
                return;
            }

            if (message.type === "stopped") {
                this.setStatus(`Paused: ${message.reason || "breakpoint"}`);
                return;
            }

            if (message.type === "terminated") {
                this.setRunning(false);
                this.setStatus(this.exitStatus(message.exitCode));
            }
        }

        exitStatus(exitCode) {
            if (this.stopped) {
                return "Stopped";
            }

            return exitCode === 0 ? "Completed" : `Exited with code ${exitCode}`;
        }

        dispose() {
            if (activeController === this) {
                activeController = null;
            }
        }
    }

    window.SmallBasicWebHost = {
        isWebRunHost: () => !(activeController && activeController.isEmbeddedCliMode()),
        write(text) {
            activeController && activeController.mirrorToConsole(text);
        },
        notify(json) {
            if (!activeController) {
                return;
            }

            let message;
            try {
                message = JSON.parse(json);
            } catch {
                return;
            }

            activeController.handleHostNotification(message);
        }
    };

    window.SmallBasicRunHostShell = {
        BACKEND_JAVASCRIPT,
        BACKEND_BLAZOR,
        FALLBACK_PROGRAM,
        isChineseLocale: () => CHINESE_LOCALE,
        // Swaps [data-i18n] / [data-i18n-title] markers to the English table
        // when the browser is not zh-*. The Chinese copy ships baked into the
        // HTML as the default, so Chinese users see no swap (and no flash).
        // Elements carrying data-i18n must be leaf text elements.
        applyStaticText(table) {
            if (CHINESE_LOCALE) {
                return;
            }

            for (const element of document.querySelectorAll("[data-i18n]")) {
                const value = table[element.dataset.i18n];
                if (typeof value === "string") {
                    element.textContent = value;
                }
            }
            for (const element of document.querySelectorAll("[data-i18n-title]")) {
                const value = table[element.dataset.i18nTitle];
                if (typeof value === "string") {
                    element.title = value;
                }
            }
            document.documentElement.lang = "en";
        },
        createRunHostController(options) {
            return new RunHostController(options);
        },
        async loadProgramManifest() {
            let manifest = null;
            try {
                const response = await fetch("samples/index.json", { cache: "no-store" });
                if (response.ok) {
                    manifest = await response.json();
                }
            } catch {
                manifest = null;
            }

            const items = manifest && Array.isArray(manifest.items)
                ? manifest.items.filter((item) => item && item.path)
                : [];

            if (items.length === 0) {
                return {
                    default: FALLBACK_PROGRAM.path,
                    items: [Object.assign({}, FALLBACK_PROGRAM)]
                };
            }

            return {
                default: items.some((item) => item.path === manifest.default) ? manifest.default : items[0].path,
                items
            };
        },
        async ensureProgramSource(program) {
            if (program.source !== undefined) {
                return program;
            }

            const response = await fetch(program.path, { cache: "no-store" });
            if (!response.ok) {
                throw new Error(t.programLoadFailed(program.name, response.status));
            }

            program.source = stripBom(await response.text());
            if (program.graphics !== true) {
                program.graphics = detectGraphicsUsage(program.source);
            }
            return program;
        },
        stripBom,
        detectGraphicsUsage,
        banner(targetPage, text) {
            banner(targetPage, text);
        }
    };

    function sleep(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    function describe(error) {
        return error && error.stack ? error.stack : String(error);
    }

    function banner(targetPage, text) {
        const node = document.createElement("div");
        node.className = "web-banner";
        node.innerHTML = text;
        targetPage.insertBefore(node, targetPage.firstChild);
    }

    function stripBom(text) {
        return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    }

    function detectGraphicsUsage(source) {
        return /\b(GraphicsWindow|Shapes|Turtle)\s*[\.(]/i.test(source || "");
    }
})();
