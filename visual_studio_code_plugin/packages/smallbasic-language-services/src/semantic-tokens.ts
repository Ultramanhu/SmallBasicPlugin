import {
  Compilation,
  CompilerPosition,
  CompilerUtils,
  RuntimeLibraries,
  SyntaxKind,
  TokenKind,
  type BinaryOperatorExpressionSyntax,
  type FunctionDeclarationSyntax,
  type ObjectAccessExpressionSyntax,
  type SubModuleDeclarationSyntax
} from "smallbasic-lang-core";
import type { LanguageSemanticToken, LanguageSemanticTokenType } from "./protocol";

export const semanticTokenTypes: readonly LanguageSemanticTokenType[] = [
  "keyword",
  "comment",
  "string",
  "number",
  "class",
  "function",
  "parameter",
  "variable"
] as const;

const mainModuleName = "<Main>";

const keywordKinds = new Set<TokenKind>([
  TokenKind.IfKeyword,
  TokenKind.ThenKeyword,
  TokenKind.ElseKeyword,
  TokenKind.ElseIfKeyword,
  TokenKind.EndIfKeyword,
  TokenKind.ForKeyword,
  TokenKind.ToKeyword,
  TokenKind.StepKeyword,
  TokenKind.EndForKeyword,
  TokenKind.GoToKeyword,
  TokenKind.WhileKeyword,
  TokenKind.EndWhileKeyword,
  TokenKind.BreakKeyword,
  TokenKind.ContinueKeyword,
  TokenKind.SubKeyword,
  TokenKind.EndSubKeyword,
  TokenKind.FunctionKeyword,
  TokenKind.EndFunctionKeyword,
  TokenKind.DimKeyword,
  TokenKind.ReturnKeyword,
  TokenKind.And,
  TokenKind.Or
]);

export function provideSemanticTokens(compilation: Compilation): LanguageSemanticToken[] {
  const tokens: LanguageSemanticToken[] = [];

  for (const token of compilation.tokens) {
    const type = mapTokenType(compilation, token.kind, token.text, token.range.start);
    if (!type) {
      continue;
    }

    tokens.push({
      line: token.range.start.line,
      column: token.range.start.column,
      length: Math.max(1, token.text.length),
      type,
      modifiers: 0
    });
  }

  return tokens;
}

function mapTokenType(compilation: Compilation, kind: TokenKind, text: string, position: CompilerPosition): LanguageSemanticTokenType | undefined {
  if (keywordKinds.has(kind)) {
    return "keyword";
  }

  if (kind === TokenKind.Mod) {
    const binaryExpression = compilation.getSyntaxNode(position, SyntaxKind.BinaryOperatorExpression) as BinaryOperatorExpressionSyntax | undefined;
    if (binaryExpression?.operatorToken.token.kind === TokenKind.Mod
      && binaryExpression.operatorToken.range.containsPosition(position)) {
      return "keyword";
    }

    const memberAccess = compilation.getSyntaxNode(position, SyntaxKind.ObjectAccessExpression) as ObjectAccessExpressionSyntax | undefined;
    if (memberAccess?.identifierToken.token.kind === TokenKind.Mod
      && memberAccess.identifierToken.range.containsPosition(position)) {
      return "function";
    }
  }

  switch (kind) {
    case TokenKind.Comment:
      return "comment";
    case TokenKind.StringLiteral:
      return "string";
    case TokenKind.NumberLiteral:
      return "number";
    case TokenKind.Identifier:
      if (CompilerUtils.lookupIgnoreCase(RuntimeLibraries.Metadata, text) !== undefined) {
        return "class";
      }
      if (CompilerUtils.lookupIgnoreCase(compilation.procedures, text) !== undefined) {
        return "function";
      }
      if (isParameterOrLocal(compilation, text, position)) {
        return "parameter";
      }
      return "variable";
    default:
      return undefined;
  }
}

/**
 * Reports whether the identifier at `position` names a procedure parameter, a
 * procedure-level `Dim` local, or a `Dim`-declared global. Parameters and `Dim`
 * variables share the local-variable color so that declarations and their
 * usages are consistently highlighted.
 */
function isParameterOrLocal(compilation: Compilation, text: string, position: CompilerPosition): boolean {
  const lowered = text.toLowerCase();

  for (const subModule of compilation.parseTree.subModules as ReadonlyArray<SubModuleDeclarationSyntax>) {
    if (subModule.range.containsPosition(position)
      && moduleDeclaresName(compilation, subModule.subCommand.nameToken.token.text, lowered)) {
      return true;
    }
  }

  for (const func of compilation.parseTree.functions as ReadonlyArray<FunctionDeclarationSyntax>) {
    if (func.range.containsPosition(position)
      && moduleDeclaresName(compilation, func.functionCommand.nameToken.token.text, lowered)) {
      return true;
    }
  }

  const mainMetadata = CompilerUtils.lookupIgnoreCase(compilation.moduleMetadata, mainModuleName);
  return mainMetadata !== undefined && containsName(mainMetadata.globals, lowered);
}

function moduleDeclaresName(compilation: Compilation, moduleName: string, lowered: string): boolean {
  const metadata = CompilerUtils.lookupIgnoreCase(compilation.moduleMetadata, moduleName);
  return metadata !== undefined
    && (containsName(metadata.parameters, lowered) || containsName(metadata.locals, lowered));
}

function containsName(names: ReadonlyArray<string>, lowered: string): boolean {
  return names.some((name) => name.toLowerCase() === lowered);
}
