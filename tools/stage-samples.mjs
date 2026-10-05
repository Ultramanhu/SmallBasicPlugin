#!/usr/bin/env node
/**
 * Stages the repository samples (every .sb file under sample/) into a site's
 * samples/ folder and writes samples/index.json - the single implementation
 * behind the runhost/web static site (runhost/Build-RunHost.ps1) and the
 * staged desktop playground app
 * (packages/smallbasic-playground-desktop/scripts/stage-playground.mjs).
 *
 * Programs that draw are flagged (`graphics`) so the shell can preselect the
 * Blazor backend for them. Paths inside dot-prefixed folders (and dot files)
 * are skipped: they are tooling/worktree artifacts, not samples.
 *
 * Usage: node tools/stage-samples.mjs <site-root> [--sample-root <directory>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const siteRoot = args[0];
const sampleRootIndex = args.indexOf("--sample-root");
const sampleRoot = sampleRootIndex !== -1 && args[sampleRootIndex + 1]
    ? path.resolve(args[sampleRootIndex + 1])
    : path.join(REPO_ROOT, "sample");

main();

function main() {
    if (!siteRoot) {
        console.error("Usage: node tools/stage-samples.mjs <site-root> [--sample-root <directory>]");
        process.exit(1);
    }

    const samplesRoot = path.join(siteRoot, "samples");
    fs.rmSync(samplesRoot, { recursive: true, force: true });
    fs.mkdirSync(samplesRoot, { recursive: true });

    const entries = [];
    if (fs.existsSync(sampleRoot)) {
        for (const file of listSampleFiles(sampleRoot)) {
            const relative = path.relative(sampleRoot, file).split(path.sep).join("/");
            const target = path.join(samplesRoot, relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(file, target);

            const source = fs.readFileSync(file, "utf8");
            entries.push({
                name: `sample/${relative}`,
                path: `samples/${relative}`,
                graphics: /\b(GraphicsWindow|Shapes|Turtle)\s*[\.\(]/i.test(source)
            });
        }
    }

    if (entries.length === 0) {
        console.warn(`No .sb samples were found under ${sampleRoot}; the site falls back to its built-in program.`);
    }

    // The shell resolves `default` against each item's `path` (shell-core.js
    // `loadProgramManifest()`), not `name`; writing a name here silently falls
    // back to the first sample, so the pre-selected sample must be a path.
    const preferredDefaultName = "sample/hello/hello.sb";
    const defaultEntry = entries.find((entry) => entry.name === preferredDefaultName) ?? entries[0];
    const defaultPath = defaultEntry ? defaultEntry.path : "";

    fs.writeFileSync(
        path.join(samplesRoot, "index.json"),
        JSON.stringify({ default: defaultPath, items: entries }, null, 2));
    console.log(`==> ${entries.length} sample(s) staged into ${samplesRoot}`);
}

function listSampleFiles(root) {
    const found = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name.startsWith(".")) {
                continue;
            }

            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(full);
            } else if (entry.isFile() && entry.name.endsWith(".sb")) {
                found.push(full);
            }
        }
    };

    visit(root);
    return found.sort();
}
