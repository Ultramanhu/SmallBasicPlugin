import { NumberValue } from "./number-value";
import { BaseValue, ValueKind, Constants } from "./base-value";

export class StringValue extends BaseValue {
    /*
     * Mirrors the number style of SmallBasic.Compiler's StringValue.Create
     * (NumberStyles.Integer | AllowTrailingSign | AllowDecimalPoint): an
     * optional sign at either end, digits with at most one decimal point, and
     * no thousands separators or exponents.
     */
    private static readonly NumericTextPattern = /^([+-]?)(\d+(\.\d*)?|\.\d+)([+-]?)$/u;

    // decimal (the C# value type) tops out at 7.9e28; larger magnitudes are kept
    // as text there, so they are kept as text here as well.
    private static readonly MaxDecimalMagnitude = 7.9228162514264338e28;

    public constructor(public readonly value: string) {
        super();
    }

    /**
     * Mirrors SmallBasic.Compiler's StringValue.Create: text that looks like a
     * boolean or a plain decimal number materializes as that value kind, so both
     * implementations agree on cases such as "0012", "0." or " true ".
     */
    public static Create(text: string): BaseValue {
        switch (text.trim().toLowerCase()) {
            case "true": return new StringValue(Constants.True);
            case "false": return new StringValue(Constants.False);
            default: break;
        }

        const converted = StringValue.tryParseNumber(text.trim());
        return converted === undefined ? new StringValue(text) : new NumberValue(converted);
    }

    /**
     * Applies the text-to-value conversion to a value that is about to be used
     * by the program. Values that are not plain text pass through unchanged, so
     * the conversion is idempotent.
     */
    public static Fold(value: BaseValue): BaseValue {
        return value.kind === ValueKind.String ? StringValue.Create((value as StringValue).value) : value;
    }

    private static tryParseNumber(text: string): number | undefined {
        const match = StringValue.NumericTextPattern.exec(text);
        if (!match || (match[1].length > 0 && match[4].length > 0)) {
            return undefined;
        }

        const magnitude = Number(match[2]);
        if (!Number.isFinite(magnitude) || magnitude > StringValue.MaxDecimalMagnitude) {
            return undefined;
        }

        return match[1] === "-" || match[4] === "-" ? -magnitude : magnitude;
    }

    public toBoolean(): boolean {
        return this.value.toLowerCase() === Constants.True.toLowerCase();
    }

    public toDebuggerString(): string {
        return `"${this.value.toString()}"`;
    }

    public toValueString(): string {
        return this.value;
    }

    public toNumber(): number {
        // Text that is not a plain decimal number counts as 0, like the C#
        // ToNumber of a string value ("1e5" is text there, not 100000).
        return StringValue.tryParseNumber(this.value.trim()) ?? 0;
    }

    public tryConvertToNumber(): BaseValue {
        const converted = StringValue.tryParseNumber(this.value.trim());
        return converted === undefined ? this : new NumberValue(converted);
    }

    public get kind(): ValueKind {
        return ValueKind.String;
    }
}
