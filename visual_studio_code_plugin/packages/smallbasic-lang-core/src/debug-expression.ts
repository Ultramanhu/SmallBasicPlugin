import { Compilation } from "../../../vendor/SmallBasicOnline/src/compiler/compilation";
import { ExecutionEngine, ExecutionMode, StackFrame } from "../../../vendor/SmallBasicOnline/src/compiler/execution-engine";
import { BaseInstruction, InstructionKind } from "../../../vendor/SmallBasicOnline/src/compiler/emitting/instructions";
import { ModulesBinder } from "../../../vendor/SmallBasicOnline/src/compiler/binding/modules-binder";
import { BaseValue } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/values/base-value";
import { ArrayValue } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/values/array-value";

// Synthetic variable used to capture the expression result. It is restored
// (or removed) after every evaluation, so it never leaks into program memory.
const RESULT_VARIABLE = "__SmallBasicDebugExpression";

// Upper bound on the number of instructions executed per evaluation. Guards
// against library methods that block on input without advancing the frame.
const MAX_EVALUATION_STEPS = 100000;

export interface CompiledDebugExpression {
  readonly instructions: ReadonlyArray<BaseInstruction>;
  readonly resultVariable: string;
}

/**
 * Compiles a single Small Basic expression (for example a conditional breakpoint
 * condition) so it can be evaluated against a paused engine using the real
 * interpreter semantics. Returns undefined when the text does not compile.
 */
export function compileDebugExpression(text: string): CompiledDebugExpression | undefined {
  const normalized = text.replace(/\r?\n/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  // The parser only understands whole statements, so wrap the expression in an
  // assignment; the temporary variable is cleaned up during evaluation.
  const compilation = new Compilation(`${RESULT_VARIABLE} = (${normalized})`);
  if (!compilation.isReadyToRun) {
    return undefined;
  }

  const instructions = compilation.emit()[ModulesBinder.MainModuleName];
  if (!instructions || instructions.length === 0) {
    return undefined;
  }

  // Sub module invocations push frames that this evaluator cannot unwind.
  if (instructions.some((instruction) => instruction.kind === InstructionKind.InvokeSubModule)) {
    return undefined;
  }

  return { instructions, resultVariable: RESULT_VARIABLE };
}

/**
 * Evaluates a compiled expression against the engine's current memory without
 * disturbing the paused program. The evaluation stack and engine state are
 * restored afterwards. Returns undefined when evaluation fails.
 */
export function evaluateDebugExpression(
  engine: ExecutionEngine,
  expression: CompiledDebugExpression,
  selectedFrame?: StackFrame
): BaseValue | undefined {
  const savedState = engine.state;
  selectedFrame ??= engine.executionStack.length
    ? engine.executionStack[engine.executionStack.length - 1]
    : undefined;
  const localMemory = selectedFrame?.localMemory ?? new ArrayValue();
  const resultMemory = localMemory.getValue(expression.resultVariable) !== undefined
    ? localMemory
    : engine.memory;
  const previous = resultMemory.getValue(expression.resultVariable);
  const hadPrevious = previous !== undefined;
  const evaluationStackBase = engine.evaluationStack.length;
  const frame: StackFrame = {
    moduleName: "<debug-expression>",
    instructionIndex: 0,
    localMemory,
    evaluationStackBase,
    returnsValue: false
  };

  try {
    let steps = 0;
    while (frame.instructionIndex < expression.instructions.length) {
      if (steps >= MAX_EVALUATION_STEPS) {
        return undefined;
      }

      steps += 1;
      expression.instructions[frame.instructionIndex].execute(engine, ExecutionMode.Debug, frame);
    }

    return resultMemory.getValue(expression.resultVariable);
  } finally {
    while (engine.evaluationStack.length > evaluationStackBase) {
      engine.popEvaluationStack();
    }

    if (hadPrevious && previous) {
      resultMemory.setIndex(expression.resultVariable, previous);
    } else {
      resultMemory.deleteIndex(expression.resultVariable);
    }

    engine.state = savedState;
  }
}

/**
 * Evaluates a compiled expression as a boolean condition, matching how the
 * interpreter treats `If`/`While` conditions. Returns undefined on failure.
 */
export function evaluateDebugCondition(
  engine: ExecutionEngine,
  expression: CompiledDebugExpression
): boolean | undefined {
  return evaluateDebugExpression(engine, expression)?.toBoolean();
}
