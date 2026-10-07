import { ExecutionEngine, ExecutionMode, StackFrame, ExecutionState } from "../execution-engine";
import { StringValue } from "../runtime/values/string-value";
import { ValueKind, BaseValue, Constants } from "../runtime/values/base-value";
import { NumberValue } from "../runtime/values/number-value";
import { ArrayValue } from "../runtime/values/array-value";
import { CompilerRange } from "../syntax/ranges";
import { OnErrorAction } from "../syntax/syntax-nodes";
import { RuntimeErrorCode } from "../runtime/runtime-error";

export enum InstructionKind {
    TempLabel,
    TempJump,
    TempConditionalJump,
    Jump,
    ConditionalJump,
    InvokeSubModule,
    OnError,
    ReturnValue,
    SetEventHandler,
    StoreVariable,
    StoreArrayElement,
    StoreProperty,
    LoadVariable,
    LoadArrayElement,
    LoadProperty,
    MethodInvocation,
    Negate,
    Equal,
    LessThan,
    GreaterThan,
    LessThanOrEqual,
    GreaterThanOrEqual,
    Add,
    Subtract,
    Multiply,
    Divide,
    IntegerDivide,
    Modulo,
    PushNumber,
    PushString,
    Duplicate,
    DeleteVariable
}

export abstract class BaseInstruction {
    public constructor(
        public readonly kind: InstructionKind,
        public readonly sourceRange: CompilerRange) {
    }

    public abstract execute(engine: ExecutionEngine, mode: ExecutionMode, frame: StackFrame): void;
}

export class TempLabelInstruction extends BaseInstruction {
    public constructor(
        public readonly name: string,
        range: CompilerRange) {
        super(InstructionKind.TempLabel, range);
    }

    public execute(_1: ExecutionEngine, _2: ExecutionMode, _3: StackFrame): void {
        throw new Error("This should have been removed during emit");
    }
}

export class TempJumpInstruction extends BaseInstruction {
    public constructor(
        public readonly target: string,
        range: CompilerRange) {
        super(InstructionKind.TempJump, range);
    }

    public execute(_1: ExecutionEngine, _2: ExecutionMode, _3: StackFrame): void {
        throw new Error("This should have been removed during emit");
    }
}

export class TempConditionalJumpInstruction extends BaseInstruction {
    public constructor(
        public readonly trueTarget: string | undefined,
        public readonly falseTarget: string | undefined,
        range: CompilerRange) {
        super(InstructionKind.TempConditionalJump, range);
    }

    public execute(_1: ExecutionEngine, _2: ExecutionMode, _3: StackFrame): void {
        throw new Error("This should have been removed during emit");
    }
}

export class JumpInstruction extends BaseInstruction {
    public constructor(
        public readonly target: number,
        range: CompilerRange) {
        super(InstructionKind.Jump, range);
    }

    public execute(_1: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        frame.instructionIndex = this.target;
    }
}

