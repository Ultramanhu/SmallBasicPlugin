/*
 * Assembles the unified local-playground staging root `runhost/playground/`
 * (design doc 10, §18.5 / §19.1):
 *
 *   runhost/playground/
 *   |- app/               # one shared playground site (playground-dist + Blazor
 *   |                     #   wwwroot shell + web JS backend + desktop bridge)
 *   |- bin/               # target-specific single-file sidecar, `<name>-<triple>[.exe]`
 *   |- resources/         # Windows only: the .NET Framework 4.8 folder host
 *   \- manifest.json      # files, SHA-256 and target triple
 *
 * Two .NET RunHost flavours are staged:
 *
 * - .NET 8: self-contained single file in `bin/`, selected by `tauri build`
 *   for the current triple through `bundle.externalBin`;
 * - .NET Framework 4.8: cannot be published as a single file, so it ships as a
 *   folder under `resources/dotnet/csharp-net48` and travels through
 *   `bundle.resources`. Only Windows targets declare that resources glob
 *   (`tauri.windows.conf.json`), because a glob with no match fails the Tauri
 *   build (`tauri-utils resources.rs` -> GlobPathNotFound).
 *
 * The Node and Blazor CLI backends were removed on 2026-10-03.
 *
 * Usage:
 *   node scripts/stage-playground.mjs [--skip-build] [--skip-sidecars]
 *                                     [--target <triple>] [--configuration Debug]
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.dirname(SCRIPT_ROOT);
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, "..", ".."); // visual_studio_code_plugin
const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "..");
const STAGE_ROOT = path.join(REPO_ROOT, "runhost", "playground");
const STAGE_APP = path.join(STAGE_ROOT, "app");
const STAGE_BIN = path.join(STAGE_ROOT, "bin");
const STAGE_RESOURCES = path.join(STAGE_ROOT, "resources");

/** Folder payload of the .NET Framework 4.8 host, relative to STAGE_RESOURCES. */
const NET48_PAYLOAD = path.join("dotnet", "csharp-net48");

const VSCODE_PACKAGE = path.join(WORKSPACE_ROOT, "packages", "smallbasic-vscode");
const PLAYGROUND_DIST = path.join(VSCODE_PACKAGE, "playground-dist");
const VSCODE_DIST = path.join(VSCODE_PACKAGE, "dist");
const BLAZOR_RUNHOST_CSPROJ = path.join(
    REPO_ROOT, "visual_studio_plugin", "src", "SmallBasic.Blazor.RunHost", "SmallBasic.Blazor.RunHost.csproj");
const CSHARP_RUNHOST_CSPROJ = path.join(
    REPO_ROOT, "visual_studio_plugin", "src", "SmallBasic.RunHost", "SmallBasic.RunHost.csproj");

const RID_BY_TRIPLE = {
    "x86_64-pc-windows-msvc": "win-x64",
    "aarch64-pc-windows-msvc": "win-arm64",
    "x86_64-apple-darwin": "osx-x64",
    "aarch64-apple-darwin": "osx-arm64",
    "x86_64-unknown-linux-gnu": "linux-x64",
    "aarch64-unknown-linux-gnu": "linux-arm64"
};

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const skipSidecars = args.includes("--skip-sidecars");
const targetFlag = readOption("--target");
const configuration = readOption("--configuration") || "Release";

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});

