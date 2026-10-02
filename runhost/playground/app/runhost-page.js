/*
 * Pure RunHost page (`runhost.html`): sample picker + local file + backend
 * selector + Run/Stop. The actual runtime bridges live in shell-core.js.
 */
(() => {
    "use strict";

    const shell = window.SmallBasicRunHostShell;
    if (!shell) {
        throw new Error("SmallBasicRunHostShell 未加载，请先引入 shell-core.js。");
    }

    const isCliMode = new URLSearchParams(location.search).has("session");
    const state = {
        programs: [],
        program: null
    };

    // Static HTML ships the Chinese copy; non-zh browsers swap markers to
    // English (see shell-core.js SmallBasicRunHostShell.applyStaticText).
    shell.applyStaticText({
        fileField: "Open .sb file…",
        fileFieldTitle: "Choose a local .sb file; you can also drag one onto the page.",
        blazorError: "An unhandled error occurred while running the Small Basic Blazor WASM backend."
    });
    const chinese = shell.isChineseLocale();
    const TEXT = {
        fileProtocolBanner: chinese
            ? "当前页面通过 <code>file://</code> 打开，浏览器不允许从 <code>file://</code> 加载 WebAssembly。请双击 <code>run.bat</code>（或执行 <code>node serve.mjs</code>），脚本会启动本地静态服务器并自动打开浏览器。"
            : 'This page was opened via <code>file://</code>, and browsers cannot load WebAssembly from <code>file://</code>. Double-click <code>run.bat</code> (or run <code>node serve.mjs</code>); it starts a local static server and opens the browser automatically.',
        localFileLabel: (name) => chinese ? `本地文件：${name}` : `Local file: ${name}`
    };

    const dom = bindDom();
    const controller = shell.createRunHostController({ dom, cliMode: isCliMode });

    wireEvents();
    void main();

    function bindDom() {
        return {
            page: document.getElementById("web-runhost"),
            program: document.getElementById("program-select"),
            backend: document.getElementById("backend-select"),
            run: document.getElementById("run-button"),
            stop: document.getElementById("stop-button"),
            status: document.getElementById("status"),
            file: document.getElementById("file-input"),
            diagnostics: document.getElementById("diagnostics"),
            console: document.getElementById("console"),
            inputRow: document.getElementById("input-row"),
            inputPrompt: document.getElementById("input-prompt"),
            inputField: document.getElementById("input-field"),
            outputNote: document.getElementById("output-note"),
            blazorHost: document.getElementById("blazor-host")
        };
    }

    function wireEvents() {
        dom.run.addEventListener("click", () => {
            void controller.runProgram(currentSnapshot());
        });
        dom.stop.addEventListener("click", () => {
            void controller.stopRun();
        });
        dom.program.addEventListener("change", () => {
            void selectProgram(dom.program.value);
        });
        dom.backend.addEventListener("change", async () => {
            if (controller.isRunning()) {
                await controller.stopRun();
            }
            controller.selectBackend(dom.backend.value);
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

        window.addEventListener("unhandledrejection", (event) => {
            if (isBenignDelayRejection(event.reason)) {
                event.preventDefault();
                return;
            }

            console.error("Small Basic runtime failure:", event.reason);
            if (controller.isRunning()) {
                controller.setStatus("Failed");
            }
        });
    }

    async function main() {
        if (isCliMode) {
            controller.startCliSession();
            return;
        }

        if (location.protocol === "file:") {
            controller.banner(TEXT.fileProtocolBanner);
            controller.setStatus("Needs a local server");
            return;
        }

        await controller.probeJavaScriptBackend();
        const manifest = await shell.loadProgramManifest();
        state.programs = manifest.items;
        populatePrograms(manifest.items);
        await selectProgram(manifest.default);
    }

    function populatePrograms(programs) {
        dom.program.textContent = "";
        for (const program of programs) {
            const option = document.createElement("option");
            option.value = program.path;
            option.textContent = program.name || program.path;
            dom.program.appendChild(option);
        }
    }

    async function selectProgram(path) {
        const program = state.programs.find((item) => item.path === path);
        if (!program) {
            return;
        }

        try {
            const resolved = await shell.ensureProgramSource(program);
            state.program = resolved;
            dom.program.value = resolved.path;
            if (!controller.isRunning()) {
                controller.setStatus(`Loaded ${resolved.name}`);
            }
            if (resolved.graphics && controller.getBackend() !== shell.BACKEND_BLAZOR) {
                controller.selectBackend(shell.BACKEND_BLAZOR);
            }
        } catch (error) {
            controller.showRuntimeDiagnostics(error && error.message ? error.message : String(error));
            controller.setStatus("Failed");
        }
    }

    async function loadFile(file) {
        if (!file) {
            return;
        }

        const source = shell.stripBom(await file.text());
        const label = TEXT.localFileLabel(file.name);
        let program = state.programs.find((item) => item.local === true);
        if (program) {
            program.name = label;
            program.source = source;
            program.graphics = shell.detectGraphicsUsage(source);
            const option = dom.program.querySelector('option[value="local:"]');
            if (option) {
                option.textContent = label;
            }
        } else {
            program = {
                path: "local:",
                name: label,
                source,
                graphics: shell.detectGraphicsUsage(source),
                local: true
            };
            state.programs.push(program);
            const option = document.createElement("option");
            option.value = program.path;
            option.textContent = program.name;
            dom.program.appendChild(option);
        }

        state.program = program;
        dom.program.value = program.path;
        controller.setStatus(`Loaded ${program.name}`);
        if (program.graphics && controller.getBackend() !== shell.BACKEND_BLAZOR) {
            controller.selectBackend(shell.BACKEND_BLAZOR);
        }
    }

    function currentSnapshot() {
        if (!state.program) {
            return null;
        }

        return {
            name: state.program.name || "program.sb",
            source: state.program.source || ""
        };
    }

    function isBenignDelayRejection(reason) {
        const text = String(reason && reason.message ? reason.message : reason);
        const source = state.program && state.program.source ? state.program.source : "";
        return text.indexOf("Evaluation stack empty") >= 0
            && /program\s*\.\s*delay\s*\(/i.test(source);
    }
})();