export class ConditionalJumpInstruction extends BaseInstruction {
    public constructor(
        public readonly trueTarget: number | undefined,
        public readonly falseTarget: number | undefined,
        range: CompilerRange) {
        super(InstructionKind.ConditionalJump, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        const value = engine.popEvaluationStack();
        if (value.toBoolean()) {
            if (this.trueTarget) {
                frame.instructionIndex = this.trueTarget;
            } else {
                frame.instructionIndex++;
            }
        } else {
            if (this.falseTarget) {
                frame.instructionIndex = this.falseTarget;
            } else {
                frame.instructionIndex++;
            }
        }
    }
}

export class InvokeSubModuleInstruction extends BaseInstruction {
    public constructor(
        public readonly name: string,
        public readonly argumentCount: number,
        public readonly returnsValue: boolean,
        range: CompilerRange) {
        super(InstructionKind.InvokeSubModule, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        frame.instructionIndex++;
        engine.pushProcedure(this.name, this.argumentCount, this.returnsValue);
    }
}

export class ReturnValueInstruction extends BaseInstruction {
    public constructor(range: CompilerRange) {
        super(InstructionKind.ReturnValue, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, _3: StackFrame): void {
        engine.returnFromFunction(engine.popEvaluationStack());
    }
}

export class OnErrorInstruction extends BaseInstruction {
    public constructor(
        public readonly action: OnErrorAction,
        public readonly handlerName: string | undefined,
        range: CompilerRange) {
        super(InstructionKind.OnError, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        engine.configureErrorHandling(this.action, this.handlerName);
        frame.instructionIndex++;
    }
}

export class SetEventHandlerInstruction extends BaseInstruction {
    public constructor(
        public readonly library: string,
        public readonly eventName: string,
        public readonly subModuleName: string,
        range: CompilerRange) {
        super(InstructionKind.SetEventHandler, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        engine.libraries[this.library].events[this.eventName].setSubModule(this.subModuleName);
        frame.instructionIndex++;
    }
}

export class StoreVariableInstruction extends BaseInstruction {
    public constructor(
        public readonly name: string,
        range: CompilerRange) {
        super(InstructionKind.StoreVariable, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        const value = engine.popEvaluationStack();
        engine.getVariableMemory(this.name, frame).setIndex(this.name, value);
        frame.instructionIndex++;
    }
}

export class StoreArrayElementInstruction extends BaseInstruction {
    public constructor(
        public readonly name: string,
        public readonly indices: number,
        range: CompilerRange) {
        super(InstructionKind.StoreArrayElement, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        const value = engine.popEvaluationStack();

        let index = this.name;
        let current = engine.getVariableMemory(this.name, frame);
        let remainingIndices = this.indices;

        while (remainingIndices-- > 0) {
            const existing = current.getValue(index);
            if (!existing || existing.kind !== ValueKind.Array) {
                current.setIndex(index, new ArrayValue());
            }

            current = current.getValue(index) as ArrayValue;

            // Mirrors the C# instruction: any value works as an index, using its
            // text form.
            index = engine.popEvaluationStack().toValueString();
        }

        // Storing an empty value removes the element, like the C# implementation:
        // A["x"] = "" drops "x" instead of leaving an empty entry behind.
        if (value.toValueString() === "") {
            current.deleteIndex(index);
        } else {
            current.setIndex(index, value);
        }

        frame.instructionIndex++;
    }
}

export class StorePropertyInstruction extends BaseInstruction {
    public constructor(
        public readonly library: string,
        public readonly property: string,
        range: CompilerRange) {
        super(InstructionKind.StoreProperty, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        const setter = engine.libraries[this.library].properties[this.property].setter;

        if (!setter) {
            throw new Error(`Property ${this.library}.${this.property} has no setter`);
        }

        const value = engine.popEvaluationStack();
        setter(value);
        frame.instructionIndex++;
    }
}

export class LoadVariableInstruction extends BaseInstruction {
    public constructor(
        public readonly name: string,
        range: CompilerRange) {
        super(InstructionKind.LoadVariable, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        let value = engine.getVariableMemory(this.name, frame).getValue(this.name);

        if (!value) {
            value = new StringValue("");
        }

        engine.pushEvaluationStack(value);
        frame.instructionIndex++;
    }
}

export class LoadArrayElementInstruction extends BaseInstruction {
    public constructor(
        public readonly name: string,
        public readonly indices: number,
        range: CompilerRange) {
        super(InstructionKind.LoadArrayElement, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        let index = this.name;
        let remainingIndices = this.indices;
        let current = engine.getVariableMemory(this.name, frame);

        // Reading never creates entries, matching the C# implementation: a
        // missing or non-array level yields an empty value, and every index is
        // still consumed from the evaluation stack.
        let found = true;

        while (remainingIndices-- > 0) {
            if (found) {
                const existing = current.getValue(index);
                if (existing && existing.kind === ValueKind.Array) {
                    current = existing as ArrayValue;
                } else {
                    found = false;
                }
            }

            // Mirrors the C# instruction: any value works as an index, using its
            // text form.
            index = engine.popEvaluationStack().toValueString();
        }

        const value = found ? current.getValue(index) : undefined;
        engine.pushEvaluationStack(value ?? new StringValue(""));
        frame.instructionIndex++;
    }
}

export class LoadPropertyInstruction extends BaseInstruction {
    public constructor(
        public readonly library: string,
        public readonly property: string,
        range: CompilerRange) {
        super(InstructionKind.LoadProperty, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        const getter = engine.libraries[this.library].properties[this.property].getter;

        if (!getter) {
            throw new Error(`Property ${this.library}.${this.property} has no getter`);
        }

        const value = getter();
        engine.pushEvaluationStack(value);
        frame.instructionIndex++;
    }
}

export class MethodInvocationInstruction extends BaseInstruction {
    public constructor(
        public readonly library: string,
        public readonly method: string,
        range: CompilerRange) {
        super(InstructionKind.MethodInvocation, range);
    }

    public execute(engine: ExecutionEngine, mode: ExecutionMode, frame: StackFrame): void {
        engine.libraries[this.library].methods[this.method].execute(engine, mode, this.sourceRange);
        switch (engine.state) {
            case ExecutionState.BlockedOnInput:
                break;
            case ExecutionState.Paused:
            case ExecutionState.Terminated:
            case ExecutionState.Running:
                frame.instructionIndex++;
                break;
            default:
                throw new Error(`Unexpected execution state '${ExecutionState[engine.state]}'`);
        }
    }
}

export class NegateInstruction extends BaseInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.Negate, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        // Mirrors the C# UnaryMinusInstruction: a value that is not a number
        // counts as 0.
        engine.pushEvaluationStack(new NumberValue(-engine.popEvaluationStack().toNumber()));
        frame.instructionIndex++;
    }
}

export abstract class BaseBinaryInstruction extends BaseInstruction {
    public constructor(
        public readonly kind: InstructionKind,
        public readonly sourceRange: CompilerRange) {
        super(kind, sourceRange);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        const rightHandSide = engine.popEvaluationStack();
        const leftHandSide = engine.popEvaluationStack();
        const result = this.calculateResult(engine, rightHandSide, leftHandSide);

        engine.pushEvaluationStack(result);
        frame.instructionIndex++;
    }

