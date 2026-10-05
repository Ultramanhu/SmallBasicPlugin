import { ExecutionEngine } from "../../execution-engine";
import { AddInstruction, DivideInstruction, IntegerDivideInstruction, ModuloInstruction, MultiplyInstruction, SubtractInstruction } from "../../emitting/instructions";
import { Diagnostic, ErrorCode } from "../../utils/diagnostics";
import { BaseValue, ValueKind } from "./base-value";
import { TokenKind } from "../../syntax/tokens";
import { CompilerUtils } from "../../utils/compiler-utils";

export class ArrayValue extends BaseValue {
    private _values: { [key: string]: BaseValue };

    public constructor(value: { readonly [key: string]: BaseValue } = {}) {
        super();
        this._values = value;
    }

    public get values(): { readonly [key: string]: BaseValue } {
        return this._values;
    }

    public setIndex(index: string, value: BaseValue): void {
        this._values[this.resolveKey(index)] = value;
    }

    public getValue(index: string): BaseValue | undefined {
        return this._values[this.resolveKey(index)];
    }

    public deleteIndex(index: string): void {
        delete this._values[this.resolveKey(index)];
    }

    // Small Basic array indices (and thus variable names) are case insensitive.
    private resolveKey(index: string): string {
        const lower = index.toLowerCase();
        for (const key of Object.keys(this._values)) {
            if (key.toLowerCase() === lower) {
                return key;
            }
        }

        return index;
    }

    public toBoolean(): boolean {
        return false;
    }

    public toDebuggerString(): string {
        return `[${Object.keys(this._values).map(key => `${key}=${this._values[key].toDebuggerString()}`).join(", ")}]`;
    }

    public toValueString(): string {
        return this.toDebuggerString();
    }

    public get kind(): ValueKind {
        return ValueKind.Array;
    }

    public tryConvertToNumber(): BaseValue {
        return this;
    }

    public isEqualTo(other: BaseValue): boolean {
        switch (other.kind) {
            case ValueKind.String:
            case ValueKind.Number:
                return false;
            case ValueKind.Array:
                return this.toDebuggerString() === other.toDebuggerString();
            default:
                throw new Error(`Unexpected value kind ${ValueKind[other.kind]}`);
        }
    }

    public isLessThan(_: BaseValue): boolean {
        return false;
    }

    public isGreaterThan(_: BaseValue): boolean {
        return false;
    }

    public add(_: BaseValue, engine: ExecutionEngine, instruction: AddInstruction): BaseValue {
        engine.terminate(new Diagnostic(ErrorCode.CannotUseOperatorWithAnArray, instruction.sourceRange, CompilerUtils.tokenToDisplayString(TokenKind.Plus)));
        return this;
    }

    public subtract(_: BaseValue, engine: ExecutionEngine, instruction: SubtractInstruction): BaseValue {
        engine.terminate(new Diagnostic(ErrorCode.CannotUseOperatorWithAnArray, instruction.sourceRange, CompilerUtils.tokenToDisplayString(TokenKind.Minus)));
        return this;
    }

    public multiply(_: BaseValue, engine: ExecutionEngine, instruction: MultiplyInstruction): BaseValue {
        engine.terminate(new Diagnostic(ErrorCode.CannotUseOperatorWithAnArray, instruction.sourceRange, CompilerUtils.tokenToDisplayString(TokenKind.Multiply)));
        return this;
    }

    public divide(_: BaseValue, engine: ExecutionEngine, instruction: DivideInstruction): BaseValue {
        engine.terminate(new Diagnostic(ErrorCode.CannotUseOperatorWithAnArray, instruction.sourceRange, CompilerUtils.tokenToDisplayString(TokenKind.Divide)));
        return this;
    }

    public integerDivide(_: BaseValue, engine: ExecutionEngine, instruction: IntegerDivideInstruction): BaseValue {
        engine.terminate(new Diagnostic(ErrorCode.CannotUseOperatorWithAnArray, instruction.sourceRange, CompilerUtils.tokenToDisplayString(TokenKind.Backslash)));
        return this;
    }

    public modulo(_: BaseValue, engine: ExecutionEngine, instruction: ModuloInstruction): BaseValue {
        engine.terminate(new Diagnostic(ErrorCode.CannotUseOperatorWithAnArray, instruction.sourceRange, CompilerUtils.tokenToDisplayString(TokenKind.Mod)));
        return this;
    }
}
