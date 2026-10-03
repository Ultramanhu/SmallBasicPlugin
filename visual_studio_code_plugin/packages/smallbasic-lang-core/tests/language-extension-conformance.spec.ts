import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Compilation, ErrorCode, ExecutionEngine, ExecutionMode, ExecutionState } from "../src/index";
import { TextWindowTestBuffer } from "../../../vendor/SmallBasicOnline/tests/compiler/helpers";

interface ConformanceCase {
  name: string;
  source: string[];
  stdout?: string[];
  globals?: Record<string, string>;
  diagnostics?: string[];
}

const casesPath = fileURLToPath(
  new URL("../../../../tests/conformance/language-extension/cases.json", import.meta.url)
);
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as ConformanceCase[];

describe("Language Extension v1 shared conformance", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const source = testCase.source.join("\n");
      const compilation = new Compilation(source);
      const diagnosticNames = compilation.diagnostics.map(diagnostic => ErrorCode[diagnostic.code]);

      if (testCase.diagnostics) {
        expect(diagnosticNames).toEqual(expect.arrayContaining(testCase.diagnostics));
        return;
      }

      expect(diagnosticNames).toEqual([]);
      const output = testCase.stdout ?? [];
      const buffer = new TextWindowTestBuffer([], output);
      const engine = new ExecutionEngine(compilation);
      engine.libraries.TextWindow.plugin = buffer;
      while (engine.state !== ExecutionState.Terminated) {
        engine.execute(ExecutionMode.RunToEnd);
      }

      expect(engine.exception).toBeUndefined();
      expect(engine.evaluationStack).toHaveLength(0);
      buffer.assertBufferIsEmpty();
      for (const [name, expected] of Object.entries(testCase.globals ?? {})) {
        expect(engine.memory.getValue(name)?.toValueString(), `${testCase.name}: global ${name}`).toBe(expected);
      }
    });
  }
});
