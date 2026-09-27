import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type ExtensionManifest = {
  main?: string;
  browser?: string;
  capabilities?: {
    virtualWorkspaces?: boolean;
  };
  contributes?: {
    breakpoints?: Array<{ language?: string }>;
    debuggers?: Array<{
      configurationAttributes?: {
        launch?: {
          properties?: {
            backend?: { default?: string };
            stopOnEntry?: { default?: boolean };
          };
        };
      };
      configurationSnippets?: Array<{ body?: { stopOnEntry?: boolean } }>;
    }>;
    menus?: {
      "editor/title/run"?: Array<{ command?: string; when?: string }>;
    };
  };
};

describe("VS Code extension manifest", () => {
  const manifestPath = path.resolve(__dirname, "..", "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ExtensionManifest;

  it("enables editor gutter breakpoints for SmallBasic documents", () => {
    expect(manifest.contributes?.breakpoints).toContainEqual({ language: "smallbasic" });
  });

  it("pauses default debug launches so step controls become available", () => {
    const debuggerContribution = manifest.contributes?.debuggers?.[0];
    expect(
      debuggerContribution?.configurationAttributes?.launch?.properties?.stopOnEntry?.default
    ).toBe(true);
    expect(debuggerContribution?.configurationSnippets).toSatisfy(
      (snippets: Array<{ body?: { stopOnEntry?: boolean } }> | undefined) =>
        !!snippets?.length && snippets.every((snippet) => snippet.body?.stopOnEntry === true)
    );
  });

  it("leaves backend selection to the platform-aware desktop provider", () => {
    const debuggerContribution = manifest.contributes?.debuggers?.[0];
    expect(
      debuggerContribution?.configurationAttributes?.launch?.properties?.backend?.default
    ).toBeUndefined();
  });

  it("publishes a browser entry point for VS Code for the Web", () => {
    expect(manifest.main).toBe("./dist/extension.js");
    expect(manifest.browser).toBe("./dist/web/extension.js");
    expect(manifest.capabilities?.virtualWorkspaces).toBe(true);
  });

  it("hides the native C# run command in web workspaces", () => {
    const runMenu = manifest.contributes?.menus?.["editor/title/run"];
    expect(runMenu?.find((item) => item.command === "smallbasic.runCSharp")?.when).toContain("!isWeb");
  });
});