    protected abstract calculateResult(engine: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue;
}

export class EqualInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.Equal, range);
    }

    protected calculateResult(_: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        // Mirrors the C# EqualInstruction: the text forms are compared, so both
        // 1 = "1" and 1.10 = 1.1 are True.
        return new StringValue(leftHandSide.toValueString() === rightHandSide.toValueString() ? Constants.True : Constants.False);
    }
}

export class LessThanInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.LessThan, range);
    }

    protected calculateResult(_: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        return new StringValue(leftHandSide.toNumber() < rightHandSide.toNumber() ? Constants.True : Constants.False);
    }
}

export class GreaterThanInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.GreaterThan, range);
    }

    protected calculateResult(_: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        return new StringValue(leftHandSide.toNumber() > rightHandSide.toNumber() ? Constants.True : Constants.False);
    }
}

export class LessThanOrEqualInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.LessThanOrEqual, range);
    }

    protected calculateResult(_: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        return new StringValue(leftHandSide.toNumber() <= rightHandSide.toNumber() ? Constants.True : Constants.False);
    }
}

export class GreaterThanOrEqualInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.GreaterThanOrEqual, range);
    }

    protected calculateResult(_: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        return new StringValue(leftHandSide.toNumber() >= rightHandSide.toNumber() ? Constants.True : Constants.False);
    }
}

export class AddInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.Add, range);
    }

    protected calculateResult(_: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        // Mirrors the C# AddInstruction: two numbers add, anything else
        // concatenates its text form.
        if (leftHandSide.kind === ValueKind.Number && rightHandSide.kind === ValueKind.Number) {
            return new NumberValue(leftHandSide.toNumber() + rightHandSide.toNumber());
        }

        return StringValue.Create(leftHandSide.toValueString() + rightHandSide.toValueString());
    }
}

export class SubtractInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.Subtract, range);
    }

    protected calculateResult(_: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        return new NumberValue(leftHandSide.toNumber() - rightHandSide.toNumber());
    }
}

export class MultiplyInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.Multiply, range);
    }

    protected calculateResult(_: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        return new NumberValue(leftHandSide.toNumber() * rightHandSide.toNumber());
    }
}

export class DivideInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.Divide, range);
    }

    protected calculateResult(engine: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        // A zero divisor is a runtime error that `On Error` can catch.
        const divisor = rightHandSide.toNumber();
        if (divisor === 0) {
            engine.reportRuntimeError(RuntimeErrorCode.DivideByZero);
        }

        return new NumberValue(leftHandSide.toNumber() / divisor);
    }
}

export class IntegerDivideInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.IntegerDivide, range);
    }

    protected calculateResult(engine: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        // The quotient is truncated toward zero; a zero divisor is a runtime
        // error that `On Error` can catch.
        const divisor = rightHandSide.toNumber();
        if (divisor === 0) {
            engine.reportRuntimeError(RuntimeErrorCode.DivideByZero);
        }

        return new NumberValue(Math.trunc(leftHandSide.toNumber() / divisor));
    }
}

export class ModuloInstruction extends BaseBinaryInstruction {
    public constructor(
        range: CompilerRange) {
        super(InstructionKind.Modulo, range);
    }

    protected calculateResult(engine: ExecutionEngine, rightHandSide: BaseValue, leftHandSide: BaseValue): BaseValue {
        // The remainder keeps the sign of the dividend; a zero divisor is a
        // runtime error that `On Error` can catch.
        const divisor = rightHandSide.toNumber();
        if (divisor === 0) {
            engine.reportRuntimeError(RuntimeErrorCode.DivideByZero);
        }

        return new NumberValue(leftHandSide.toNumber() % divisor);
    }
}

export class PushNumberInstruction extends BaseInstruction {
    public constructor(
        public readonly value: number,
        range: CompilerRange) {
        super(InstructionKind.PushNumber, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        engine.pushEvaluationStack(new NumberValue(this.value));
        frame.instructionIndex++;
    }
}

export class PushStringInstruction extends BaseInstruction {
    public constructor(
        public readonly value: string,
        range: CompilerRange) {
        super(InstructionKind.PushString, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        engine.pushEvaluationStack(new StringValue(this.value));
        frame.instructionIndex++;
    }
}

export class DuplicateInstruction extends BaseInstruction {
    public constructor(range: CompilerRange) {
        super(InstructionKind.Duplicate, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        const value = engine.popEvaluationStack();
        engine.pushEvaluationStack(value);
        engine.pushEvaluationStack(value);
        frame.instructionIndex++;
    }
}

export class DeleteVariableInstruction extends BaseInstruction {
    public constructor(
        public readonly name: string,
        range: CompilerRange) {
        super(InstructionKind.DeleteVariable, range);
    }

    public execute(engine: ExecutionEngine, _2: ExecutionMode, frame: StackFrame): void {
        engine.getVariableMemory(this.name, frame).deleteIndex(this.name);
        frame.instructionIndex++;
    }
}