async function main() {
    const targetTriple = targetFlag || hostTriple();
    // Mobile targets bundle no sidecars: the .NET hosts do not ship for
    // Android, and the page falls back to its two Web backends there.
    const isAndroid = targetTriple.endsWith("-android");
    const rid = RID_BY_TRIPLE[targetTriple];
    if (!rid && !isAndroid) {
        throw new Error(`Unsupported target triple: ${targetTriple}. Known triples: ${Object.keys(RID_BY_TRIPLE).join(", ")}`);
    }

    console.log(`==> Staging the local playground for ${targetTriple}${rid ? ` (${rid})` : ""} into ${STAGE_ROOT}`);
    ensurePrerequisites();

    // 1. Shared page site: playground-dist + Blazor shell + web JS backend.
    composeApp();

    // Payload trees of removed backends must never reach a bundle. The current
    // .NET Framework host payload is deliberately kept so `--skip-sidecars` can
    // reuse it (the Windows resources glob must keep matching at least a file).
    for (const obsolete of [
        path.join(STAGE_RESOURCES, "javascript"),
        path.join(STAGE_RESOURCES, "dotnet", "blazor"),
        path.join(STAGE_RESOURCES, "dotnet", "csharp")
    ]) {
        fs.rmSync(obsolete, { recursive: true, force: true });
    }

    const windows = targetTriple.includes("windows");
    const exeSuffix = windows ? ".exe" : "";

    // The .NET Framework host is Windows-only; a payload staged for another
    // platform must not be packaged.
    if (!windows) {
        fs.rmSync(path.join(STAGE_RESOURCES, NET48_PAYLOAD), { recursive: true, force: true });
    }

    // bin/ must hold exactly the sidecar of the current target (nothing at
    // all on Android, which has no sidecar).
    pruneStaleSidecars(targetTriple, exeSuffix, isAndroid);

    // 2. Target-specific payloads.
    if (!skipSidecars && !isAndroid) {
        stageSidecars(targetTriple, rid, exeSuffix);
    } else {
        console.log("==> Skipping sidecar staging");
    }

    // 3. Manifest with hashes for CI verification (doc 10, §18.5).
    writeManifest(targetTriple);

    console.log(`==> Local playground staged. Sidecar binaries live in ${STAGE_BIN}`);
    console.log("    Next: npm run dev (tauri dev) or npm run build:app (tauri build).");
}

function readOption(name) {
    const index = args.indexOf(name);
    if (index === -1 || index + 1 >= args.length) {
        return undefined;
    }

    return args[index + 1];
}

function hostTriple() {
    const windows = process.platform === "win32";
    const arm = process.arch === "arm64";
    if (windows) {
        return arm ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    }
    if (process.platform === "darwin") {
        return arm ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    }
    if (process.platform === "linux") {
        return arm ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
    }

    throw new Error(`Unsupported host platform: ${process.platform}`);
}

function ensurePrerequisites() {
    if (!fs.existsSync(BLAZOR_RUNHOST_CSPROJ)) {
        throw new Error(`Blazor RunHost project not found: ${BLAZOR_RUNHOST_CSPROJ}`);
    }
    if (!fs.existsSync(CSHARP_RUNHOST_CSPROJ)) {
        throw new Error(`C# RunHost project not found: ${CSHARP_RUNHOST_CSPROJ}`);
    }

    if (!skipBuild) {
        if (!fs.existsSync(path.join(VSCODE_PACKAGE, "dist", "web-runhost.js"))) {
            console.log("==> Building the VS Code workspace bundles (tsup)");
            run("npm", ["run", "build"], { cwd: WORKSPACE_ROOT });
        }

        if (!fs.existsSync(path.join(PLAYGROUND_DIST, "playground.html"))) {
            console.log("==> Building the playground page bundle");
            run("npm", ["run", "build:playground", "--workspace", "smallbasic-tools-vsc"], { cwd: WORKSPACE_ROOT });
        }
    }

    if (!fs.existsSync(path.join(PLAYGROUND_DIST, "playground.html"))) {
        throw new Error(
            `Playground assets are missing: ${PLAYGROUND_DIST}. Run 'npm run build:playground --workspace smallbasic-tools-vsc' first.`);
    }

    const blazorWwwroot = publishBlazorRunHost(configuration);
    if (!fs.existsSync(path.join(blazorWwwroot, "_framework", "blazor.webassembly.js"))) {
        throw new Error(
            `The Blazor publish output is incomplete: ${blazorWwwroot}. Build runhost/blazor first (runhost/Build-RunHost.ps1).`);
    }

    // Only the in-browser JavaScript backend bundle is staged now; it lands in
    // the app as `smallbasic-js.js`. The CLI run/DAP bundles are gone.
    if (!fs.existsSync(path.join(VSCODE_DIST, "web-runhost.js"))) {
        throw new Error(
            `Browser bundle missing: ${path.join(VSCODE_DIST, "web-runhost.js")}. Run 'npm run build' in ${WORKSPACE_ROOT} first.`);
    }
}

