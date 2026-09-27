// Document outline ("大纲") for SmallBasic documents.
//
// The outline exposes two kinds of entries:
//   * every `Sub ... EndSub` procedure declaration, and
//   * every variable, shown at the position of its very first use.
//
// A variable is reported once, at its earliest occurrence in the whole document,
// and nested under the `Sub` that contains that occurrence (top level when the
// first use lives in the main module). Library names (`TextWindow`, `Math`, ...)
// and procedure names are not variables and are skipped.
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
