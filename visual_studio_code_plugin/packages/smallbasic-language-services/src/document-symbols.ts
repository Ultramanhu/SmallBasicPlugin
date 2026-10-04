import {
  Compilation,
  CompilerRange,
  CompilerUtils,
  RuntimeLibraries,
  SyntaxKind,
  type BaseSyntaxNode,
  type DimCommandSyntax,
  type ForCommandSyntax,
  type FunctionDeclarationSyntax,
  type IdentifierExpressionSyntax,
  type StatementBlockSyntax,
  type SubModuleDeclarationSyntax
} from "smallbasic-lang-core";
import type { LanguageDocumentSymbol } from "./protocol";
import { toLanguageRange } from "./ranges";

export type OutlineSymbolKind = "sub" | "function" | "variable";

export interface OutlineSymbol {
  name: string;
  detail: string;
  kind: OutlineSymbolKind;
  /** Whole `Sub` block for procedures; the identifier for variables. */
  range: CompilerRange;
  /** Region highlighted when the outline entry is selected. */
  selectionRange: CompilerRange;
  /** Variables first used inside this procedure. Always empty for variables. */
  children: OutlineSymbol[];
}

function comparePositions(left: { line: number; column: number }, right: { line: number; column: number }): number {
  return left.line !== right.line ? left.line - right.line : left.column - right.column;
}

function sortByPosition(symbols: OutlineSymbol[]): OutlineSymbol[] {
  return symbols.sort((left, right) => comparePositions(left.range.start, right.range.start));
}

interface VariableFirstUse {
  name: string;
  range: CompilerRange;
  /** Index into the combined procedure list, or -1 for the main module. */
  scopeIndex: number;
}

/** Walks a statement block and reports every identifier that is used as a variable. */
function forEachVariableUse(
  block: StatementBlockSyntax,
  isExcluded: (name: string) => boolean,
  report: (name: string, range: CompilerRange) => void
): void {
  const visit = (node: BaseSyntaxNode): void => {
    if (node.kind === SyntaxKind.IdentifierExpression) {
      const identifier = (node as IdentifierExpressionSyntax).identifierToken;
      if (!isExcluded(identifier.token.text)) {
        report(identifier.token.text, identifier.range);
      }
    } else if (node.kind === SyntaxKind.ForCommand) {
      // `For i = ...` declares the loop variable even though it is a plain token.
      const identifier = (node as ForCommandSyntax).identifierToken;
      if (!isExcluded(identifier.token.text)) {
        report(identifier.token.text, identifier.range);
      }
    } else if (node.kind === SyntaxKind.DimCommand) {
      for (const identifier of (node as DimCommandSyntax).variableTokens) {
        if (!isExcluded(identifier.token.text)) {
          report(identifier.token.text, identifier.range);
        }
      }
    }

    for (const child of node.children()) {
      visit(child);
    }
  };

  visit(block);
}

/**
 * Builds the outline of a compiled document: procedure declarations plus the
 * first use of every variable, grouped by the scope that owns that first use.
 */
