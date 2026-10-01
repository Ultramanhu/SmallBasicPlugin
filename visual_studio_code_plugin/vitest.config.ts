import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      jasmine: path.resolve(__dirname, "packages/smallbasic-lang-core/tests/jasmine-shim.ts"),
      "smallbasic-lang-core": path.resolve(__dirname, "packages/smallbasic-lang-core/src/index.ts"),
      "smallbasic-language-services": path.resolve(__dirname, "packages/smallbasic-language-services/src/index.ts")
    }
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.spec.ts"],
    setupFiles: ["./vitest.setup.ts"]
  }
});

