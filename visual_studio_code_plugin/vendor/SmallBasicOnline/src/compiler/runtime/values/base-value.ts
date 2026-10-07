export module Constants {
    export const True = "True";
    export const False = "False";
}

export enum ValueKind {
    String,
    Number,
    Array
}

/*
 * Mirrors SmallBasic.Compiler.Runtime.BaseValue: a value knows how to render
 * itself, how it behaves in a condition and what it counts as in arithmetic.
 * The operators themselves live with the instructions (see AddInstruction & co),
 * exactly like they do in the C# implementation.
 */
export abstract class BaseValue {
    public abstract toBoolean(): boolean;

    public abstract toDebuggerString(): string;

    public abstract toValueString(): string;

    /**
     * The numeric value of this value, 0 for anything that is not a number
     * (used by arithmetic and relational operators, mirroring C# ToNumber).
     */
    public abstract toNumber(): number;

    /**
     * This value as a NumberValue when it holds numeric text, otherwise itself.
     * Library methods use it to distinguish numbers from other values.
     */
    public abstract tryConvertToNumber(): BaseValue;

    public abstract get kind(): ValueKind;
}
