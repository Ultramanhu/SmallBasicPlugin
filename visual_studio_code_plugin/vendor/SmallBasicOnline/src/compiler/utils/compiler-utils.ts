import { SyntaxKind } from "../syntax/syntax-nodes";
import { TokenKind } from "../syntax/tokens";
import { CompilerResources } from "../../strings/compiler";

export module CompilerUtils {
    export function formatString(template: string, args: ReadonlyArray<string>): string {
        return template.replace(/{[0-9]+}/g, match => args[parseInt(match.replace(/^{/, "").replace(/}$/, ""))]);
    }

    export function stringStartsWith(value: string, prefix?: string): boolean {
        if (!prefix || !prefix.length) {
            return true;
        }

        value = value.toLowerCase();
        prefix = prefix.toLowerCase();

        return value.length >= prefix.length && value.substr(0, prefix.length) === prefix;
    }

    export function findKeyIgnoreCase<T>(parent: { [key: string]: T }, name: string): string | undefined {
        if (Object.prototype.hasOwnProperty.call(parent, name)) {
            return name;
        }

        const lower = name.toLowerCase();
        for (const key of Object.keys(parent)) {
            if (key.toLowerCase() === lower) {
                return key;
            }
        }

        return undefined;
    }

    export function lookupIgnoreCase<T>(parent: { [key: string]: T }, name: string): T | undefined {
        const key = findKeyIgnoreCase(parent, name);
        return key === undefined ? undefined : parent[key];
    }

    export function values<TMember>(parent: { [key: string]: TMember }): ReadonlyArray<TMember> {
        return Object.keys(parent).map(key => parent[key]);
    }

    export function commandToDisplayString(kind: SyntaxKind): string {
        switch (kind) {
            case SyntaxKind.IfCommand: return tokenToDisplayString(TokenKind.IfKeyword);
            case SyntaxKind.ElseCommand: return tokenToDisplayString(TokenKind.ElseKeyword);
            case SyntaxKind.ElseIfCommand: return tokenToDisplayString(TokenKind.ElseIfKeyword);
            case SyntaxKind.EndIfCommand: return tokenToDisplayString(TokenKind.EndIfKeyword);
            case SyntaxKind.ForCommand: return tokenToDisplayString(TokenKind.ForKeyword);
            case SyntaxKind.EndForCommand: return tokenToDisplayString(TokenKind.EndForKeyword);
            case SyntaxKind.WhileCommand: return tokenToDisplayString(TokenKind.WhileKeyword);
            case SyntaxKind.EndWhileCommand: return tokenToDisplayString(TokenKind.EndWhileKeyword);
            case SyntaxKind.BreakCommand: return tokenToDisplayString(TokenKind.BreakKeyword);
            case SyntaxKind.ContinueCommand: return tokenToDisplayString(TokenKind.ContinueKeyword);
            case SyntaxKind.LabelCommand: return CompilerResources.SyntaxNodes_Label;
            case SyntaxKind.GoToCommand: return tokenToDisplayString(TokenKind.GoToKeyword);
            case SyntaxKind.GoSubCommand: return tokenToDisplayString(TokenKind.GoSubKeyword);
            case SyntaxKind.OnErrorCommand: return "On Error";
            case SyntaxKind.SubCommand: return tokenToDisplayString(TokenKind.SubKeyword);
            case SyntaxKind.EndSubCommand: return tokenToDisplayString(TokenKind.EndSubKeyword);
            case SyntaxKind.FunctionCommand: return tokenToDisplayString(TokenKind.FunctionKeyword);
            case SyntaxKind.EndFunctionCommand: return tokenToDisplayString(TokenKind.EndFunctionKeyword);
            case SyntaxKind.DimCommand: return tokenToDisplayString(TokenKind.DimKeyword);
            case SyntaxKind.ReturnCommand: return tokenToDisplayString(TokenKind.ReturnKeyword);
            case SyntaxKind.ExpressionCommand: return CompilerResources.SyntaxNodes_Expression;
            default: throw new Error(`Unexpected syntax kind: ${SyntaxKind[kind]}`);
        }
    }

    export function tokenToDisplayString(kind: TokenKind): string {
        switch (kind) {
            case TokenKind.IfKeyword: return "If";
            case TokenKind.ThenKeyword: return "Then";
            case TokenKind.ElseKeyword: return "Else";
            case TokenKind.ElseIfKeyword: return "ElseIf";
            case TokenKind.EndIfKeyword: return "EndIf";
            case TokenKind.ForKeyword: return "For";
            case TokenKind.ToKeyword: return "To";
            case TokenKind.StepKeyword: return "Step";
            case TokenKind.EndForKeyword: return "EndFor";
            case TokenKind.GoToKeyword: return "GoTo";
            case TokenKind.GoSubKeyword: return "GoSub";
            case TokenKind.WhileKeyword: return "While";
            case TokenKind.EndWhileKeyword: return "EndWhile";
            case TokenKind.BreakKeyword: return "Break";
            case TokenKind.ContinueKeyword: return "Continue";
            case TokenKind.SubKeyword: return "Sub";
            case TokenKind.EndSubKeyword: return "EndSub";
            case TokenKind.FunctionKeyword: return "Function";
            case TokenKind.EndFunctionKeyword: return "EndFunction";
            case TokenKind.DimKeyword: return "Dim";
            case TokenKind.ReturnKeyword: return "Return";

            case TokenKind.Dot: return ".";
            case TokenKind.RightParen: return ")";
            case TokenKind.LeftParen: return "(";
            case TokenKind.RightSquareBracket: return "]";
            case TokenKind.LeftSquareBracket: return "[";
            case TokenKind.Comma: return ",";
            case TokenKind.Equal: return "=";
            case TokenKind.NotEqual: return "<>";
            case TokenKind.Plus: return "+";
            case TokenKind.Minus: return "-";
            case TokenKind.Multiply: return "*";
            case TokenKind.Divide: return "/";
            case TokenKind.Backslash: return "\\";
            case TokenKind.Colon: return ":";
            case TokenKind.LessThan: return "<";
            case TokenKind.GreaterThan: return ">";
            case TokenKind.LessThanOrEqual: return "<=";
            case TokenKind.GreaterThanOrEqual: return ">=";
            case TokenKind.Or: return "Or";
            case TokenKind.And: return "And";
            case TokenKind.Mod: return "Mod";

            case TokenKind.Identifier: return CompilerResources.SyntaxNodes_Identifier;
            case TokenKind.NumberLiteral: return CompilerResources.SyntaxNodes_NumberLiteral;
            case TokenKind.StringLiteral: return CompilerResources.SyntaxNodes_StringLiteral;
            case TokenKind.Comment: return CompilerResources.SyntaxNodes_Comment;

            default: throw new Error(`Unrecognized token kind: ${TokenKind[kind]}`);
        }
    }
}
