import { BaseValue, ValueKind } from "./base-value";

export class ArrayValue extends BaseValue {
    // A Map keeps insertion order, exactly like the Dictionary the C# backends
    // use. A plain object would list integer-like keys (array indices such as
    // "2") before the others, so Array.GetAllIndices and the text form of an
    // array would disagree between the two implementations.
    private readonly _values = new Map<string, BaseValue>();

    public constructor(value: { readonly [key: string]: BaseValue } = {}) {
        super();
        Object.keys(value).forEach(key => this._values.set(key, value[key]));
    }

    /** Index names in insertion order. */
    public get keys(): ReadonlyArray<string> {
        return [...this._values.keys()];
    }

    public get count(): number {
        return this._values.size;
    }

    public get values(): { readonly [key: string]: BaseValue } {
        const result: { [key: string]: BaseValue } = {};
        this._values.forEach((value, key) => result[key] = value);
        return result;
    }

    public setIndex(index: string, value: BaseValue): void {
        this._values.set(this.resolveKey(index), value);
    }

    public getValue(index: string): BaseValue | undefined {
        return this._values.get(this.resolveKey(index));
    }

    public deleteIndex(index: string): void {
        this._values.delete(this.resolveKey(index));
    }

    // Small Basic array indices (and thus variable names) are case insensitive.
    private resolveKey(index: string): string {
        const lower = index.toLowerCase();
        for (const key of this._values.keys()) {
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
        return `[${this.keys.map(key => `${key}=${this._values.get(key)!.toDebuggerString()}`).join(", ")}]`;
    }

    // The C# backends render an array as "index=value;" pairs with ';', '=' and
    // '\' escaped, which is what a program sees when an array is written or
    // converted to text.
    public toValueString(): string {
        let result = "";
        this._values.forEach((value, key) => {
            result += `${key}=${ArrayValue.escape(value.toValueString())};`;
        });

        return result;
    }

    public toNumber(): number {
        return 0;
    }

    public tryConvertToNumber(): BaseValue {
        return this;
    }

    public get kind(): ValueKind {
        return ValueKind.Array;
    }

    private static escape(value: string): string {
        let result = "";
        for (let index = 0; index < value.length; index++) {
            const character = value[index];
            switch (character) {
                case ";":
                case "=":
                case "\\":
                    result += "\\";
                    break;
                default:
                    break;
            }

            result += character;
        }

        return result;
    }
}
