import { RuntimeLibraries } from "../runtime/libraries";
import { CompilerPosition } from "../syntax/ranges";
import { Compilation } from "../compilation";
import { CompilerUtils } from "../utils/compiler-utils";
import { SyntaxNodeVisitor, ObjectAccessExpressionSyntax, SyntaxKind, IdentifierExpressionSyntax } from "../syntax/syntax-nodes";
import { CommandsParser } from "../syntax/command-parser";
import { DocumentationResources } from "../../strings/documentation";
import {
    BaseBoundNode,
    BoundArrayAssignmentStatement,
    BoundKind,
    BoundLibraryMethodInvocationExpression,
    BoundLibraryMethodInvocationStatement,
    BoundStringLiteralExpression,
    BoundVariableAssignmentStatement
} from "../binding/bound-nodes";

export module CompletionService {
    export enum ResultKind {
        Class,
        Method,
        Property,
        Snippet,
        Event
    }

    export interface Result {
        kind: ResultKind;
        title: string;
        description: string;
        // Parameter names formatted for display (camelCase, like the official
        // documentation). Present for methods only, empty for parameterless ones.
        parameters?: ReadonlyArray<string>;
        // Localized docs parallel to `parameters`.
        parameterDescriptions?: ReadonlyArray<string>;
        insertText?: string;
    }

    export function provideCompletion(compilation: Compilation, position: CompilerPosition): Result[] {
        const objectAccessExpression = compilation.getSyntaxNode(position, SyntaxKind.ObjectAccessExpression);
        if (objectAccessExpression) {
            const visitor = new CompletionVisitor(compilation);
            visitor.visit(objectAccessExpression);
            return visitor.results;
        }

        const identifierExpression = compilation.getSyntaxNode(position, SyntaxKind.IdentifierExpression);
        if (identifierExpression) {
            const visitor = new CompletionVisitor(compilation);
            visitor.visit(identifierExpression);
            return visitor.results;
        }

        if (!compilation.text.trim()) {
            return getResultsBeforeDot("", compilation);
        }

        // No syntax node found at the cursor position (e.g. blank line, after a
        // statement, or inside a comment). Extract the identifier word at the
        // cursor from the source text and return filtered first-level completions
        // so the suggest widget shows relevant items instead of nothing.
        const wordAtCursor = extractWordAtPosition(compilation.text, position);
        return getResultsBeforeDot(wordAtCursor, compilation);
    }

    class CompletionVisitor extends SyntaxNodeVisitor {
        private _allResults: Result[] = [];

        public constructor(private readonly compilation: Compilation) {
            super();
        }

        public get results(): Result[] {
            return this._allResults;
        }

        private addResult(result: Result): void {
            this._allResults.push(result);
        }

        public visitObjectAccessExpression(node: ObjectAccessExpressionSyntax): void {
            if (node.baseExpression.kind !== SyntaxKind.IdentifierExpression) {
                return;
            }

            const libraryName = (node.baseExpression as IdentifierExpressionSyntax).identifierToken.token.text;
            const library = CompilerUtils.lookupIgnoreCase(RuntimeLibraries.Metadata, libraryName);
            if (!library) {
                return;
            }

            let memberName = node.identifierToken.token.text;
            if (memberName === CommandsParser.MissingTokenText) {
                memberName = "";
            }

            CompilerUtils.values(library.methods).forEach(method => {
                if (CompilerUtils.stringStartsWith(method.methodName, memberName)) {
                    const parameters = method.displayParameterNames;
                    this.addResult({
                        title: method.methodName,
                        description: method.description,
                        kind: ResultKind.Method,
                        parameters,
                        parameterDescriptions: method.parameters.map((parameter) => method.parameterDescription(parameter)),
                        insertText: `${method.methodName}(${parameters.map((parameter, i) => `\${${i + 1}:${parameter}}`).join(", ")})`
                    });
                }
            });

            CompilerUtils.values(library.properties).forEach(property => {
                if (CompilerUtils.stringStartsWith(property.propertyName, memberName)) {
                    this.addResult({
                        title: property.propertyName,
                        description: property.description,
                        kind: ResultKind.Property
                    });
                }
            });

            CompilerUtils.values(library.events).forEach(event => {
                if (CompilerUtils.stringStartsWith(event.eventName, memberName)) {
                    this.addResult({
                        title: event.eventName,
                        description: event.description,
                        kind: ResultKind.Event
                    });
                }
            });
        }

        public visitIdentifierExpression(node: IdentifierExpressionSyntax): void {
            const libraryName = node.identifierToken.token.text;
            this._allResults = getResultsBeforeDot(libraryName, this.compilation);
        }
    }

