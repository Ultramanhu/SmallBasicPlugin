import { Compilation } from "../../compiler/compilation";
import { CompilerRange, CompilerPosition } from "../syntax/ranges";
import { RuntimeLibraries } from "../runtime/libraries";
import { CompilerUtils } from "../utils/compiler-utils";
import {
    BaseSyntaxNode,
    BinaryOperatorExpressionSyntax,
    DimCommandSyntax,
    FunctionDeclarationSyntax,
    GoSubCommandSyntax,
    IdentifierExpressionSyntax,
    ObjectAccessExpressionSyntax,
    OnErrorCommandSyntax,
    SubModuleDeclarationSyntax,
    SyntaxKind,
    SyntaxNodeVisitor,
    TokenSyntax
} from "../syntax/syntax-nodes";
import { ProcedureKind, ProcedureSymbol } from "../binding/modules-binder";
import { TokenKind } from "../syntax/tokens";

export module HoverService {
    export interface Result {
        text: string[];
        range: CompilerRange;
    }

    export function provideHover(compilation: Compilation, position: CompilerPosition): Result | undefined {
        for (let i = 0; i < compilation.diagnostics.length; i++) {
            const diagnostic = compilation.diagnostics[i];

            if (diagnostic.range.containsPosition(position)) {
                return {
                    range: diagnostic.range,
                    text: [diagnostic.toString()]
                };
            }
        }

        const keyword = provideKeywordHover(compilation, position);
        if (keyword) {
            return keyword;
        }

        const userSymbol = provideUserSymbolHover(compilation, position);
        if (userSymbol) {
            return userSymbol;
        }

        const node = compilation.getSyntaxNode(position, SyntaxKind.ObjectAccessExpression);
        if (node) {
            const visitor = new HoverVisitor();
            visitor.visit(node);
            return visitor.result;
        }

        return undefined;
    }

    /**
     * Loop control keywords and the Mod / \ operator tokens carry no symbol,
     * so they would otherwise fall through to the library-member visitor and
     * produce no hover at all.
     */
    function provideKeywordHover(compilation: Compilation, position: CompilerPosition): Result | undefined {
        for (const token of compilation.tokens) {
            if (!token.range.containsPosition(position)) {
                continue;
            }

            switch (token.kind) {
                case TokenKind.BreakKeyword:
                    return {
                        range: token.range,
                        text: ["Break", "Exits the innermost While or For loop."]
                    };
                case TokenKind.ContinueKeyword:
                    return {
                        range: token.range,
                        text: [
                            "Continue",
                            "Skips to the next iteration of the innermost While or For loop. In a For loop the increment or Step still runs."
                        ]
                    };
                case TokenKind.GoSubKeyword: {
                    const goSub = compilation.getSyntaxNode(position, SyntaxKind.GoSubCommand) as GoSubCommandSyntax | undefined;
                    if (goSub?.nameToken.range.containsPosition(position)) {
                        const target = findProcedure(compilation, goSub.nameToken.token.text);
                        return procedureResult(target, goSub.nameToken);
                    }

                    return {
                        range: token.range,
                        text: [
                            "GoSub",
                            "Calls a parameterless Sub and returns to the next statement after the call."
                        ]
                    };
                }
                case TokenKind.Identifier: {
                    // `On Error ...` is built from contextual keywords: hover any
                    // token of the clause for its meaning, and the handler target
                    // for its procedure signature.
                    const onError = compilation.getSyntaxNode(position, SyntaxKind.OnErrorCommand) as OnErrorCommandSyntax | undefined;
                    if (!onError || !onError.range.containsPosition(position)) {
                        return undefined;
                    }

                    if (onError.targetToken?.range.containsPosition(position)) {
                        const handler = findProcedure(compilation, onError.targetToken.token.text);
                        return procedureResult(handler, onError.targetToken);
                    }

                    return onErrorKeywordHover(onError, token.range);
                }
                case TokenKind.Mod:
                    if (!isBinaryOperatorToken(compilation, position, token.kind)) {
                        return undefined;
                    }
                    return {
                        range: token.range,
                        text: [
                            "Mod",
                            "Returns the remainder of dividing the left number by the right one, with the same sign as the dividend. Dividing by zero is a runtime error that On Error can catch."
                        ]
                    };
                case TokenKind.Backslash:
                    if (!isBinaryOperatorToken(compilation, position, token.kind)) {
                        return undefined;
                    }
                    return {
                        range: token.range,
                        text: [
                            "\\",
                            "Integer division: divides the left number by the right one and truncates the quotient toward zero. Dividing by zero is a runtime error that On Error can catch."
                        ]
                    };
                default:
                    return undefined;
            }
        }

        return undefined;
    }

