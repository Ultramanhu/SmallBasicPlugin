import { Compilation } from "../../compiler/compilation";
import { CompilerRange, CompilerPosition } from "../syntax/ranges";
import { RuntimeLibraries } from "../runtime/libraries";
import { CompilerUtils } from "../utils/compiler-utils";
import { SyntaxKind, ObjectAccessExpressionSyntax, IdentifierExpressionSyntax, SyntaxNodeVisitor } from "../syntax/syntax-nodes";

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

        const node = compilation.getSyntaxNode(position, SyntaxKind.ObjectAccessExpression);
        if (node) {
            const visitor = new HoverVisitor();
            visitor.visit(node);
            return visitor.result;
        }

        return undefined;
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
