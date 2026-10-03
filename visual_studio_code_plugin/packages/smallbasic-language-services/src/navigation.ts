import {
  CompilerRange,
  CompilerUtils,
  RuntimeLibraries,
  SyntaxKind,
  type BaseSyntaxNode,
  type Compilation,
  type DimCommandSyntax,
  type ForCommandSyntax,
  type FunctionDeclarationSyntax,
  type IdentifierExpressionSyntax,
  type InvocationExpressionSyntax,
  type SubModuleDeclarationSyntax,
  type TokenSyntax
} from "smallbasic-lang-core";
import type { LanguagePosition, LanguageRange } from "./protocol";
import { toCompilerPosition, toLanguageRange } from "./ranges";

type IdentifierRole = "procedureDeclaration" | "procedureInvocation" | "variable";

interface IdentifierToken {
  readonly name: string;
  readonly range: CompilerRange;
  readonly role: IdentifierRole;
  /** Procedure name for locals/parameters, or `<Main>` for global variables. */
  readonly scope: string;
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
  const mainScope = "<Main>";

  for (const subModule of compilation.parseTree.subModules) {
    const nameToken = (subModule as SubModuleDeclarationSyntax).subCommand.nameToken;
    tokens.push({
      name: nameToken.token.text,
      range: nameToken.range,
      role: "procedureDeclaration",
      scope: mainScope
    });
  }

  for (const func of compilation.parseTree.functions) {
    const nameToken = (func as FunctionDeclarationSyntax).functionCommand.nameToken;
    tokens.push({
      name: nameToken.token.text,
      range: nameToken.range,
      role: "procedureDeclaration",
      scope: mainScope
    });
  }

  const pushVariable = (identifier: TokenSyntax, scope: string, localNames: ReadonlySet<string>): void => {
    if (!isLibraryName(identifier.token.text)) {
      const variableScope = localNames.has(identifier.token.text.toLowerCase()) ? scope : mainScope;
      tokens.push({ name: identifier.token.text, range: identifier.range, role: "variable", scope: variableScope });
    }
  };

  const visit = (node: BaseSyntaxNode, scope: string, localNames: ReadonlySet<string>): void => {
    if (node.kind === SyntaxKind.InvocationExpression) {
      const invocation = node as InvocationExpressionSyntax;
      if (invocation.baseExpression.kind === SyntaxKind.IdentifierExpression) {
        const identifier = (invocation.baseExpression as IdentifierExpressionSyntax).identifierToken;
        if (CompilerUtils.lookupIgnoreCase(compilation.procedures, identifier.token.text) !== undefined) {
          tokens.push({
            name: identifier.token.text,
            range: identifier.range,
            role: "procedureInvocation",
            scope: mainScope
          });
        } else {
          pushVariable(identifier, scope, localNames);
        }
      }

      for (const argument of invocation.argumentsList) {
        visit(argument, scope, localNames);
      }

      return;
    }

    if (node.kind === SyntaxKind.IdentifierExpression) {
      pushVariable((node as IdentifierExpressionSyntax).identifierToken, scope, localNames);
    } else if (node.kind === SyntaxKind.ForCommand) {
      pushVariable((node as ForCommandSyntax).identifierToken, scope, localNames);
    } else if (node.kind === SyntaxKind.DimCommand) {
      for (const identifier of (node as DimCommandSyntax).variableTokens) {
        pushVariable(identifier, scope, localNames);
      }
    }

    for (const child of node.children()) {
      visit(child, scope, localNames);
    }
  };

  visit(compilation.parseTree.mainModule, mainScope, new Set());
  for (const subModule of compilation.parseTree.subModules) {
    const declaration = subModule as SubModuleDeclarationSyntax;
    const scope = declaration.subCommand.nameToken.token.text;
    const metadata = CompilerUtils.lookupIgnoreCase(compilation.moduleMetadata, scope);
    const locals = new Set((metadata?.locals ?? []).map((name) => name.toLowerCase()));
    visit(declaration.statementsList, scope, locals);
  }

  for (const func of compilation.parseTree.functions) {
    const declaration = func as FunctionDeclarationSyntax;
    const scope = declaration.functionCommand.nameToken.token.text;
    const metadata = CompilerUtils.lookupIgnoreCase(compilation.moduleMetadata, scope);
    const locals = new Set([
      ...(metadata?.parameters ?? []),
      ...(metadata?.locals ?? [])
    ].map((name) => name.toLowerCase()));
    for (const parameter of declaration.functionCommand.parameterTokens) {
      pushVariable(parameter, scope, locals);
    }
    visit(declaration.statementsList, scope, locals);
  }

  return tokens;
}

function findIdentifierToken(tokens: readonly IdentifierToken[], position: LanguagePosition): IdentifierToken | undefined {
  const compilerPosition = toCompilerPosition(position);
  return tokens.find((token) => token.range.containsPosition(compilerPosition));
}

function hasProcedureDeclaration(tokens: readonly IdentifierToken[], name: string): boolean {
  const lowered = name.toLowerCase();
  return tokens.some((token) => token.role === "procedureDeclaration" && token.name.toLowerCase() === lowered);
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
      .filter((candidate) => candidate.scope.toLowerCase() === token.scope.toLowerCase())
      .reduce<IdentifierToken | undefined>((earliest, candidate) =>
        earliest === undefined || candidate.range.start.before(earliest.range.start) ? candidate : earliest, undefined);
    return firstUse ? toLanguageRange(firstUse.range) : undefined;
  }

  const lowered = token.name.toLowerCase();
  const declaration = tokens.find((candidate) => candidate.role === "procedureDeclaration" && candidate.name.toLowerCase() === lowered);
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
  const isProcedure = hasProcedureDeclaration(tokens, token.name) && token.role !== "variable";
  return tokens
    .filter((candidate) =>
      candidate.name.toLowerCase() === lowered
      && (isProcedure
        ? candidate.role !== "variable"
        : candidate.role === "variable" && candidate.scope.toLowerCase() === token.scope.toLowerCase()))
    .map((candidate) => candidate.range)
    .sort((left, right) => (left.start.before(right.start) ? -1 : right.start.before(left.start) ? 1 : 0))
    .map((range) => toLanguageRange(range));
}