    function isBinaryOperatorToken(compilation: Compilation, position: CompilerPosition, kind: TokenKind): boolean {
        const expression = compilation.getSyntaxNode(position, SyntaxKind.BinaryOperatorExpression) as BinaryOperatorExpressionSyntax | undefined;
        return expression?.operatorToken.token.kind === kind
            && expression.operatorToken.range.containsPosition(position);
    }

    function onErrorKeywordHover(onError: OnErrorCommandSyntax, range: CompilerRange): Result {
        switch (onError.action) {
            case "resume-next":
                return { range, text: ["On Error Resume Next", "Skips the statement that caused a runtime error, mirrors it to the console, and keeps running."] };
            case "goto-default":
                return { range, text: ["On Error GoTo -1", "Clears the current error state and restores the default behavior: a runtime error terminates the program."] };
            case "goto-clear":
                return { range, text: ["On Error GoTo 0", "Disables the current On Error handler; runtime errors terminate the program again."] };
            case "gosub":
                return { range, text: ["On Error GoSub", "When a runtime error occurs, mirrors it to the console and calls the handler Sub with the error code and message; execution then resumes after the failed statement."] };
            default:
                return { range, text: ["On Error", "Configures the runtime error handling policy."] };
        }
    }

    function provideUserSymbolHover(compilation: Compilation, position: CompilerPosition): Result | undefined {
        for (const func of compilation.parseTree.functions) {
            const procedure = findProcedure(compilation, func.functionCommand.nameToken.token.text);
            if (func.functionCommand.nameToken.range.containsPosition(position)) {
                return procedureResult(procedure, func.functionCommand.nameToken);
            }

            const parameter = func.functionCommand.parameterTokens.find(token => token.range.containsPosition(position));
            if (parameter) {
                return variableResult(parameter, "Parameter", "Function-scoped parameter");
            }
        }

        for (const sub of compilation.parseTree.subModules) {
            const procedure = findProcedure(compilation, sub.subCommand.nameToken.token.text);
            if (sub.subCommand.nameToken.range.containsPosition(position)) {
                return procedureResult(procedure, sub.subCommand.nameToken);
            }
        }

        const dim = compilation.getSyntaxNode(position, SyntaxKind.DimCommand) as DimCommandSyntax | undefined;
        const dimVariable = dim?.variableTokens.find(token => token.range.containsPosition(position));
        if (dimVariable) {
            return variableResult(dimVariable, "Local variable", "Procedure-scoped variable declared with Dim");
        }

        const identifier = compilation.getSyntaxNode(position, SyntaxKind.IdentifierExpression) as IdentifierExpressionSyntax | undefined;
        if (!identifier) {
            return undefined;
        }

        const name = identifier.identifierToken.token.text;
        const procedure = findProcedure(compilation, name);
        if (procedure) {
            return procedureResult(procedure, identifier.identifierToken);
        }

        const declaration = containingProcedure(compilation, position);
        if (!declaration) {
            return undefined;
        }

        if (declaration.kind === SyntaxKind.FunctionDeclaration) {
            const func = declaration as FunctionDeclarationSyntax;
            const parameter = func.functionCommand.parameterTokens.find(token => equalsIgnoreCase(token.token.text, name));
            if (parameter) {
                return variableResult(identifier.identifierToken, "Parameter", "Function-scoped parameter");
            }
        }

        if (collectDimNames(declaration).some(local => equalsIgnoreCase(local, name))) {
            return variableResult(identifier.identifierToken, "Local variable", "Procedure-scoped variable declared with Dim");
        }

        return undefined;
    }

