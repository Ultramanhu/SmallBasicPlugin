import { BaseValue } from "./runtime/values/base-value";
import { Compilation } from "./compilation";
import { BaseInstruction } from "./emitting/instructions";
import { RuntimeLibraries } from "./runtime/libraries";
import { Diagnostic } from "./utils/diagnostics";
import { ArrayValue } from "./runtime/values/array-value";
import { PubSubPayloadChannel } from "./utils/notifications";
import { ModulesBinder } from "./binding/modules-binder";
import { ModuleMetadata } from "./binding/modules-binder";
import { StringValue } from "./runtime/values/string-value";
import { NumberValue } from "./runtime/values/number-value";
import { OnErrorAction } from "./syntax/syntax-nodes";
import { RuntimeErrorMessage, RuntimeError, RuntimeErrorSignal, formatRuntimeError } from "./runtime/runtime-error";

export interface StackFrame {
    moduleName: string;
    instructionIndex: number;
    localMemory: ArrayValue;
    evaluationStackBase: number;
    returnsValue: boolean;
    isErrorHandler?: boolean;
}

export enum ExecutionMode {
    RunToEnd,
    Debug,
    NextStatement
}

export enum ExecutionState {
    Running,
    Paused,
    BlockedOnInput,
    Terminated
}

/**
 * Engine-level `On Error` policy. `abort` is the default terminate-on-error
 * behavior; `resume-next` skips the failing statement; `gosub` additionally
 * invokes the registered handler Sub before skipping it.
 */
export type ErrorHandlingMode = "abort" | "resume-next" | "gosub";

export class ExecutionEngine {
    private _libraries: RuntimeLibraries = new RuntimeLibraries();
    private _executionStack: StackFrame[] = [];
    private _evaluationStack: BaseValue[] = [];
    private _memory: ArrayValue = new ArrayValue();
    private _modules: { readonly [name: string]: ReadonlyArray<BaseInstruction> };
    private _moduleMetadata: { readonly [name: string]: ModuleMetadata };

    private _exception?: Diagnostic;
    private _currentLine: number = 0;
    private _state: ExecutionState = ExecutionState.Running;

    // `On Error` state. The policy is engine-level: it applies to every
    // statement (main program, Subs, Functions and event callbacks) until a
    // new `On Error` statement changes it.
    private _errorMode: ErrorHandlingMode = "abort";
    private _errorHandlerName?: string;
    private _isHandlingRuntimeError: boolean = false;
    private _lastRuntimeError?: RuntimeError;

    // Statement-level rollback point: the source line being executed and the
    // evaluation stack depth where that line started. `Resume Next` and
    // `GoSub` handlers resume at the NEXT statement, so a failed statement
    // must not leave partial values behind.
    private _statementFrame?: StackFrame;
    private _statementLine: number = -1;
    private _statementStackBase: number = 0;

    // Debug-mode unhandled errors pause on the failure scene instead of
    // terminating right away; the next `execute` call terminates.
    private _mode: ExecutionMode = ExecutionMode.RunToEnd;
    private _pausedOnRuntimeError: boolean = false;

    public readonly programTerminated: PubSubPayloadChannel<Diagnostic | undefined> = new PubSubPayloadChannel<Diagnostic | undefined>("programTerminated");

    public get libraries(): RuntimeLibraries {
        return this._libraries;
    }

    public get executionStack(): ReadonlyArray<StackFrame> {
        return this._executionStack;
    }

    public get evaluationStack(): ReadonlyArray<BaseValue> {
        return this._evaluationStack;
    }

    public get memory(): ArrayValue {
        return this._memory;
    }

    public get modules(): { readonly [name: string]: ReadonlyArray<BaseInstruction> } {
        return this._modules;
    }

    public get exception(): Diagnostic | undefined {
        return this._exception;
    }

    public get lastRuntimeError(): RuntimeError | undefined {
        return this._lastRuntimeError;
    }

    /** True while the engine is paused on an unhandled runtime error in debug mode. */
    public get pausedOnRuntimeError(): boolean {
        return this._pausedOnRuntimeError;
    }

    public get errorHandlingMode(): ErrorHandlingMode {
        return this._errorMode;
    }

    public get state(): ExecutionState {
        return this._state;
    }

    public set state(newState: ExecutionState) {
        this._state = newState;
    }