export function collectOutlineSymbols(compilation: Compilation): OutlineSymbol[] {
  const subModules = compilation.parseTree.subModules;
  const functions = compilation.parseTree.functions;
  const subModuleNames = new Set(Object.values(compilation.procedures).map((procedure) => procedure.name.toLowerCase()));
  const isExcluded = (name: string): boolean =>
    subModuleNames.has(name.toLowerCase())
    || CompilerUtils.lookupIgnoreCase(RuntimeLibraries.Metadata, name) !== undefined;

  const firstUses = new Map<string, VariableFirstUse>();
  const registerScope = (block: StatementBlockSyntax, scopeIndex: number, localNames: ReadonlySet<string> = new Set()): void => {
    forEachVariableUse(block, isExcluded, (name, range) => {
      const lowered = name.toLowerCase();
      const key = localNames.has(lowered) ? `${scopeIndex}:${lowered}` : `global:${lowered}`;
      const existing = firstUses.get(key);
      if (existing === undefined || comparePositions(range.start, existing.range.start) < 0) {
        firstUses.set(key, { name, range, scopeIndex });
      }
    });
  };

  registerScope(compilation.parseTree.mainModule, -1);
  subModules.forEach((subModule: SubModuleDeclarationSyntax, index: number) => {
    const metadata = CompilerUtils.lookupIgnoreCase(compilation.moduleMetadata, subModule.subCommand.nameToken.token.text);
    const localNames = new Set([
      ...(metadata?.parameters ?? []),
      ...(metadata?.locals ?? [])
    ].map((name) => name.toLowerCase()));
    for (const parameter of subModule.subCommand.parameterTokens) {
      const key = `${index}:${parameter.token.text.toLowerCase()}`;
      if (!firstUses.has(key)) {
        firstUses.set(key, { name: parameter.token.text, range: parameter.range, scopeIndex: index });
      }
    }
    registerScope(subModule.statementsList, index, localNames);
  });
  functions.forEach((func: FunctionDeclarationSyntax, index: number) => {
    const scopeIndex = subModules.length + index;
    const metadata = CompilerUtils.lookupIgnoreCase(compilation.moduleMetadata, func.functionCommand.nameToken.token.text);
    const localNames = new Set([
      ...(metadata?.parameters ?? []),
      ...(metadata?.locals ?? [])
    ].map((name) => name.toLowerCase()));
    for (const parameter of func.functionCommand.parameterTokens) {
      const key = `${scopeIndex}:${parameter.token.text.toLowerCase()}`;
      if (!firstUses.has(key)) {
        firstUses.set(key, { name: parameter.token.text, range: parameter.range, scopeIndex });
      }
    }
    registerScope(func.statementsList, scopeIndex, localNames);
  });

  const variablesByScope = new Map<number, OutlineSymbol[]>();
  for (const use of firstUses.values()) {
    const symbol: OutlineSymbol = {
      name: use.name,
      detail: "Variable",
      kind: "variable",
      range: use.range,
      selectionRange: use.range,
      children: []
    };

    const bucket = variablesByScope.get(use.scopeIndex);
    if (bucket === undefined) {
      variablesByScope.set(use.scopeIndex, [symbol]);
    } else {
      bucket.push(symbol);
    }
  }

  const procedures = subModules.map((subModule: SubModuleDeclarationSyntax, index: number): OutlineSymbol => {
    const nameToken = subModule.subCommand.nameToken;
    const parameters = subModule.subCommand.parameterTokens;
    return {
      name: nameToken.token.text,
      detail: parameters.length
        ? `Sub ${nameToken.token.text}(${parameters.map((parameter) => parameter.token.text).join(", ")})`
        : `Sub ${nameToken.token.text}`,
      kind: "sub",
      range: subModule.range,
      selectionRange: nameToken.range,
      children: sortByPosition(variablesByScope.get(index) ?? [])
    };
  });

  const functionSymbols = functions.map((func: FunctionDeclarationSyntax, index: number): OutlineSymbol => {
    const nameToken = func.functionCommand.nameToken;
    return {
      name: nameToken.token.text,
      detail: `Function ${nameToken.token.text}(${func.functionCommand.parameterTokens.map((parameter) => parameter.token.text).join(", ")})`,
      kind: "function",
      range: func.range,
      selectionRange: nameToken.range,
      children: sortByPosition(variablesByScope.get(subModules.length + index) ?? [])
    };
  });

  return sortByPosition([...(variablesByScope.get(-1) ?? []), ...procedures, ...functionSymbols]);
}

export function toDocumentSymbols(symbols: readonly OutlineSymbol[]): LanguageDocumentSymbol[] {
  return symbols.map((symbol) => {
    const children = toDocumentSymbols(symbol.children);
    const range = CompilerRange.spanning([
      symbol.range,
      symbol.selectionRange,
      ...symbol.children.map((child) => child.range)
    ]);

    return {
      name: symbol.name,
      detail: symbol.detail,
      kind: symbol.kind,
      range: toLanguageRange(range),
      selectionRange: toLanguageRange(symbol.selectionRange),
      children
    };
  });
}
