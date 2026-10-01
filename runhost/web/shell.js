/* Compatibility shim for legacy pages that still reference shell.js.
   The actual implementation now lives in shell-core.js + runhost-page.js. */
(() => {
    "use strict";

    function load(source, onload) {
        const script = document.createElement("script");
        script.src = source;
        if (onload) {
            script.onload = onload;
        }
        document.head.appendChild(script);
    }

    if (window.SmallBasicRunHostShell) {
        load("runhost-page.js");
        return;
    }

    load("shell-core.js", () => load("runhost-page.js"));
})();
