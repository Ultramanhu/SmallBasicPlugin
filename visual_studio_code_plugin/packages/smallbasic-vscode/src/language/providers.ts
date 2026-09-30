import * as vscode from "vscode";
import {
  Compilation,
  CompilerPosition,
  CompilerRange,
  CompilerUtils,
  CompletionService,
  Diagnostic,
  HoverService,
  RuntimeLibraries,
  TokenKind
} from "smallbasic-lang-core";
import { CompilationCache } from "./compilation-cache";
import { getCompletionSpan } from "./completion-span";
import { getContextualCompletions, type RankedCompletion } from "./contextual-completions";
import { collectOutlineSymbols, type OutlineSymbol } from "./document-symbols";
import { provideLibrarySignatureHelp } from "./signature-help";
import { toCompilerPosition, toVsCodeRange } from "../util/positions";

const semanticTokenTypes = [
  "keyword",
  "comment",
  "string",
  "number",
  "class",
  "function",
  "variable"
] as const;

const legend = new vscode.SemanticTokensLegend([...semanticTokenTypes]);
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
  TokenKind.SubKeyword,
  TokenKind.EndSubKeyword,
  TokenKind.And,
  TokenKind.Or
]);

export function isSmallBasicDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "smallbasic";
}

// Letters (plus underscore and dot) are registered as trigger characters so the
// suggest widget opens automatically while typing identifiers and keywords,
// not only after a dot.
const completionTriggerCharacters = [
  ".",
  ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index)),
  ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
  "_"
];

function mapCompletionKind(kind: CompletionService.ResultKind): vscode.CompletionItemKind {
  switch (kind) {
    case CompletionService.ResultKind.Class:
      return vscode.CompletionItemKind.Class;
    case CompletionService.ResultKind.Method:
      return vscode.CompletionItemKind.Method;
    case CompletionService.ResultKind.Snippet:
      return vscode.CompletionItemKind.Snippet;
    case CompletionService.ResultKind.Event:
      return vscode.CompletionItemKind.Event;
    default:
      return vscode.CompletionItemKind.Property;
  }
}

let lazyEmptyCompilation: Compilation | undefined;

function emptyCompilation(): Compilation {
  if (!lazyEmptyCompilation) {
    lazyEmptyCompilation = new Compilation("");
  }

  return lazyEmptyCompilation;
}

function baselineCompletions(): CompletionService.Result[] {
  return CompletionService.provideCompletion(emptyCompilation(), new CompilerPosition(0, 0));
}

export function registerLanguageFeatures(
    context: vscode.ExtensionContext,
    cache: CompilationCache,
    diagnostics: vscode.DiagnosticCollection
): void {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: "smallbasic" },
            {
                provideCompletionItems(document, position) {
                    const compilation = cache.get(document);
                    const lineText = document.lineAt(position.line).text;
                    const span = getCompletionSpan(lineText, position.character);
                    const prefix = lineText.slice(span.start, position.character);
                    const results = CompletionService.provideCompletion(compilation, toCompilerPosition(position));
                    const sourceBeforeCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
                    const isMemberAccess = span.start > 0 && lineText[span.start - 1] === ".";
                    const contextual = isMemberAccess ? [] : getContextualCompletions(sourceBeforeCursor, prefix);
                    const baseline = results.length === 0 && prefix.length === 0
                      ? baselineCompletions().map((item) => ({ item, priority: 20 } satisfies RankedCompletion))
                      : [];
                    const combined = dedupeCompletions([...contextual, ...results.map((item) => ({ item, priority: 10 } satisfies RankedCompletion)), ...baseline]);
                    const replacing = new vscode.Range(position.line, span.start, position.line, span.end);
                    // VS Code requires both ranges to contain the caret.  A zero-width
                    // inserting range at the start of an existing prefix is rejected and
                    // makes completion look intermittent while typing.
                    const inserting = new vscode.Range(new vscode.Position(position.line, span.start), position);

                    return new vscode.CompletionList(
                        combined.map(({ item, priority, preselect }) => {
                            const kind = mapCompletionKind(item.kind);
                            // Methods are displayed with their parameter names,
                            // e.g. `GetRandomNumber(maxNumber)` or `Show()`, like
                            // signatures in other languages. Filtering and sorting
                            // keep using the bare name so the typed prefix matches.
                            const label = item.parameters !== undefined
                                ? `${item.title}(${item.parameters.join(", ")})`
                                : item.title;
                            const completion = new vscode.CompletionItem(label, kind);
                            completion.detail = item.description;
                            completion.filterText = item.title;
                            completion.range = { inserting, replacing };
                            completion.sortText = `${priority.toString().padStart(2, "0")}_${item.title}`;
                            completion.preselect = !!preselect;
                            if (item.parameterDescriptions !== undefined && item.parameterDescriptions.length > 0) {
                                // The suggest details pane shows `documentation` under
                                // the description, so the parameter docs reach parity
                                // with hover.
                                const documentation = new vscode.MarkdownString(
                                    item.parameters!.map((parameter, index) =>
                                        `- **${parameter}**: ${item.parameterDescriptions![index]}`
                                    ).join("\n")
                                );
                                completion.documentation = documentation;
                            }
                            if (item.insertText !== undefined) {
                                completion.insertText = new vscode.SnippetString(item.insertText);
                            } else {
                                completion.insertText = item.title;
                            }
                            return completion;
                        }),
                        false
                    );
                }
            },
            ...completionTriggerCharacters
        ),
    vscode.languages.registerDocumentSymbolProvider({ language: "smallbasic" }, {
      provideDocumentSymbols(document) {
        return toDocumentSymbols(collectOutlineSymbols(cache.get(document)));
      }
    }),
    vscode.languages.registerHoverProvider({ language: "smallbasic" }, {
      provideHover(document, position) {
        const compilation = cache.get(document);
        const hover = HoverService.provideHover(compilation, toCompilerPosition(position));
        if (!hover) {
          return undefined;
        }

        return new vscode.Hover(
          hover.text.map((line) => new vscode.MarkdownString(line)),
          toVsCodeRange(hover.range)
        );
      }
    }),
    vscode.languages.registerSignatureHelpProvider(
      { language: "smallbasic" },
      {
        provideSignatureHelp(document, position) {
          return provideLibrarySignatureHelp(document, position);
        }
      },
      "(",
      ","
    ),
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "smallbasic" },
      {
        provideDocumentSemanticTokens(document) {
          const compilation = cache.get(document);
          const builder = new vscode.SemanticTokensBuilder(legend);

          for (const token of compilation.tokens) {
            const tokenType = mapTokenType(compilation, token.kind, token.text);
            if (tokenType === undefined) {
              continue;
            }

            builder.push(
              token.range.start.line,
              token.range.start.column,
              Math.max(1, token.text.length),
              tokenType,
              0
            );
          }

          return builder.build();
        }
      },
      legend
    )
  );

  context.subscriptions.push(diagnostics);
}

