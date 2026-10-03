import { StatementBinder } from "./statement-binder";
import { Diagnostic, ErrorCode } from "../utils/diagnostics";
import { ParseTreeSyntax, StatementBlockSyntax, TokenSyntax } from "../syntax/syntax-nodes";
import { BoundStatementBlock } from "./bound-nodes";
import { RuntimeLibraries } from "../runtime/libraries";
import { CompilerUtils } from "../utils/compiler-utils";

export enum ProcedureKind {
    Sub,
    Function
}

export interface ProcedureSymbol {
    readonly name: string;
    readonly kind: ProcedureKind;
    readonly parameters: ReadonlyArray<string>;
    readonly returnsValue: boolean;
}

export interface ModuleMetadata {
    readonly name: string;
    readonly kind: "program" | "sub" | "function";
    readonly parameters: ReadonlyArray<string>;
    readonly locals: ReadonlyArray<string>;
    readonly globals: ReadonlyArray<string>;
}

export class ModulesBinder {
    public static readonly MainModuleName: string = "<Main>";

    private _definedProcedures: { [name: string]: ProcedureSymbol } = {};
    private _boundModules: { [name: string]: BoundStatementBlock } = {};
    private _moduleMetadata: { [name: string]: ModuleMetadata } = {};

    public get boundModules(): { readonly [name: string]: BoundStatementBlock } {
        return this._boundModules;
    }

    public get definedProcedures(): { readonly [name: string]: ProcedureSymbol } {
        return this._definedProcedures;
    }

    public get moduleMetadata(): { readonly [name: string]: ModuleMetadata } {
        return this._moduleMetadata;
    }

    public constructor(
        parseTree: ParseTreeSyntax,
        private readonly _diagnostics: Diagnostic[]) {
        this.constructProceduresMap(parseTree);

        this.bindModule(ModulesBinder.MainModuleName, "program", parseTree.mainModule, []);

        parseTree.subModules.forEach(subModule => {
            this.bindModule(
                subModule.subCommand.nameToken.token.text,
                "sub",
                subModule.statementsList,
                []);
        });

        parseTree.functions.forEach(func => {
            this.bindModule(
                func.functionCommand.nameToken.token.text,
                "function",
                func.statementsList,
                func.functionCommand.parameterTokens.map(parameter => parameter.token.text));
        });
    }

    private constructProceduresMap(parseTree: ParseTreeSyntax): void {
        parseTree.subModules.forEach(subModule => {
            this.addProcedure(subModule.subCommand.nameToken, ProcedureKind.Sub, []);
        });

        parseTree.functions.forEach(func => {
            const parameters: string[] = [];
            const seen: { [name: string]: boolean } = {};

            func.functionCommand.parameterTokens.forEach(parameter => {
                const name = parameter.token.text;
                const key = name.toLowerCase();
                if (seen[key]) {
                    this._diagnostics.push(new Diagnostic(ErrorCode.DuplicateParameter, parameter.range, name));
                } else {
                    seen[key] = true;
                    parameters.push(name);
                }
            });

            this.addProcedure(func.functionCommand.nameToken, ProcedureKind.Function, parameters);
        });
    }

    private addProcedure(nameToken: TokenSyntax, kind: ProcedureKind, parameters: ReadonlyArray<string>): void {
        const name = nameToken.token.text;
        const key = name.toLowerCase();
        if (CompilerUtils.lookupIgnoreCase(RuntimeLibraries.Metadata, name) !== undefined) {
            this._diagnostics.push(new Diagnostic(ErrorCode.ProcedureConflictsWithLibrary, nameToken.range, name));
        }

        if (this._definedProcedures[key]) {
            const existing = this._definedProcedures[key];
            this._diagnostics.push(new Diagnostic(
                existing.kind === ProcedureKind.Sub && kind === ProcedureKind.Sub
                    ? ErrorCode.TwoSubModulesWithTheSameName
                    : ErrorCode.TwoProceduresWithTheSameName,
                nameToken.range,
                name));
        } else {
            this._definedProcedures[key] = {
                name,
                kind,
                parameters,
                returnsValue: kind === ProcedureKind.Function
            };
        }
    }

    private bindModule(
        name: string,
        kind: "program" | "sub" | "function",
        statements: StatementBlockSyntax,
        parameters: ReadonlyArray<string>): void {
        const binder = new StatementBinder(
            statements,
            this._definedProcedures,
            this._diagnostics,
            parameters,
            kind === "function",
            kind !== "program");

        this._boundModules[name] = binder.result;
        this._moduleMetadata[name] = {
            name,
            kind,
            parameters,
            locals: binder.locals,
            globals: kind === "program" ? binder.declarations : []
        };
    }
}