    public constructor(compilation: Compilation) {
        if (compilation.diagnostics.length) {
            throw new Error(`Cannot execute a compilation with errors`);
        }

        this._modules = compilation.emit();
        this._moduleMetadata = compilation.moduleMetadata;

        const mainMetadata = this._moduleMetadata[ModulesBinder.MainModuleName];
        mainMetadata.globals.forEach(global => this._memory.setIndex(global, new StringValue("")));

        this.pushProcedure(ModulesBinder.MainModuleName, 0, false);
    }

    public execute(mode: ExecutionMode): void {
        this._mode = mode;

        if (this._pausedOnRuntimeError) {
            // Continuing after an unhandled runtime error stops the program.
            this.terminate();
            return;
        }

        if (this._state === ExecutionState.Paused) {
            this._state = ExecutionState.Running;
        }

        while (true) {
            if (this._state === ExecutionState.Terminated) {
                return;
            }

            if (this._executionStack.length === 0) {
                this.terminate();
                return;
            }

            const frame = this._executionStack[this._executionStack.length - 1];
            if (frame.instructionIndex === this._modules[frame.moduleName].length) {
                this.completeCurrentFrame();
                continue;
            }

            const instruction = this._modules[frame.moduleName][frame.instructionIndex];
            if (instruction.sourceRange.start.line !== this._currentLine && mode === ExecutionMode.NextStatement) {
                this._currentLine = instruction.sourceRange.start.line;
                this._state = ExecutionState.Paused;
                return;
            }

            // Record the statement-level rollback point: the first instruction
            // of every source line (per frame) snapshots the evaluation stack.
            const instructionLine = instruction.sourceRange.start.line;
            if (frame !== this._statementFrame || instructionLine !== this._statementLine) {
                this._statementFrame = frame;
                this._statementLine = instructionLine;
                this._statementStackBase = this._evaluationStack.length;
            }

            try {
                instruction.execute(this, mode, frame);
            } catch (error) {
                if (error instanceof RuntimeErrorSignal) {
                    this.handleRuntimeError(error.runtimeError);
                    if (this._state !== ExecutionState.Running) {
                        return;
                    }
                    continue;
                }

                throw error;
            }

            switch (this.state) {
                case ExecutionState.Running:
                    break;
                case ExecutionState.Paused:
                case ExecutionState.Terminated:
                case ExecutionState.BlockedOnInput:
                    return;
                default:
                    throw new Error(`Unexpected execution state: '${ExecutionState[this.state]}'`);
            }
        }
    }

    public terminate(exception?: Diagnostic): void {
        this._state = ExecutionState.Terminated;
        this._exception = exception;
        this._pausedOnRuntimeError = false;
        this.programTerminated.publish(exception);
    }

    /**
     * Configures the engine-level error policy from an `On Error ...`
     * statement. `GoTo -1` and `GoTo 0` both restore the default
     * terminate-on-error behavior and drop any registered handler.
     */
    public configureErrorHandling(action: OnErrorAction, handlerName: string | undefined): void {
        switch (action) {
            case "resume-next":
                this._errorMode = "resume-next";
                this._errorHandlerName = undefined;
                break;
            case "gosub":
                this._errorMode = "gosub";
                this._errorHandlerName = handlerName;
                break;
            case "goto-default":
            case "goto-clear":
                this._errorMode = "abort";
                this._errorHandlerName = undefined;
                break;
            default:
                throw new Error(`Unexpected On Error action: '${action}'`);
        }
    }

    /**
     * Reports a runtime error from an instruction or a library. Throws a
     * signal the execution loop turns into abort / resume / handler dispatch,
     * so callers must treat this call as never returning.
     */
    public reportRuntimeError(code: number, message?: string): never {
        throw new RuntimeErrorSignal({ code, message: message ?? RuntimeErrorMessage[code] ?? "Runtime error." });
    }

    private handleRuntimeError(error: RuntimeError): void {
        if (this._isHandlingRuntimeError || this._errorMode === "abort") {
            // Unhandled: mirror to the console and either pause on the failure
            // scene (debug sessions) or terminate (plain run mode).
            this._lastRuntimeError = error;
            if (this._mode !== ExecutionMode.RunToEnd) {
                this._pausedOnRuntimeError = true;
                this._state = ExecutionState.Paused;
            } else {
                this.terminate();
            }
            return;
        }

        // Handled: the error is mirrored to the program console, the failing
        // statement is skipped, and the handler (if any) is invoked with the
        // (code, message) arguments.
        this.writeRuntimeErrorToConsole(error);
        this.skipFailedStatement();

        if (this._errorMode === "gosub" && this._errorHandlerName) {
            this._isHandlingRuntimeError = true;
            this.pushEvaluationStack(new NumberValue(error.code));
            this.pushEvaluationStack(new StringValue(error.message));
            this.pushProcedure(this._errorHandlerName, 2, false, /* isErrorHandler */ true);
        }
    }

