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

export interface StackFrame {
    moduleName: string;
    instructionIndex: number;
    localMemory: ArrayValue;
    evaluationStackBase: number;
    returnsValue: boolean;
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

            instruction.execute(this, mode, frame);

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
        this.programTerminated.publish(exception);
    }

    public popEvaluationStack(): BaseValue {
        const value = this._evaluationStack.pop();
        if (value) {
            return value;
        }

        throw new Error("Evaluation stack empty");
    }

    public pushEvaluationStack(value: BaseValue): void {
        this._evaluationStack.push(value);
    }

    public getVariableMemory(name: string, frame: StackFrame): ArrayValue {
        return frame.localMemory.getValue(name) !== undefined
            ? frame.localMemory
            : this._memory;
    }

    public pushProcedure(name: string, argumentCount: number, returnsValue: boolean): void {
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
            returnsValue
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