/** Publishes (or reuses) runhost/blazor and returns its wwwroot path. */
function publishBlazorRunHost(configuration) {
    const destination = path.join(REPO_ROOT, "runhost", "blazor");
    const wwwroot = path.join(destination, "wwwroot");
    if (fs.existsSync(path.join(wwwroot, "_framework", "blazor.webassembly.js"))) {
        return wwwroot;
    }

    console.log(`==> Publishing SmallBasic.Blazor.RunHost (${configuration}) to ${destination}`);
    run("dotnet", [
        "publish", BLAZOR_RUNHOST_CSPROJ,
        "-c", configuration,
        "-f", "net8.0",
        "-o", destination,
        "--nologo"
    ]);
    return wwwroot;
}

function composeApp() {
    console.log("==> Composing runhost/playground/app");
    if (!skipBuild) {
        console.log("==> Building the desktop bridge bundle (desktop.js)");
        run("node", [path.join(PACKAGE_ROOT, "scripts", "build-desktop.mjs")]);
    }

    const desktopBundle = path.join(PACKAGE_ROOT, "dist", "desktop.js");
    if (!fs.existsSync(desktopBundle)) {
        throw new Error(
            "The desktop bridge bundle is missing. Run 'npm run build' in smallbasic-playground-desktop first.");
    }

    fs.rmSync(STAGE_APP, { recursive: true, force: true });
    fs.mkdirSync(STAGE_APP, { recursive: true });

    // One copy of the playground page bundle.
    fs.cpSync(PLAYGROUND_DIST, STAGE_APP, { recursive: true });
    // The Blazor client's published wwwroot contributes the shared shell
    // (runhost.html, app.css, shell-core.js, runhost-page.js) plus the WASM
    // runtime for the Web Blazor backend - the same merge runhost/web gets.
    fs.cpSync(path.join(REPO_ROOT, "runhost", "blazor", "wwwroot"), STAGE_APP, { recursive: true });

    fs.copyFileSync(
        path.join(VSCODE_DIST, "web-runhost.js"),
        path.join(STAGE_APP, "smallbasic-js.js"));
    // The desktop bridge is only loaded through the script tag injected below;
    // browser deployments of runhost/web never receive this file.
    fs.copyFileSync(desktopBundle, path.join(STAGE_APP, "desktop.js"));

    injectDesktopScriptTag(path.join(STAGE_APP, "playground.html"));
    stageSamples();
}

/** Loads the desktop bridge only in the staged (Tauri) copy of the page. */
function injectDesktopScriptTag(htmlPath) {
    let html = fs.readFileSync(htmlPath, "utf8");
    if (html.includes("desktop.js")) {
        return;
    }

    const marker = '<script type="module" src="playground.js"></script>';
    if (!html.includes(marker)) {
        throw new Error(`playground.html does not contain the expected script marker: ${htmlPath}`);
    }

    html = html.replace(
        marker,
        `${marker}\n    <!-- Desktop bridge, staged by smallbasic-playground-desktop (not part of runhost/web). -->\n    <script type="module" src="desktop.js"></script>`);
    fs.writeFileSync(htmlPath, html);
}

function stageSamples() {
    // tools/stage-samples.mjs is the single sample-staging implementation,
    // shared with the runhost/web static site (runhost/Build-RunHost.ps1).
    console.log("==> Staging samples (tools/stage-samples.mjs)");
    run("node", [path.join(REPO_ROOT, "tools", "stage-samples.mjs"), STAGE_APP]);
}

/**
 * Keeps `bin/` limited to the current target's sidecar: files left behind by a
 * removed backend or by another target triple would otherwise be picked up by
 * `bundle.externalBin` on the next package. Android stages no sidecar at all.
 */
function pruneStaleSidecars(targetTriple, exeSuffix, isAndroid = false) {
    if (!fs.existsSync(STAGE_BIN)) {
        return;
    }

    const expected = new Set(isAndroid ? [] : [`smallbasic-csharp-net8-${targetTriple}${exeSuffix}`]);
    for (const entry of fs.readdirSync(STAGE_BIN, { withFileTypes: true })) {
        if (entry.isFile() && !expected.has(entry.name)) {
            console.log(`==> Removing stale sidecar: ${entry.name}`);
            fs.rmSync(path.join(STAGE_BIN, entry.name), { force: true });
        }
    }
}

