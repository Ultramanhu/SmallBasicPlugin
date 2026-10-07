import { LibraryTypeInstance, LibraryMethodInstance, LibraryPropertyInstance, LibraryEventInstance } from "../libraries";
import { BaseValue, ValueKind } from "../values/base-value";
import { NumberValue } from "../values/number-value";
import { ExecutionEngine, ExecutionMode, ExecutionState } from "../../execution-engine";
import { CompilerRange } from "../../syntax/ranges";
import { RuntimeErrorCode } from "../runtime-error";

export class MathLibrary implements LibraryTypeInstance {
    private getPi(): BaseValue {
        return new NumberValue(Math.PI);
    }

    // decimal.Round, which the C# library calls, rounds half to even: 2.5 is 2
    // and 3.5 is 4. JavaScript's Math.round rounds half up instead, so the C#
    // behaviour is implemented explicitly here.
    private static roundHalfToEven(value: number): number {
        const below = Math.floor(value);
        const fraction = value - below;

        if (fraction > 0.5) {
            return below + 1;
        }

        if (fraction < 0.5) {
            return below;
        }

        return below % 2 === 0 ? below : below + 1;
    }

    private executeCalculation(engine: ExecutionEngine, calculation: (...values: number[]) => number): void {
        const args: number[] = new Array(calculation.length);
        for (let i = args.length - 1; i >= 0; i--) {
            const value = engine.popEvaluationStack().tryConvertToNumber();

            if (value.kind === ValueKind.Number) {
                args[i] = (value as NumberValue).value;
            } else {
                engine.pushEvaluationStack(new NumberValue(0));
                return;
            }
        }

        const result = calculation(...args);
        if (engine.state !== ExecutionState.Terminated) {
            // Domain violations report 1002/1001 from the calculation itself;
            // any remaining non-finite result (Math.Power(0, -1), ...) is a
            // 1003 invalid numeric result.
            if (!Number.isFinite(result)) {
                engine.reportRuntimeError(RuntimeErrorCode.InvalidNumericResult);
            }

            engine.pushEvaluationStack(new NumberValue(result));
        }
    }

    private executeRemainder(engine: ExecutionEngine, _: ExecutionMode, _2: CompilerRange): void {
        return this.executeCalculation(engine, (dividend, divisor) => {
            if (divisor === 0) {
                engine.reportRuntimeError(RuntimeErrorCode.DivideByZero);
            }

            return dividend % divisor;
        });
    }

    public readonly methods: { readonly [name: string]: LibraryMethodInstance } = {
        Abs: { execute: engine => this.executeCalculation(engine, Math.abs) },
        Remainder: { execute: this.executeRemainder.bind(this) },

        // Math.Div / Math.Mod keep the Arithmetic Extension v1 operator
        // semantics (\ and Mod), except that a zero divisor is now a runtime
        // error that `On Error` can catch instead of a silent 0.
        Div: {
            execute: engine => this.executeCalculation(engine, (dividend, divisor) => {
                if (divisor === 0) {
                    engine.reportRuntimeError(RuntimeErrorCode.DivideByZero);
                }

                return Math.trunc(dividend / divisor);
            })
        },
        Mod: {
            execute: engine => this.executeCalculation(engine, (dividend, divisor) => {
                if (divisor === 0) {
                    engine.reportRuntimeError(RuntimeErrorCode.DivideByZero);
                }

                return dividend % divisor;
            })
        },

        Cos: { execute: engine => this.executeCalculation(engine, Math.cos) },
        Sin: { execute: engine => this.executeCalculation(engine, Math.sin) },
        Tan: { execute: engine => this.executeCalculation(engine, Math.tan) },

        ArcCos: {
            execute: engine => this.executeCalculation(engine, value => {
                if (value < -1 || value > 1) {
                    engine.reportRuntimeError(RuntimeErrorCode.InvalidMathOperation);
                }

                return Math.acos(value);
            })
        },
        ArcSin: {
            execute: engine => this.executeCalculation(engine, value => {
                if (value < -1 || value > 1) {
                    engine.reportRuntimeError(RuntimeErrorCode.InvalidMathOperation);
                }

                return Math.asin(value);
            })
        },
        ArcTan: { execute: engine => this.executeCalculation(engine, Math.atan) },

        Ceiling: { execute: engine => this.executeCalculation(engine, Math.ceil) },
        Floor: { execute: engine => this.executeCalculation(engine, Math.floor) },
        Round: { execute: engine => this.executeCalculation(engine, MathLibrary.roundHalfToEven) },

        GetDegrees: { execute: engine => this.executeCalculation(engine, angle => 180 * angle / Math.PI % 360) },
        GetRadians: { execute: engine => this.executeCalculation(engine, angle => angle % 360 * Math.PI / 180) },

        // Random.Next((int)max) + 1 on the C# side: the bound is truncated and
        // reachable (the previous version stopped one short of the maximum).
        GetRandomNumber: { execute: engine => this.executeCalculation(engine, maxNumber => Math.floor(Math.random() * Math.floor(Math.max(1, maxNumber))) + 1) },

        // Math.Log10 on the C# side; Math.log(x) / Math.LN10 loses precision
        // (log(1000) would come out as 2.9999999999999996).
        Log: {
            execute: engine => this.executeCalculation(engine, value => {
                if (value <= 0) {
                    engine.reportRuntimeError(RuntimeErrorCode.InvalidMathOperation);
                }

                return Math.log10(value);
            })
        },
        NaturalLog: {
            execute: engine => this.executeCalculation(engine, value => {
                if (value <= 0) {
                    engine.reportRuntimeError(RuntimeErrorCode.InvalidMathOperation);
                }

                return Math.log(value);
            })
        },

        Max: { execute: engine => this.executeCalculation(engine, (value1, value2) => Math.max(value1, value2)) },
        Min: { execute: engine => this.executeCalculation(engine, (value1, value2) => Math.min(value1, value2)) },

        Power: { execute: engine => this.executeCalculation(engine, (baseNumber, exponent) => Math.pow(baseNumber, exponent)) },
        SquareRoot: {
            execute: engine => this.executeCalculation(engine, value => {
                if (value < 0) {
                    engine.reportRuntimeError(RuntimeErrorCode.InvalidMathOperation);
                }

                return Math.sqrt(value);
            })
        }
    };

    public readonly properties: { readonly [name: string]: LibraryPropertyInstance } = {
        Pi: { getter: this.getPi.bind(this) }
    };

    public readonly events: { readonly [name: string]: LibraryEventInstance } = {};
}