function toDocumentSymbols(symbols: OutlineSymbol[]): vscode.DocumentSymbol[] {
  return symbols.map((symbol) => {
    const children = toDocumentSymbols(symbol.children);
    // VS Code requires a parent range to contain its selection range and all of
    // its children, so the reported range is widened defensively.
    const range = CompilerRange.spanning([
      symbol.range,
      symbol.selectionRange,
      ...symbol.children.map((child) => child.range)
    ]);
    const documentSymbol = new vscode.DocumentSymbol(
      symbol.name,
      symbol.kind === "sub" ? "Sub" : "Variable",
      symbol.kind === "sub" ? vscode.SymbolKind.Function : vscode.SymbolKind.Variable,
      toVsCodeRange(range),
      toVsCodeRange(symbol.selectionRange)
    );

    documentSymbol.children = children;
    return documentSymbol;
  });
}

export function publishDiagnostics(
  document: vscode.TextDocument,
  cache: CompilationCache,
  diagnostics: vscode.DiagnosticCollection
): void {
  if (!isSmallBasicDocument(document)) {
    return;
  }

  const compilation = cache.get(document);
  diagnostics.set(
    document.uri,
    compilation.diagnostics.map((diagnostic) => toVsCodeDiagnostic(diagnostic))
  );
}

function toVsCodeDiagnostic(diagnostic: Diagnostic): vscode.Diagnostic {
  return new vscode.Diagnostic(
    toVsCodeRange(diagnostic.range),
    diagnostic.toString(),
    vscode.DiagnosticSeverity.Error
  );
}

function mapTokenType(compilation: Compilation, kind: TokenKind, text: string): number | undefined {
  if (keywordKinds.has(kind)) {
    return semanticTokenTypes.indexOf("keyword");
  }

  switch (kind) {
    case TokenKind.Comment:
      return semanticTokenTypes.indexOf("comment");
    case TokenKind.StringLiteral:
      return semanticTokenTypes.indexOf("string");
    case TokenKind.NumberLiteral:
      return semanticTokenTypes.indexOf("number");
    case TokenKind.Identifier:
      if (CompilerUtils.lookupIgnoreCase(RuntimeLibraries.Metadata, text) !== undefined) {
        return semanticTokenTypes.indexOf("class");
      }
      if (CompilerUtils.lookupIgnoreCase(compilation.boundSubModules, text) !== undefined) {
        return semanticTokenTypes.indexOf("function");
      }
      return semanticTokenTypes.indexOf("variable");
    default:
      return undefined;
  }
}

function dedupeCompletions(items: RankedCompletion[]): RankedCompletion[] {
  const seen = new Set<string>();
  const deduped: RankedCompletion[] = [];

  for (const item of items) {
    const key = item.item.title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

