import { ValueKind, Constants, BaseValue } from "../values/base-value";
import { StringValue } from "../values/string-value";
import { ArrayValue } from "../values/array-value";
import { NumberValue } from "../values/number-value";
import { ExecutionEngine } from "../../execution-engine";
import { LibraryMethodInstance, LibraryTypeInstance, LibraryPropertyInstance, LibraryEventInstance } from "../libraries";

export class ArrayLibrary implements LibraryTypeInstance {
    private readonly arrays: { [name: string]: ArrayValue } = {};

    private normalizeArrayName(name: string): string {
        return name.toLowerCase();
    }

    private executeIsArray(engine: ExecutionEngine): void {
        const value = engine.popEvaluationStack();
        engine.pushEvaluationStack(new StringValue(value.kind === ValueKind.Array ? Constants.True : Constants.False));
    }

    private executeGetItemCount(engine: ExecutionEngine): void {
        const array = engine.popEvaluationStack();
        const itemCount = array.kind === ValueKind.Array
            ? (array as ArrayValue).count
            : 0;

        engine.pushEvaluationStack(new NumberValue(itemCount));
    }

    private executeGetAllIndices(engine: ExecutionEngine): void {
        const array = engine.popEvaluationStack();
        const newArray: { [key: string]: BaseValue } = {};

        if (array.kind === ValueKind.Array) {
            (array as ArrayValue).keys.forEach((key, i) => {
                newArray[i + 1] = new StringValue(key);
            });
        }

        engine.pushEvaluationStack(new ArrayValue(newArray));
    }

    private executeContainsValue(engine: ExecutionEngine): void {
        const value = engine.popEvaluationStack();
        const array = engine.popEvaluationStack();
        let result = Constants.False;

        if (array.kind === ValueKind.Array) {
            const arrayValue = array as ArrayValue;
            // Mirrors the C# ContainsValue: the text forms are compared.
            for (const key of arrayValue.keys) {
                if (arrayValue.getValue(key)!.toValueString() === value.toValueString()) {
                    result = Constants.True;
                    break;
                }
            }
        }

        engine.pushEvaluationStack(new StringValue(result));
    }

    private executeContainsIndex(engine: ExecutionEngine): void {
        const index = engine.popEvaluationStack().tryConvertToNumber();
        const array = engine.popEvaluationStack();
        let result = Constants.False;

        if (array.kind === ValueKind.Array) {
            if (index.kind === ValueKind.Number || index.kind === ValueKind.String)
                if ((array as ArrayValue).getValue(index.toValueString())) {
                    result = Constants.True;
                }
        }

        engine.pushEvaluationStack(new StringValue(result));
    }

    private executeGetValue(engine: ExecutionEngine): void {
        const index = engine.popEvaluationStack().toValueString();
        const arrayName = engine.popEvaluationStack().toValueString();
        const array = this.arrays[this.normalizeArrayName(arrayName)];

        engine.pushEvaluationStack(array?.getValue(index) ?? new StringValue(""));
    }

    private executeRemoveValue(engine: ExecutionEngine): void {
        const index = engine.popEvaluationStack().toValueString();
        const arrayName = this.normalizeArrayName(engine.popEvaluationStack().toValueString());
        const array = this.arrays[arrayName];

        if (array?.getValue(index)) {
            array.deleteIndex(index);
            this.arrays[arrayName] = array;
        }
    }

    private executeSetValue(engine: ExecutionEngine): void {
        const value = engine.popEvaluationStack();
        const index = engine.popEvaluationStack().toValueString();
        const arrayName = this.normalizeArrayName(engine.popEvaluationStack().toValueString());
        const array = this.arrays[arrayName] ?? new ArrayValue();

        array.setIndex(index, value);
        this.arrays[arrayName] = array;
    }

    public readonly methods: { readonly [name: string]: LibraryMethodInstance } = {
        IsArray: { execute: this.executeIsArray.bind(this) },
        GetItemCount: { execute: this.executeGetItemCount.bind(this) },
        GetAllIndices: { execute: this.executeGetAllIndices.bind(this) },
        ContainsValue: { execute: this.executeContainsValue.bind(this) },
        ContainsIndex: { execute: this.executeContainsIndex.bind(this) },
        GetValue: { execute: this.executeGetValue.bind(this) },
        RemoveValue: { execute: this.executeRemoveValue.bind(this) },
        SetValue: { execute: this.executeSetValue.bind(this) }
    };

    public readonly properties: { readonly [name: string]: LibraryPropertyInstance } = {};

    public readonly events: { readonly [name: string]: LibraryEventInstance } = {};
}
