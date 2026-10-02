import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Load-bearing boundary of the desktop variant (design doc 10, §9 / §19.4):
 *
 * - the browser static site (`runhost/web`, `playground-dist`) must never
 *   contain the Tauri bridge or any sidecar;
 * - the staged desktop app (`runhost/playground/app`) must contain exactly one
 *   `desktop.js` plus the script tag `stage-playground.mjs` injects;
 * - the staging manifest must keep one platform-independent copy of the shared
 *   resources and one target-specific sidecar set.
 *
 * The staging / build outputs are generated, so those assertions are skipped
 * with a clear message when the artifacts are absent (a plain `npm test` on a
 * clean checkout still runs the source-level contracts).
 */
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(testDirectory);
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const repositoryRoot = path.resolve(workspaceRoot, "..");

const playgroundSourceHtml = path.join(
  workspaceRoot, "packages", "smallbasic-vscode", "src", "playground", "playground.html");
const playgroundDist = path.join(workspaceRoot, "packages", "smallbasic-vscode", "playground-dist");
const webRoot = path.join(repositoryRoot, "runhost", "web");
const stageRoot = path.join(repositoryRoot, "runhost", "playground");
const stageApp = path.join(stageRoot, "app");
const desktopBundle = path.join(packageRoot, "dist", "desktop.js");

const desktopScriptMarker = '<script type="module" src="playground.js"></script>';
const targetTriplePattern = /(x86_64|aarch64)-(pc-windows|apple-darwin|unknown-linux)/;

function readText(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function walkFiles(root: string, filter: (file: string) => boolean): string[] {
  const found: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && filter(full)) {
        found.push(full);
      }
    }
  };

  visit(root);
  return found;
}

describe("desktop staging boundary", () => {
  it("keeps the script marker stage-playground.mjs rewrites", () => {
    expect(readText(playgroundSourceHtml)).toContain(desktopScriptMarker);
  });

  describe.skipIf(!fs.existsSync(path.join(playgroundDist, "playground.js")))("built browser playground", () => {
    it("never ships the desktop bridge", () => {
      expect(fs.existsSync(path.join(playgroundDist, "desktop.js"))).toBe(false);
      expect(readText(path.join(playgroundDist, "playground.js"))).not.toContain("__TAURI_INTERNALS__");
    });
  });

  describe.skipIf(!fs.existsSync(path.join(webRoot, "playground.html")))("runhost/web distribution", () => {
    it("stays a pure browser site without the Tauri bridge", () => {
      expect(fs.existsSync(path.join(webRoot, "desktop.js"))).toBe(false);
      for (const file of walkFiles(webRoot, (candidate) => candidate.endsWith(".js"))) {
        const text = readText(file);
        expect(text, `${path.relative(repositoryRoot, file)} must not contain the Tauri bridge`).not.toContain("__TAURI_INTERNALS__");
        expect(text, `${path.relative(repositoryRoot, file)} must not know the desktop commands`).not.toContain("desktop_capabilities");
      }
    });
  });

  describe("desktop bridge bundle", () => {
    it.skipIf(!fs.existsSync(desktopBundle))("is a real Tauri client bundle", () => {
      const text = readText(desktopBundle);
      expect(text).toContain("__TAURI_INTERNALS__");
      expect(text).toContain("desktop_capabilities");
    });
  });

  describe.skipIf(!fs.existsSync(path.join(stageApp, "desktop.js")))("staged desktop app", () => {
    it("loads the desktop bridge through one script tag", () => {
      const html = readText(path.join(stageApp, "playground.html"));
      expect(html).toContain('<script type="module" src="desktop.js"></script>');
      expect(html.split('src="desktop.js"').length - 1).toBe(1);
    });

    it("keeps one platform-independent copy and no per-target mirror folders", () => {
      const manifestPath = path.join(stageRoot, "manifest.json");
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readText(manifestPath)) as {
        targetTriple: string;
        files: Array<{ path: string; sha256: string }>;
      };

      const paths = manifest.files.map((file) => file.path);
      expect(new Set(paths).size).toBe(paths.length);

      for (const relative of paths) {
        // The shared app/ tree and the resources/ payload carry no target triple
        // in the path; only bin/ holds the target-specific sidecar.
        if (relative.startsWith("app/") || relative.startsWith("resources/")) {
          expect(targetTriplePattern.test(relative), `${relative} must not be target-specific`).toBe(false);
        }

        // resources/ holds exactly the .NET Framework 4.8 folder payload; the
        // removed Node/Blazor payloads must not come back.
        if (relative.startsWith("resources/")) {
          expect(
            relative.startsWith("resources/dotnet/csharp-net48/"),
            `unexpected resource payload: ${relative}`
          ).toBe(true);
        }
      }

      // Exactly one bin sidecar remains: the self-contained .NET 8 host
      // (doc 10, §17.2). The .NET Framework host is a resources/ folder.
      const sidecars = paths.filter((relative) => relative.startsWith("bin/"));
      expect(sidecars).toHaveLength(1);
      expect(sidecars[0]).toContain("smallbasic-csharp-net8");
      expect(sidecars[0]).toContain(manifest.targetTriple);
    });
  });
});
