import path from "node:path";
import { defineConfig } from "tsup";

// Extension-host bundles (desktop and Web Worker) ship source maps so that F5
// breakpoints bind to src/**/*.ts instead of the generated single file - without
// them debugging the extension itself needs a step through dist/*.js.
// SMALLBASIC_NO_SOURCEMAPS=1 builds without them (smaller VSIX payload, since
// package.json ships dist/**).
const sourcemap = process.env.SMALLBASIC_NO_SOURCEMAPS !== "1";

export default defineConfig([
  {
    // "debug/adapter" keeps the historical dist/debug/adapter.js layout: both the
    // extension (src/debug/factory.ts) and the Visual Studio VSIX packaging script
    // (visual_studio_plugin/build/Package-Vsix.ps1) reference that exact path.
    entry: {
      extension: "src/extension.ts",
      "debug/adapter": "src/debug/adapter.ts",
      runhost: "src/runhost/main.ts"
    },
    format: "cjs",
    target: "node20",
    platform: "node",
    clean: true,
    sourcemap,
    external: ["vscode"],
    noExternal: ["smallbasic-lang-core", "smallbasic-language-services"]
  },
  {
    // VS Code for the Web executes this single-file bundle in a WebWorker. The
    // inline debug adapter keeps execution in that browser extension host.
    entry: {
      "web/extension": "src/web/extension.ts"
    },
    format: "cjs",
    target: "es2022",
    platform: "browser",
    clean: false,
    sourcemap,
    external: ["vscode"],
    noExternal: [
      "smallbasic-lang-core",
      "smallbasic-language-services",
      "@vscode/debugadapter",
      "@vscode/debugprotocol",
      "buffer",
      "events",
      "process",
      "url"
    ],
    esbuildOptions(options) {
      options.inject = [path.resolve(__dirname, "src", "web", "polyfills.ts")];
    }
  },
  {
    // JavaScript backend of the standalone web RunHost (runhost/web): one classic
    // script that defines window.SmallBasicWeb for the shell page, so the browser
    // needs neither Node.js nor a server to run TextWindow programs.
    entry: {
      "web-runhost": "src/runhost/web.ts"
    },
    format: "iife",
    target: "es2022",
    platform: "browser",
    clean: false,
    outExtension: () => ({ js: ".js" }),
    noExternal: ["smallbasic-lang-core", "smallbasic-language-services"]
  }
]);