    private writeRuntimeErrorToConsole(error: RuntimeError): void {
        const plugin = this._libraries.TextWindow.pluginOpt;
        plugin?.writeText(formatRuntimeError(error), true);
    }

    /**
     * Rolls the evaluation stack back to the failing statement's start and
     * advances the failing frame past the failed source line, so execution
     * resumes at the next statement.
     */
    private skipFailedStatement(): void {
        const frame = this._executionStack[this._executionStack.length - 1];
        if (!frame) {
            return;
        }

        this.restoreEvaluationStack(this._statementStackBase);

        const instructions = this._modules[frame.moduleName];
        let index = frame.instructionIndex;
        while (index < instructions.length && instructions[index].sourceRange.start.line === this._statementLine) {
            index++;
        }

        frame.instructionIndex = index;
    }

    public popEvaluationStack(): BaseValue {
        const value = this._evaluationStack.pop();
        if (value) {
            return value;
        }

        throw new Error("Evaluation stack empty");
    }

    public pushEvaluationStack(value: BaseValue): void {
        // Values are normalized on the way in, exactly like the C# runtime
        // normalizes literals and library results (StringValue.Create). Doing it
        // in this single place keeps both implementations in sync for text such
        // as "0012", " true " or numeric text produced by a library.
        this._evaluationStack.push(StringValue.Fold(value));
    }

    public getVariableMemory(name: string, frame: StackFrame): ArrayValue {
        return frame.localMemory.getValue(name) !== undefined
            ? frame.localMemory
            : this._memory;
    }

    public pushProcedure(name: string, argumentCount: number, returnsValue: boolean, isErrorHandler: boolean = false): void {
        const metadata = this._moduleMetadata[name];
        if (!this._modules[name] || !metadata) {
            throw new Error(`SubModule ${name} not found`);
        }

        if (argumentCount !== metadata.parameters.length) {
            throw new Error(`Procedure ${name} expected ${metadata.parameters.length} arguments but received ${argumentCount}`);
        }

        const argumentsList: BaseValue[] = new Array(argumentCount);
        for (let index = argumentCount - 1; index >= 0; index--) {
            argumentsList[index] = this.popEvaluationStack();
        }

        const localMemory = new ArrayValue();
        metadata.locals.forEach(local => localMemory.setIndex(local, new StringValue("")));
        metadata.parameters.forEach((parameter, index) => localMemory.setIndex(parameter, argumentsList[index]));

        this._executionStack.push({
            moduleName: name,
            instructionIndex: 0,
            localMemory,
            evaluationStackBase: this._evaluationStack.length,
            returnsValue,
            isErrorHandler
        });
    }

    public pushSubModule(name: string): void {
        this.pushProcedure(name, 0, false);
    }

    public returnFromFunction(value: BaseValue): void {
        const frame = this._executionStack[this._executionStack.length - 1];
        if (!frame || !frame.returnsValue) {
            throw new Error("ReturnValueInstruction executed outside a function frame");
        }

        this._executionStack.pop();
        this.restoreEvaluationStack(frame.evaluationStackBase);
        this._evaluationStack.push(value);
    }

    public raiseEvent(subModuleName: string): void {
        const existingIndex = this._executionStack.findIndex(
            (frame, index) => index < this._executionStack.length - 1 && frame.moduleName === subModuleName
        );

        if (existingIndex >= 0) {
            this._executionStack.splice(existingIndex, 1);
        }

        this.pushSubModule(subModuleName);
    }

    private completeCurrentFrame(): void {
        const frame = this._executionStack.pop();
        if (!frame) {
            return;
        }

        if (frame.isErrorHandler) {
            this._isHandlingRuntimeError = false;
        }

        this.restoreEvaluationStack(frame.evaluationStackBase);
        if (frame.returnsValue) {
            this._evaluationStack.push(new StringValue(""));
        }
    }

    private restoreEvaluationStack(size: number): void {
        if (this._evaluationStack.length < size) {
            throw new Error("Evaluation stack became unbalanced while executing a procedure");
        }

        this._evaluationStack.length = size;
    }
}
