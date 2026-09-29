import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const copyOptions = {
  recursive: true,
  force: true,
  filter: (source) => keepDebugSymbols || path.extname(source).toLowerCase() !== ".pdb"
};

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

if (!keepDebugSymbols) {
  console.log("Skipped PDB files (release packaging).");
}
