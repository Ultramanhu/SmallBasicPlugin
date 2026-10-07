import { BaseValue, ValueKind } from "./base-value";

export class NumberValue extends BaseValue {
    public constructor(public readonly value: number) {
        super();
    }

    public toBoolean(): boolean {
        return false;
    }

    public toDebuggerString(): string {
        return this.value.toString();
    }

    public toValueString(): string {
        return this.toDebuggerString();
    }

    public toNumber(): number {
        return this.value;
    }

    public tryConvertToNumber(): BaseValue {
        return this;
    }

    public get kind(): ValueKind {
        return ValueKind.Number;
    }
}
