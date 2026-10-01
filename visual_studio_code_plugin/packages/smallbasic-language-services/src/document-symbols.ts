import {
  Compilation,
  CompilerRange,
  CompilerUtils,
  RuntimeLibraries,
  SyntaxKind,
  type BaseSyntaxNode,
  type ForCommandSyntax,
  type IdentifierExpressionSyntax,
  type StatementBlockSyntax,
  type SubModuleDeclarationSyntax
} from "smallbasic-lang-core";
import type { LanguageDocumentSymbol } from "./protocol";
import { toLanguageRange } from "./ranges";

export type OutlineSymbolKind = "sub" | "variable";

export interface OutlineSymbol {
  name: string;
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
  /** Index into `parseTree.subModules`, or -1 for the main module. */
  subModuleIndex: number;
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
  const subModuleNames = new Set(Object.keys(compilation.boundSubModules).map((name) => name.toLowerCase()));
  const isExcluded = (name: string): boolean =>
    subModuleNames.has(name.toLowerCase())
    || CompilerUtils.lookupIgnoreCase(RuntimeLibraries.Metadata, name) !== undefined;

  const firstUses = new Map<string, VariableFirstUse>();
  const registerScope = (block: StatementBlockSyntax, subModuleIndex: number): void => {
    forEachVariableUse(block, isExcluded, (name, range) => {
      const key = name.toLowerCase();
      const existing = firstUses.get(key);
      if (existing === undefined || comparePositions(range.start, existing.range.start) < 0) {
        firstUses.set(key, { name, range, subModuleIndex });
      }
    });
  };

  registerScope(compilation.parseTree.mainModule, -1);
  subModules.forEach((subModule: SubModuleDeclarationSyntax, index: number) => registerScope(subModule.statementsList, index));

  const variablesByScope = new Map<number, OutlineSymbol[]>();
  for (const use of firstUses.values()) {
    const symbol: OutlineSymbol = {
      name: use.name,
      kind: "variable",
      range: use.range,
      selectionRange: use.range,
      children: []
    };

    const bucket = variablesByScope.get(use.subModuleIndex);
    if (bucket === undefined) {
      variablesByScope.set(use.subModuleIndex, [symbol]);
    } else {
      bucket.push(symbol);
    }
  }

  const procedures = subModules.map((subModule: SubModuleDeclarationSyntax, index: number): OutlineSymbol => {
    const nameToken = subModule.subCommand.nameToken;
    return {
      name: nameToken.token.text,
      kind: "sub",
      range: subModule.range,
      selectionRange: nameToken.range,
      children: sortByPosition(variablesByScope.get(index) ?? [])
    };
  });

  return sortByPosition([...(variablesByScope.get(-1) ?? []), ...procedures]);
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
      detail: symbol.kind === "sub" ? "Sub" : "Variable",
      kind: symbol.kind,
      range: toLanguageRange(range),
      selectionRange: toLanguageRange(symbol.selectionRange),
      children
    };
  });
}
