import {
  CompilerRange,
  CompilerUtils,
  RuntimeLibraries,
  SyntaxKind,
  type BaseSyntaxNode,
  type Compilation,
  type ForCommandSyntax,
  type IdentifierExpressionSyntax,
  type InvocationExpressionSyntax,
  type SubModuleDeclarationSyntax,
  type TokenSyntax
} from "smallbasic-lang-core";
import type { LanguagePosition, LanguageRange } from "./protocol";
import { toCompilerPosition, toLanguageRange } from "./ranges";

type IdentifierRole = "subDeclaration" | "subInvocation" | "variable";

interface IdentifierToken {
  readonly name: string;
  readonly range: CompilerRange;
  readonly role: IdentifierRole;
}

function isLibraryName(name: string): boolean {
  return CompilerUtils.lookupIgnoreCase(RuntimeLibraries.Metadata, name) !== undefined;
}

/**
 * Collects every user-navigable identifier in the parse tree. Object access
 * property names (e.g. `TextWindow`) are plain tokens and are skipped, while a
 * call target (`Greet()`) is classified as a sub invocation instead of a
 * variable use so that definitions and references can follow procedures.
 * Library objects are excluded to match the outline's symbol visibility.
 */
function collectIdentifierTokens(compilation: Compilation): IdentifierToken[] {
  const tokens: IdentifierToken[] = [];

  for (const subModule of compilation.parseTree.subModules) {
    const nameToken = (subModule as SubModuleDeclarationSyntax).subCommand.nameToken;
    tokens.push({
      name: nameToken.token.text,
      range: nameToken.range,
      role: "subDeclaration"
    });
  }

  const pushVariable = (identifier: TokenSyntax): void => {
    if (!isLibraryName(identifier.token.text)) {
      tokens.push({ name: identifier.token.text, range: identifier.range, role: "variable" });
    }
  };

  const visit = (node: BaseSyntaxNode): void => {
    if (node.kind === SyntaxKind.InvocationExpression) {
      const invocation = node as InvocationExpressionSyntax;
      if (invocation.baseExpression.kind === SyntaxKind.IdentifierExpression) {
        const identifier = (invocation.baseExpression as IdentifierExpressionSyntax).identifierToken;
        if (!isLibraryName(identifier.token.text)) {
          tokens.push({ name: identifier.token.text, range: identifier.range, role: "subInvocation" });
        }
      }

      for (const argument of invocation.argumentsList) {
        visit(argument);
      }

      return;
    }

    if (node.kind === SyntaxKind.IdentifierExpression) {
      pushVariable((node as IdentifierExpressionSyntax).identifierToken);
    } else if (node.kind === SyntaxKind.ForCommand) {
      pushVariable((node as ForCommandSyntax).identifierToken);
    }

    for (const child of node.children()) {
      visit(child);
    }
  };

  visit(compilation.parseTree.mainModule);
  for (const subModule of compilation.parseTree.subModules) {
    visit((subModule as SubModuleDeclarationSyntax).statementsList);
  }

  return tokens;
}

function findIdentifierToken(tokens: readonly IdentifierToken[], position: LanguagePosition): IdentifierToken | undefined {
  const compilerPosition = toCompilerPosition(position);
  return tokens.find((token) => token.range.containsPosition(compilerPosition));
}

function hasSubDeclaration(tokens: readonly IdentifierToken[], name: string): boolean {
  const lowered = name.toLowerCase();
  return tokens.some((token) => token.role === "subDeclaration" && token.name.toLowerCase() === lowered);
}

/**
 * Resolves the definition of the identifier at the position: the `Sub`
 * declaration for procedure names and invocations, or the first (earliest)
 * occurrence for variables, which Small Basic declares implicitly and keeps
 * file-scoped.
 */
export function provideDefinition(compilation: Compilation, position: LanguagePosition): LanguageRange | undefined {
  const tokens = collectIdentifierTokens(compilation);
  const token = findIdentifierToken(tokens, position);
  if (!token) {
    return undefined;
  }

  if (token.role === "variable") {
    const lowered = token.name.toLowerCase();
    const firstUse = tokens
      .filter((candidate) => candidate.role === "variable" && candidate.name.toLowerCase() === lowered)
      .reduce<IdentifierToken | undefined>((earliest, candidate) =>
        earliest === undefined || candidate.range.start.before(earliest.range.start) ? candidate : earliest, undefined);
    return firstUse ? toLanguageRange(firstUse.range) : undefined;
  }

  const lowered = token.name.toLowerCase();
  const declaration = tokens.find((candidate) => candidate.role === "subDeclaration" && candidate.name.toLowerCase() === lowered);
  return declaration ? toLanguageRange(declaration.range) : undefined;
}

/**
 * Finds all occurrences of the identifier at the position. Procedure names
 * match their declaration and call sites; variable names match every variable
 * use (Small Basic variables are file-scoped). Occurrences are returned in
 * document order, including the declaration.
 */
export function provideReferences(compilation: Compilation, position: LanguagePosition): LanguageRange[] {
  const tokens = collectIdentifierTokens(compilation);
  const token = findIdentifierToken(tokens, position);
  if (!token) {
    return [];
  }

  const lowered = token.name.toLowerCase();
  const isSub = hasSubDeclaration(tokens, token.name);
  return tokens
    .filter((candidate) =>
      candidate.name.toLowerCase() === lowered
      && (isSub ? candidate.role !== "variable" : candidate.role === "variable"))
    .map((candidate) => candidate.range)
    .sort((left, right) => (left.start.before(right.start) ? -1 : right.start.before(left.start) ? 1 : 0))
    .map((range) => toLanguageRange(range));
}
