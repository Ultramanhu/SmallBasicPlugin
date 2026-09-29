/*
 * VS Code webview glue for the Blazor WebAssembly backend.
 *
 * The VS Code extension (visual_studio_code_plugin/packages/smallbasic-vscode,
 * src/web/blazor-webview.ts) opens a webview whose <base href> points at this
 * folder and which loads:
 *
 *   _framework/blazor.webassembly.js   (autostart=false)
 *   vscode-webview.js                  (this file)
 *
 * The webview plays the role that shell.js plays for the standalone web RunHost:
 *   host -> page : { type: "run", name, source } | { type: "stop" }
 *   page -> host : { type: "ready" } | { type: "output", text }
 *                  { type: "notify", json } | { type: "failed", text }
 *
 * It has no VS Code API dependency beyond acquireVsCodeApi(), so the same file can
 * be loaded in a plain browser for manual testing (messages are then logged).
 */
(() => {
    "use strict";

    const ASSEMBLY = "SmallBasic.Blazor.Client";
    const api = typeof acquireVsCodeApi === "function"
        ? acquireVsCodeApi()
        : { postMessage: (message) => console.log("[smallbasic-webview]", message) };

    const post = (message) => api.postMessage(message);

    /*
     * The webview document lives on vscode-webview://<id> while the Blazor payload
     * is served by the extension resource host (a *.vscode-cdn.net origin), so the
     * document has no <base> element pointing at the payload: Blazor rejects a base
     * URI that does not contain the current location at startup. This script always
     * sits next to the payload, so its own URL is the absolute payload root.
     */
    function resolvePayloadBase() {
        const current = document.currentScript;
        const source = current && current.src
            ? current.src
            : (document.querySelector('script[src*="vscode-webview.js"]') || { src: "" }).src;
        const separator = source.lastIndexOf("/");
        return separator > 0 ? source.slice(0, separator + 1) : "";
    }

    const payloadBase = resolvePayloadBase();

    /*
     * Two boot resources need an explicit URL because they cannot be resolved
     * relative to the document:
     *
     * - "dotnetjs": the runtime module, which is otherwise looked up under
     *   document.baseURI. Blazor reports the same type for dotnet.js,
     *   dotnet.native.js and dotnet.runtime.js, so only the module itself is
     *   redirected; the siblings keep their (already absolute) default URL, and
     *   every remaining boot resource resolves relative to the module URL.
     * - "manifest" (blazor.boot.json): dotnet.js fetches it with
     *   `credentials: "include"`, which browsers only allow when the resource host
     *   echoes the webview origin *and* allows credentials - a plain
     *   `Access-Control-Allow-Origin: *` host fails with "must not be the wildcard
     *   '*' when the request's credentials mode is 'include'". Returning a Promise
     *   from loadBootResource replaces that request with our own credential-free
     *   fetch; returning a string (or undefined) for every other type leaves the
     *   remaining resources on their default, credential-free code path.
     */
    function loadBootResource(type, name, defaultUri) {
        if (type === "dotnetjs" && name === "dotnet.js") {
            return `${payloadBase}_framework/dotnet.js`;
        }

        if (type === "manifest") {
            return fetch(`${payloadBase}_framework/blazor.boot.json`, {
                cache: "no-cache",
                credentials: "omit"
            });
        }

        return defaultUri;
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

    // Probed by Runner.razor (WebRunHost.IsEmbeddedAsync): true means the runner
    // waits for SetSession instead of reading a descriptor from the CLI RunHost API.
    window.SmallBasicWebHost = {
        isWebRunHost: () => true,

        // TextWindow output: kept in the page's console (DevTools of the webview)
        // and forwarded to the extension, which mirrors it into an output channel.
        write(text) {
            const line = text.replace(/\n$/, "");
            if (line.length > 0) {
                console.log(line);
            }

            post({ type: "output", text });
        },

        // Lifecycle messages (ready/terminated/stopped) from WebShellTransport.
        notify(json) {
            post({ type: "notify", json });
        }
    };

    window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message.type !== "string") {
            return;
        }

        void (async () => {
            try {
                if (message.type === "run") {
                    await startBlazor();
                    await invoke("SetSession", JSON.stringify({
                        name: message.name || "program.sb",
                        source: message.source || ""
                    }));
                } else if (message.type === "stop") {
                    await invoke("Stop");
                }
            } catch (error) {
                const text = error && error.stack ? error.stack : String(error);
                console.error(text);
                post({ type: "failed", text });
            }
        })();
    });

    // Tells the extension the page can receive "run" messages. The Blazor runtime
    // itself is only started on the first run, so opening the panel is cheap.
    post({ type: "ready" });
})();