    function findProcedure(compilation: Compilation, name: string): ProcedureSymbol | undefined {
        return compilation.procedures[name.toLowerCase()];
    }

    function procedureResult(procedure: ProcedureSymbol | undefined, token: TokenSyntax): Result | undefined {
        if (!procedure) {
            return undefined;
        }

        const prefix = procedure.kind === ProcedureKind.Function ? "Function" : "Sub";
        const signature = procedure.kind === ProcedureKind.Function
            ? `${prefix} ${procedure.name}(${procedure.parameters.join(", ")})`
            : `${prefix} ${procedure.name}`;
        return {
            range: token.range,
            text: [signature, procedure.kind === ProcedureKind.Function ? "User-defined function" : "User-defined subroutine"]
        };
    }

    function variableResult(token: TokenSyntax, category: string, description: string): Result {
        return {
            range: token.range,
            text: [`${category} ${token.token.text}`, description]
        };
    }

    function containingProcedure(compilation: Compilation, position: CompilerPosition): FunctionDeclarationSyntax | SubModuleDeclarationSyntax | undefined {
        return [...compilation.parseTree.functions, ...compilation.parseTree.subModules]
            .find(declaration => declaration.range.containsPosition(position));
    }

    function collectDimNames(declaration: FunctionDeclarationSyntax | SubModuleDeclarationSyntax): string[] {
        const names: string[] = [];
        collectDimNamesFromNode(declaration.statementsList, names);
        return names;
    }

    function collectDimNamesFromNode(node: BaseSyntaxNode, names: string[]): void {
        if (node.kind === SyntaxKind.DimCommand) {
            (node as DimCommandSyntax).variableTokens.forEach(variable => names.push(variable.token.text));
            return;
        }

        node.children().forEach(child => collectDimNamesFromNode(child, names));
    }

    function equalsIgnoreCase(left: string, right: string): boolean {
        return left.toLowerCase() === right.toLowerCase();
    }

    class HoverVisitor extends SyntaxNodeVisitor {
        private _firstResult: Result | undefined;

        public get result(): Result | undefined {
            return this._firstResult;
        }

        private setResult(result: Result): void {
            if (!this._firstResult) {
                this._firstResult = result;
            }
        }

        public visitObjectAccessExpression(node: ObjectAccessExpressionSyntax): void {
            if (node.baseExpression.kind !== SyntaxKind.IdentifierExpression) {
                return;
            }

            const libraryNameText = (node.baseExpression as IdentifierExpressionSyntax).identifierToken.token.text;
            const libraryName = CompilerUtils.findKeyIgnoreCase(RuntimeLibraries.Metadata, libraryNameText);
            const library = libraryName === undefined ? undefined : RuntimeLibraries.Metadata[libraryName];
            if (!library) {
                return;
            }

            const memberNameText = node.identifierToken.token.text;
            const methodKey = CompilerUtils.findKeyIgnoreCase(library.methods, memberNameText);
            const propertyKey = methodKey === undefined ? CompilerUtils.findKeyIgnoreCase(library.properties, memberNameText) : undefined;
            const eventKey = methodKey === undefined && propertyKey === undefined
                ? CompilerUtils.findKeyIgnoreCase(library.events, memberNameText)
                : undefined;
            const memberName = methodKey !== undefined ? methodKey : propertyKey ?? eventKey;

            const text: string[] = [];
            if (methodKey !== undefined) {
                const method = library.methods[methodKey];
                // Signatures are spelled like the official documentation:
                // Library.Method(parameter, ...), followed by the parameter docs.
                text.push(`${libraryName}.${memberName}(${method.displayParameterNames.join(", ")})`);
                text.push(method.description);
                method.parameters.forEach((parameter, index) => {
                    const displayName = method.displayParameterNames[index];
                    text.push(`- **${displayName}**: ${method.parameterDescription(parameter)}`);
                });
            } else if (propertyKey !== undefined) {
                text.push(`${libraryName}.${memberName}`, library.properties[propertyKey].description);
            } else if (eventKey !== undefined) {
                text.push(`${libraryName}.${memberName}`, library.events[eventKey].description);
            } else {
                return;
            }

            this.setResult({
                range: node.range,
                text
            });
        }
    }
}
