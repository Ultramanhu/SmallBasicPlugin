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
  runtimeError?: { code: number; message: string };
}

// The corpus lives next to the C# runner; this shared file is the single source
// of truth consumed by both implementations.
const casesPath = fileURLToPath(
  new URL(
    "../../../../visual_studio_plugin/tests/SmallBasic.Compiler.Tests/Conformance/cases.json",
    import.meta.url
  )
);
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as ConformanceCase[];

// Covers the Language Extension v1 contract as well as the unified core runtime
// semantics that both implementations share.
describe("Shared conformance corpus", () => {
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

      if (testCase.runtimeError) {
        // An unhandled runtime error terminates the program; nothing else is
        // printed (the host mirrors `lastRuntimeError` to stderr). The failing
        // statement may leave partial values on the evaluation stack, so the
        // balanced-stack assertion only applies to successful runs.
        expect(engine.state, testCase.name).toBe(ExecutionState.Terminated);
        expect(engine.lastRuntimeError, testCase.name).toEqual(testCase.runtimeError);
        buffer.assertBufferIsEmpty();
        return;
      }

      expect(engine.exception).toBeUndefined();
      expect(engine.lastRuntimeError, testCase.name).toBeUndefined();

      expect(engine.evaluationStack).toHaveLength(0);
      buffer.assertBufferIsEmpty();
      for (const [name, expected] of Object.entries(testCase.globals ?? {})) {
        expect(engine.memory.getValue(name)?.toValueString(), `${testCase.name}: global ${name}`).toBe(expected);
      }
    });
  }
});
