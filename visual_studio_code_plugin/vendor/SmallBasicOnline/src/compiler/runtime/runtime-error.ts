/**
 * The unified runtime error model shared by the TS and C# engines. A runtime
 * error is a stable numeric code plus a human-readable message, printed as
 * `[Runtime Error] <code>: <message>` and passed to `On Error GoSub` handlers
 * as `(code, message)` arguments.
 */
export enum RuntimeErrorCode {
    DivideByZero = 1001,
    InvalidMathOperation = 1002,
    InvalidNumericResult = 1003,
    EmptyStack = 1101,
    UnsupportedLibraryOperation = 1901,
    InternalRuntimeError = 1999
}

export const RuntimeErrorMessage: { readonly [code: number]: string } = {
    [RuntimeErrorCode.DivideByZero]: "Divide by zero.",
    [RuntimeErrorCode.InvalidMathOperation]: "Invalid math operation.",
    [RuntimeErrorCode.InvalidNumericResult]: "Invalid numeric result.",
    [RuntimeErrorCode.EmptyStack]: "This stack has no elements to be popped.",
    [RuntimeErrorCode.UnsupportedLibraryOperation]: "This library is not supported by the current host.",
    [RuntimeErrorCode.InternalRuntimeError]: "Internal runtime error."
};

export interface RuntimeError {
    readonly code: number;
    readonly message: string;
}

/**
 * Thrown by `engine.reportRuntimeError(...)` and caught by the engine's
 * execution loop, which turns it into abort/resume-next/handler dispatch
 * according to the current `On Error` policy. Instructions and libraries can
 * therefore report errors without knowing the recovery strategy.
 */
export class RuntimeErrorSignal extends Error {
    public constructor(
        public readonly runtimeError: RuntimeError) {
        super(`[${runtimeError.code}]: ${runtimeError.message}`);
        this.name = "RuntimeErrorSignal";
    }
}

export function formatRuntimeError(error: RuntimeError): string {
    return `[Runtime Error] ${error.code}: ${error.message}`;
}
