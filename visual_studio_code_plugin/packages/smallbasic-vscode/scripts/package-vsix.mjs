// Packages the VS Code extension into build/SmallBasic.VSCode-<version>.vsix.
//
// The output name is derived from the shared version.json so the VS and VS Code
// artifacts always report the same version.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readRepositoryVersion,
  repositoryRoot,
  syncRepositoryVersion
} from "../../../../tools/version.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDirectory = path.resolve(scriptDirectory, "..");

// Build configuration for the staged RunHost payload. build/Package-Vsix.ps1
// forwards it via SMALLBASIC_CONFIGURATION (and it can be passed explicitly with
// --configuration/-c); Release keeps the historical behaviour for direct runs.
function readConfiguration() {
  const flagIndex = process.argv.findIndex(
    (argument) => argument === "--configuration" || argument === "-c"
  );
  const raw = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.SMALLBASIC_CONFIGURATION;
  const value = (raw ?? "Release").trim();
  const normalized = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

  if (normalized !== "Debug" && normalized !== "Release") {
    throw new Error(`Unsupported build configuration: "${value}". Expected Debug or Release.`);
  }

  return normalized;
}

const configuration = readConfiguration();

function runNode(scriptPath, scriptArguments = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArguments], {
    stdio: "inherit",
    cwd: extensionDirectory
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runShell(command) {
  const result = spawnSync(command, {
    stdio: "inherit",
    cwd: extensionDirectory,
    shell: true
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Keep package.json (and the VS manifest, README, ...) aligned with version.json
// before vsce snapshots the manifest.
syncRepositoryVersion();

// Bundle the extension (dist/extension.js, dist/debug/adapter.js, dist/runhost.js).
// The Visual Studio VSIX packaging consumes the same adapter/runhost bundles.
runShell("npm run build");

console.log(`Staging RunHost payload from the ${configuration} build.`);
runNode(path.join(scriptDirectory, "stage-runhost.mjs"), [configuration]);

const outputPath = path.join(
  repositoryRoot,
  "visual_studio_code_plugin",
  "build",
  `SmallBasic.VSCode-${readRepositoryVersion()}.vsix`
);
const outputDirectory = path.dirname(outputPath);
const normalizedOutputPath = path.resolve(outputPath).toLowerCase();

// Snapshot the packages that already exist so the artifact produced by this run
// can never be selected for removal.
const stalePackages = fs.existsSync(outputDirectory)
  ? fs
      .readdirSync(outputDirectory)
      .filter(
        (entry) =>
          /^SmallBasic\.VSCode-.*\.vsix$/.test(entry) &&
          path.resolve(outputDirectory, entry).toLowerCase() !== normalizedOutputPath
      )
  : [];

runShell(`vsce package --no-dependencies --allow-missing-repository -o "${outputPath}"`);

if (!fs.existsSync(outputPath)) {
  throw new Error(`vsce did not produce the expected package: ${outputPath}`);
}

// Drop the superseded packages now that the fresh one is safely on disk.
for (const entry of stalePackages) {
  fs.rmSync(path.join(outputDirectory, entry), { force: true });
  console.log(`Removed stale package: ${entry}`);
}

