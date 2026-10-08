import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stages the RunHost payload the extension ships into
 * `packages/smallbasic-vscode/runhost/`: the two framework-dependent C# hosts
 * (`windows/`, `portable/`) and the Blazor WASM payload (`blazor/`, plus the
 * CDN-safe ICU aliases under `wwwroot/_framework-webview/`).
 *
 * Only the files the extension actually launches or serves are copied - see the
 * payload boundary below - because everything staged here ends up in the VSIX.
 */
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(extensionDirectory, "..", "..", "..");
const hostRoot = path.join(repositoryRoot, "visual_studio_plugin", "src", "SmallBasic.RunHost", "bin");

// The requested configuration is forwarded by package-vsix.mjs so the staged
// binaries match the rest of the build. Without it any existing build is
// accepted, preferring Release.
//
// --blazor-only stages just runhost/blazor (plus its wwwroot), which is all the
// web extension needs: the Blazor WebAssembly backend runs inside a webview, so
// the desktop hosts are not required. Used by "npm run stage:blazor".
const arguments_ = process.argv.slice(2);
const blazorOnly = arguments_.includes("--blazor-only");
const requestedConfiguration = arguments_.find((argument) => !argument.startsWith("--"))?.trim() || undefined;
const configurations = requestedConfiguration ? [requestedConfiguration] : ["Release", "Debug"];

// Managed debug symbols are only staged for an explicit Debug request. Every
// other case (including a direct run that prefers the Release build) produces
// the Release payload, where the PDBs would roughly double the staged RunHost
// size without being usable from an installed extension.
const keepDebugSymbols = (requestedConfiguration ?? "").toLowerCase() === "debug";

function findHost(targetFramework, fileName) {
  for (const configuration of configurations) {
    const candidate = path.join(hostRoot, configuration, targetFramework);
    if (fs.existsSync(path.join(candidate, fileName))) {
      return candidate;
    }
  }

  const searched = configurations
    .map((configuration) => path.join(hostRoot, configuration, targetFramework))
    .join(", ");
  throw new Error(
    `${targetFramework}/${fileName} was not found under: ${searched}. ` +
      `Build visual_studio_plugin/src/SmallBasic.RunHost for the requested configuration first.`
  );
}

const blazorSource = path.join(repositoryRoot, "runhost", "blazor");
if (!fs.existsSync(path.join(blazorSource, "SmallBasic.Blazor.RunHost.dll"))) {
  throw new Error("runhost/blazor/SmallBasic.Blazor.RunHost.dll was not found. Run runhost/Build-RunHost.ps1 first.");
}

const destinationDirectory = path.join(extensionDirectory, "runhost");
const blazorDestination = path.join(destinationDirectory, "blazor");

// ---------------------------------------------------------------------------
// Payload boundary: stage only what the extension itself consumes.
// ---------------------------------------------------------------------------

/**
 * RID folders (`win-x64`, `linux-arm64`, ...) that a self-contained
 * `dotnet publish -r <rid>` leaves in
 * `visual_studio_plugin\src\SmallBasic.RunHost\bin\<Configuration>\<tfm>`.
 *
 * That folder is shared with packages/smallbasic-playground-desktop, which
 * publishes the desktop sidecars (self-contained, single file) from the same
 * project. `-o <dir>` only moves the *publish* output, so every RID publish
 * additionally drops a complete self-contained runtime next to the
 * framework-dependent files staged here - up to ~300 MB per architecture. The
 * extension launches the framework-dependent hosts (`SmallBasic.RunHost.exe` /
 * `SmallBasic.RunHost.dll`), so nothing inside those folders is ever used.
 */
const RUNTIME_IDENTIFIER_DIRECTORY =
  /^(?:win|linux|osx|freebsd|illumos|browser|android|ios|maccatalyst)[-_](?:musl[-_])?(?:x64|x86|arm|arm64|loongarch64|ppc64le|s390x|wasm)$/i;

/**
 * Blazor's browser debug proxy (Roslyn plus `BrowserDebugProxy.dll` and
 * `BrowserDebugHost.dll`, ~11 MB), emitted by the WebAssembly.Server package for
 * the Visual Studio / browser-launch debugging tooling. The extension never
 * launches it: the Blazor WASM debug flow runs over its own webview channel
 * (src/web/debug-broker.ts and src/web/webview-debug-adapter.ts).
 */