function stageSidecars(targetTriple, rid, exeSuffix) {
    fs.mkdirSync(STAGE_BIN, { recursive: true });

    stageNet8Sidecar({
        targetTriple,
        rid,
        exeSuffix,
        // Windows draws natively (net8.0-windows); every other platform stays
        // text-only (portable net8.0), per doc 10 §17.2.
        tfm: targetTriple.includes("windows") ? "net8.0-windows" : "net8.0"
    });

    if (targetTriple.includes("windows")) {
        stageNet48Host();
    } else {
        console.log("==> Skipping the .NET Framework 4.8 host (Windows only)");
    }
}

function stageNet8Sidecar({ targetTriple, rid, exeSuffix, tfm }) {
    const assembly = "SmallBasic.RunHost";
    const publishDir = path.join(PACKAGE_ROOT, "obj", "publish", `csharp-net8-${rid}`);
    console.log(`==> Publishing ${assembly} (${tfm}, ${rid}) for the .NET 8 sidecar`);

    run("dotnet", [
        "publish", CSHARP_RUNHOST_CSPROJ,
        "-c", configuration,
        "-f", tfm,
        "-r", rid,
        "--self-contained", "true",
        "-p:SmallBasicStageSidecar=true",
        "-o", publishDir,
        "--nologo"
    ]);

    // Single-file publish embeds the runtime and the managed assemblies, so the
    // sidecar needs no sibling payload directory.
    const exeName = `${assembly}${exeSuffix}`;
    const exePath = path.join(publishDir, exeName);
    if (!fs.existsSync(exePath)) {
        throw new Error(`The single-file .NET 8 sidecar was not produced: ${exePath}`);
    }

    fs.copyFileSync(exePath, path.join(STAGE_BIN, `smallbasic-csharp-net8-${targetTriple}${exeSuffix}`));
}

/**
 * Publishes the .NET Framework 4.8 host as a folder payload. Single-file
 * publishing is a .NET Core feature and a RID is meaningless for net48, so the
 * `SmallBasicStageSidecar` switch must NOT be used here; the framework resolves
 * the sibling assemblies relative to the executable, and the Rust shell runs it
 * with that folder as its working directory.
 */
function stageNet48Host() {
    const assembly = "SmallBasic.RunHost";
    const publishDir = path.join(PACKAGE_ROOT, "obj", "publish", "csharp-net48");
    const payloadDir = path.join(STAGE_RESOURCES, NET48_PAYLOAD);
    console.log(`==> Publishing ${assembly} (net48) for the .NET Framework host`);

    run("dotnet", [
        "publish", CSHARP_RUNHOST_CSPROJ,
        "-c", configuration,
        "-f", "net48",
        "-o", publishDir,
        "--nologo"
    ]);

    const exePath = path.join(publishDir, `${assembly}.exe`);
    if (!fs.existsSync(exePath)) {
        throw new Error(`The .NET Framework 4.8 host was not produced: ${exePath}`);
    }

    // The whole publish output is the payload (assemblies, app.config); only the
    // symbols are dropped.
    fs.rmSync(payloadDir, { recursive: true, force: true });
    fs.mkdirSync(payloadDir, { recursive: true });
    for (const entry of fs.readdirSync(publishDir, { withFileTypes: true })) {
        if (entry.name.endsWith(".pdb")) {
            continue;
        }

        fs.cpSync(path.join(publishDir, entry.name), path.join(payloadDir, entry.name), { recursive: true });
    }
}

function writeManifest(targetTriple) {
    const files = [];
    for (const section of ["app", "resources", "bin"]) {
        const root = path.join(STAGE_ROOT, section);
        if (!fs.existsSync(root)) {
            continue;
        }

        for (const file of listFiles(root)) {
            const content = fs.readFileSync(file);
            files.push({
                path: `${section}/${path.relative(root, file).split(path.sep).join("/")}`,
                bytes: content.length,
                sha256: crypto.createHash("sha256").update(content).digest("hex")
            });
        }
    }

    const manifest = {
        targetTriple,
        generatedAt: new Date().toISOString(),
        files
    };
    fs.writeFileSync(path.join(STAGE_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`==> manifest.json written (${files.length} files)`);
}

function listFiles(root) {
    const found = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(full);
            } else if (entry.isFile()) {
                found.push(full);
            }
        }
    };

    visit(root);
    return found;
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        stdio: ["ignore", "pipe", "inherit"],
        encoding: "utf8",
        ...options
    });
    if (result.error) {
        throw new Error(`${command} failed to start: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
    }
}
