import { CompilerRange } from "./ranges";

export enum TokenKind {
    UnrecognizedToken,

    IfKeyword,
    ThenKeyword,
    ElseKeyword,
    ElseIfKeyword,
    EndIfKeyword,
    ForKeyword,
    ToKeyword,
    StepKeyword,
    EndForKeyword,
    GoToKeyword,
    WhileKeyword,
    EndWhileKeyword,
    BreakKeyword,
    ContinueKeyword,
    SubKeyword,
    EndSubKeyword,
    FunctionKeyword,
    EndFunctionKeyword,
    DimKeyword,
    ReturnKeyword,

    Dot,
    RightParen,
    LeftParen,
    RightSquareBracket,
    LeftSquareBracket,
    Comma,
    Equal,
    NotEqual,
    Plus,
    Minus,
    Multiply,
    Divide,
    Backslash,
    Colon,
    LessThan,
    GreaterThan,
    LessThanOrEqual,
    GreaterThanOrEqual,
    Or,
    And,
    Mod,

    Identifier,
    NumberLiteral,
    StringLiteral,
    Comment
}

export class Token {
    public constructor(
        public readonly text: string,
        public readonly kind: TokenKind,
        public readonly range: CompilerRange) {
    }
}