const UNUSED_PUBLISH_DIRECTORIES = new Set(["BlazorDebugProxy"]);

/** Totals of everything the filter below kept out, keyed by reason. */
const skipped = new Map();

function measure(target) {
  const stats = fs.statSync(target);
  if (!stats.isDirectory()) {
    return { files: 1, bytes: stats.size };
  }

  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const measured = measure(path.join(target, entry.name));
    files += measured.files;
    bytes += measured.bytes;
  }

  return { files, bytes };
}

function exclude(reason, sourcePath) {
  const measured = measure(sourcePath);
  const total = skipped.get(reason) ?? { files: 0, bytes: 0 };
  total.files += measured.files;
  total.bytes += measured.bytes;
  skipped.set(reason, total);
  return false;
}

/** `fs.cpSync` filter: keeps the payload to the framework-dependent host files. */
function shouldStage(sourcePath) {
  const name = path.basename(sourcePath);

  if (RUNTIME_IDENTIFIER_DIRECTORY.test(name)) {
    return exclude("self-contained RID runtime folders", sourcePath);
  }

  if (UNUSED_PUBLISH_DIRECTORIES.has(name)) {
    return exclude("Visual Studio / browser debugging output", sourcePath);
  }

  if (!keepDebugSymbols && path.extname(name).toLowerCase() === ".pdb") {
    return exclude("managed debug symbols", sourcePath);
  }

  return true;
}

const copyOptions = {
  recursive: true,
  force: true,
  filter: shouldStage
};

/**
 * vscode-unpkg rejects raw `.dat` URLs, while serving `.br` files normally.
 * Keep Blazor's real pre-compressed files untouched and add extension-private
 * aliases whose names are CDN-safe but whose contents are the original ICU
 * bytes. The extension host maps runtime `.dat` requests to these aliases.
 */
function stageWebviewResourceAliases() {
  const frameworkDirectory = path.join(blazorDestination, "wwwroot", "_framework");
  const aliasDirectory = path.join(blazorDestination, "wwwroot", "_framework-webview");
  fs.rmSync(aliasDirectory, { recursive: true, force: true });
  fs.mkdirSync(aliasDirectory, { recursive: true });

  const dataFiles = fs.readdirSync(frameworkDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dat"));

  if (dataFiles.length === 0) {
    throw new Error(`No Blazor ICU .dat resources were found under ${frameworkDirectory}.`);
  }

  for (const entry of dataFiles) {
    fs.copyFileSync(
      path.join(frameworkDirectory, entry.name),
      path.join(aliasDirectory, `${entry.name}.br`)
    );
  }

  console.log(`Staged ${dataFiles.length} CDN-safe Blazor ICU resource alias(es).`);
}

if (blazorOnly) {
  fs.rmSync(blazorDestination, { recursive: true, force: true });
  fs.mkdirSync(blazorDestination, { recursive: true });
  fs.cpSync(blazorSource, blazorDestination, copyOptions);
  console.log(`Staged Blazor run host from ${blazorSource}`);
  console.log("Staged the Blazor payload only (--blazor-only): the web extension runs it inside a webview.");
} else {
  const windowsSource = findHost("net8.0-windows", "SmallBasic.RunHost.exe");
  const portableSource = findHost("net8.0", "SmallBasic.RunHost.dll");
  fs.rmSync(destinationDirectory, { recursive: true, force: true });
  const windowsDestination = path.join(destinationDirectory, "windows");
  const portableDestination = path.join(destinationDirectory, "portable");
  fs.mkdirSync(windowsDestination, { recursive: true });
  fs.mkdirSync(portableDestination, { recursive: true });
  fs.mkdirSync(blazorDestination, { recursive: true });

  fs.cpSync(windowsSource, windowsDestination, copyOptions);
  fs.cpSync(portableSource, portableDestination, copyOptions);
  fs.cpSync(blazorSource, blazorDestination, copyOptions);
  console.log(`Staged Windows C# run host from ${windowsSource}`);
  console.log(`Staged portable C# run host from ${portableSource}`);
  console.log(`Staged Blazor run host from ${blazorSource}`);
}

stageWebviewResourceAliases();

const staged = measure(destinationDirectory);
console.log(`Staged RunHost payload: ${staged.files} file(s), ${formatBytes(staged.bytes)}.`);
for (const [reason, total] of skipped) {
  console.log(`  Skipped ${reason}: ${total.files} file(s), ${formatBytes(total.bytes)}.`);
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
