import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageRoot = path.resolve(scriptDirectory, "..");
const outputRoot = path.join(packageRoot, "playground-dist");
const sourceRoot = path.join(packageRoot, "src", "playground");
const repositoryRoot = path.resolve(packageRoot, "..", "..");

const monacoPackageRoot = path.dirname(require.resolve("monaco-editor/package.json"));
const onigurumaPackageRoot = path.dirname(require.resolve("vscode-oniguruma/package.json"));
const monacoWorkerEntry = path.join(monacoPackageRoot, "esm", "vs", "editor", "editor.worker.js");
const onigurumaWasm = path.join(onigurumaPackageRoot, "release", "onig.wasm");
const languageConfiguration = path.join(packageRoot, "language-configuration.json");
const snippets = path.join(packageRoot, "snippets", "smallbasic.json");
const grammar = path.join(packageRoot, "syntaxes", "smallbasic.tmLanguage.json");

for (const required of [
  monacoWorkerEntry,
  onigurumaWasm,
  languageConfiguration,
  snippets,
  grammar,
  path.join(sourceRoot, "entry.ts"),
  path.join(sourceRoot, "language.worker.ts"),
  path.join(sourceRoot, "playground.html"),
  path.join(sourceRoot, "index.html")
]) {
  if (!fs.existsSync(required)) {
    throw new Error(`Playground build input not found: ${required}`);
  }
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(outputRoot, "editor", "grammar"), { recursive: true });
fs.mkdirSync(path.join(outputRoot, "editor", "snippets"), { recursive: true });

await build({
  absWorkingDir: packageRoot,
  bundle: true,
  entryPoints: {
    playground: path.join(sourceRoot, "entry.ts")
  },
  outdir: outputRoot,
  format: "esm",
  platform: "browser",
  target: "es2022",
  splitting: false,
  sourcemap: process.env.SMALLBASIC_NO_SOURCEMAPS !== "1",
  logLevel: "info",
  entryNames: "[name]",
  assetNames: "editor/assets/[name]-[hash]",
  loader: {
    ".ttf": "file",
    ".woff": "file",
    ".woff2": "file",
    ".svg": "file"
  }
});

await build({
  absWorkingDir: packageRoot,
  bundle: true,
  entryPoints: [monacoWorkerEntry],
  outfile: path.join(outputRoot, "editor", "editor.worker.js"),
  format: "esm",
  platform: "browser",
  target: "es2022",
  splitting: false,
  sourcemap: process.env.SMALLBASIC_NO_SOURCEMAPS !== "1",
  logLevel: "info"
});

await build({
  absWorkingDir: packageRoot,
  bundle: true,
  entryPoints: [path.join(sourceRoot, "language.worker.ts")],
  outfile: path.join(outputRoot, "editor", "language.worker.js"),
  format: "esm",
  platform: "browser",
  target: "es2022",
  splitting: false,
  sourcemap: process.env.SMALLBASIC_NO_SOURCEMAPS !== "1",
  logLevel: "info"
});

copy(path.join(sourceRoot, "playground.html"), path.join(outputRoot, "playground.html"));
copy(path.join(sourceRoot, "index.html"), path.join(outputRoot, "index.html"));
copy(onigurumaWasm, path.join(outputRoot, "editor", "onig.wasm"));
copy(languageConfiguration, path.join(outputRoot, "editor", "language-configuration.json"));
copy(snippets, path.join(outputRoot, "editor", "snippets", "smallbasic.json"));
copy(grammar, path.join(outputRoot, "editor", "grammar", "smallbasic.tmLanguage.json"));

const notices = [
  packageNotice(packageRoot, "monaco-editor"),
  packageNotice(packageRoot, "vscode-textmate"),
  packageNotice(packageRoot, "vscode-oniguruma")
].join("\n\n");
fs.writeFileSync(path.join(outputRoot, "third-party-notices.txt"), notices, "utf8");

for (const required of [
  path.join(outputRoot, "index.html"),
  path.join(outputRoot, "playground.html"),
  path.join(outputRoot, "playground.js"),
  path.join(outputRoot, "playground.css"),
  path.join(outputRoot, "editor", "editor.worker.js"),
  path.join(outputRoot, "editor", "language.worker.js"),
  path.join(outputRoot, "editor", "onig.wasm")
]) {
  if (!fs.existsSync(required)) {
    throw new Error(`Playground build output missing: ${required}`);
  }
}

console.log(`Playground build ready: ${path.relative(repositoryRoot, outputRoot)}`);
logBundleSizes();

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

// Raw and Brotli sizes for the payloads the browser actually downloads, so
// review can catch unexpected growth before it ships (design doc 12, §12.2).
function logBundleSizes() {
  const payloads = [
    "playground.js",
    "playground.css",
    path.join("editor", "editor.worker.js"),
    path.join("editor", "language.worker.js"),
    path.join("editor", "onig.wasm")
  ];

  for (const relative of payloads) {
    const bytes = fs.readFileSync(path.join(outputRoot, relative));
    const brotli = zlib.brotliCompressSync(bytes);
    const kb = (value) => `${(value.length / 1024).toFixed(1)} KB`;
    console.log(`  ${relative}: ${kb(bytes)} raw, ${kb(brotli)} brotli`);
  }
}

function packageNotice(root, packageName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`, { paths: [root] });
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return [
    `${packageJson.name} ${packageJson.version}`,
    `License: ${packageJson.license ?? "Unknown"}`,
    `Homepage: ${packageJson.homepage ?? packageJson.repository?.url ?? "n/a"}`
  ].join("\n");
}