    function getResultsBeforeDot(prefix: string, compilation: Compilation): Result[] {
        const results: Result[] = [];

        collectVariablesAndSubModules(compilation).forEach(name => {
            if (CompilerUtils.stringStartsWith(name, prefix)) {
                results.push({
                    title: name,
                    description: name,
                    kind: name in compilation.boundSubModules ? ResultKind.Method : ResultKind.Property
                });
            }
        });

        CompilerUtils.values(RuntimeLibraries.Metadata).forEach(library => {
            if (CompilerUtils.stringStartsWith(library.typeName, prefix)) {
                results.push({
                    title: library.typeName,
                    description: library.description,
                    kind: ResultKind.Class
                });
            }
        });

        keywordSnippets().forEach(snippet => {
            if (CompilerUtils.stringStartsWith(snippet.title, prefix)) {
                results.push(snippet);
            }
        });

        return results;
    }

    function collectVariablesAndSubModules(compilation: Compilation): string[] {
        const names: string[] = [];
        const seen = new Set<string>();

        const add = (name: string): void => {
            const key = name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                names.push(name);
            }
        };

        for (const [name, module] of Object.entries(compilation.boundSubModules)) {
            if (name !== "<Main>") {
                add(name);
            }

            visit(module, add);
        }

        return names;
    }

    function visit(node: BaseBoundNode, add: (name: string) => void): void {
        switch (node.kind) {
            case BoundKind.VariableAssignmentStatement:
                add((node as BoundVariableAssignmentStatement).variableName);
                break;
            case BoundKind.ArrayAssignmentStatement:
                add((node as BoundArrayAssignmentStatement).arrayName);
                break;
            case BoundKind.LibraryMethodInvocationStatement:
                collectArrayLibraryName(node as BoundLibraryMethodInvocationStatement, add);
                break;
            case BoundKind.LibraryMethodInvocationExpression:
                collectArrayLibraryName(node as BoundLibraryMethodInvocationExpression, add);
                break;
            default:
                break;
        }

        node.children().forEach(child => visit(child, add));
    }

    function collectArrayLibraryName(
        node: BoundLibraryMethodInvocationStatement | BoundLibraryMethodInvocationExpression,
        add: (name: string) => void
    ): void {
        if (node.libraryName.toLowerCase() !== "array") {
            return;
        }

        switch (node.methodName.toLowerCase()) {
            case "setvalue":
            case "getvalue":
            case "removevalue":
                break;
            default:
                return;
        }

        const [firstArgument] = node.argumentsList;
        if (firstArgument?.kind === BoundKind.StringLiteralExpression) {
            add((firstArgument as BoundStringLiteralExpression).value);
        }
    }

    function keywordKey(title: string): string {
        switch (title) {
            case "For Step":
                return "Keywords_Step";
            case "GoTo":
                return "Keywords_Goto";
            default:
                return `Keywords_${title}`;
        }
    }

    function snippet(title: string, insertText: string): Result {
        const description = DocumentationResources.get(keywordKey(title));
        return {
            kind: ResultKind.Snippet,
            title,
            description: typeof description === "string" ? description : title,
            insertText
        };
    }

    function keywordSnippets(): Result[] {
        return [
            snippet("If", "If ${1:condition} Then\nEndIf"),
            snippet("ElseIf", "ElseIf ${1:condition} Then"),
            snippet("Else", "Else"),
            snippet("EndIf", "EndIf"),
            snippet("GoTo", "GoTo ${1:label}"),
            snippet("While", "While ${1:condition}\nEndWhile"),
            snippet("EndWhile", "EndWhile"),
            snippet("For", "For ${1:name} = ${2:start} To ${3:end}\nEndFor"),
            snippet("For Step", "For ${1:name} = ${2:start} To ${3:end} Step ${4:increment}\nEndFor"),
            snippet("EndFor", "EndFor"),
            snippet("Sub", "Sub ${1:name}\nEndSub"),
            snippet("EndSub", "EndSub")
        ];
    }

    function extractWordAtPosition(text: string, position: CompilerPosition): string {
        const lineEnd = text.indexOf("\n", position.line > 0
            ? nthLineStart(text, position.line)
            : 0);
        const lineStart = position.line > 0 ? nthLineStart(text, position.line) : 0;
        const line = text.substring(
            lineStart,
            lineEnd === -1 ? text.length : lineEnd
        );

        const col = Math.min(position.column, line.length);
        let start = col;
        while (start > 0 && isWordChar(line.charCodeAt(start - 1))) {
            start -= 1;
        }

        return line.substring(start, col);
    }

    function nthLineStart(text: string, line: number): number {
        let pos = 0;
        for (let i = 0; i < line; i++) {
            const next = text.indexOf("\n", pos);
            if (next === -1) {
                return text.length;
            }
            pos = next + 1;
        }
        return pos;
    }

    function isWordChar(code: number): boolean {
        return (code >= 48 && code <= 57)   // 0-9
            || (code >= 65 && code <= 90)   // A-Z
            || (code >= 97 && code <= 122)  // a-z
            || code === 95;                 // _
    }
}
