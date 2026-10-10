import { defineConfig } from "vitest/config";

/**
 * Specs of the Tauri shell package. It lives at the repository root as a
 * standalone npm project (it is no longer a workspace member of
 * visual_studio_code_plugin), so it runs its own vitest:
 *
 *   npm test            # in this folder
 *
 * Build-Plugin.ps1 runs it together with the VS Code workspace suite. The specs
 * cover the Tauri bridge surface, the local CLI debug transport and the staged
 * payload boundary (the latter two skip themselves when runhost/playground was
 * never staged).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"]
  }
});
