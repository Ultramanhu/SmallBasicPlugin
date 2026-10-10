/*
 * Builds the desktop bridge bundle (`desktop.js`) that stage-playground.mjs
 * copies into `runhost/playground/app/`. This bundle is the only artifact of
 * the Tauri bridge on the frontend side; the plain web build of
 * `build:playground` never contains it (doc 10, §19.4).
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(packageRoot, "dist", "desktop.js");

fs.mkdirSync(path.dirname(outFile), { recursive: true });

await build({
    entryPoints: [path.join(packageRoot, "src", "desktop-entry.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile: outFile,
    sourcemap: process.env.SMALLBASIC_NO_SOURCEMAPS !== "1",
    legalComments: "none",
    logLevel: "info"
});
