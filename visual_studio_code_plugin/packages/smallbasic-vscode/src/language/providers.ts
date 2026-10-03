import * as vscode from "vscode";
import {
  Compilation,
  CompilerRange
} from "smallbasic-lang-core";
import {
  collectOutlineSymbols,
  provideCompletionItems,
  provideDiagnostics,
  provideHoverInfo,
  provideSemanticTokens,
  semanticTokenTypes,
  toDocumentSymbols as toSharedDocumentSymbols,
  type LanguageCompletionKind,
  type LanguageDiagnostic,
  type LanguageDocumentSymbol,
  type LanguageRange
} from "smallbasic-language-services";
import { CompilationCache } from "./compilation-cache";
import { provideLibrarySignatureHelp } from "./signature-help";
import { toVsCodeRange } from "../util/positions";

const legend = new vscode.SemanticTokensLegend([...semanticTokenTypes]);

export function isSmallBasicDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "smallbasic";
}

function mapCompletionKind(kind: LanguageCompletionKind): vscode.CompletionItemKind {
  switch (kind) {
    case "class":
      return vscode.CompletionItemKind.Class;
    case "method":
      return vscode.CompletionItemKind.Method;
    case "snippet":
      return vscode.CompletionItemKind.Snippet;
    case "event":
      return vscode.CompletionItemKind.Event;
    default:
      return vscode.CompletionItemKind.Property;
  }
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
                    const completions = provideCompletionItems({
                      source: document.getText(),
                      lineText: document.lineAt(position.line).text,
                      position: { line: position.line, column: position.character },
                      compilation
                    });

                    return new vscode.CompletionList(
                        completions.items.map((item) => {
                            const completion = new vscode.CompletionItem(item.label, mapCompletionKind(item.kind));
                            completion.detail = item.detail;
                            completion.filterText = item.filterText;
                            completion.range = {
                              inserting: toVsCodeRangeFromDto(item.ranges.inserting),
                              replacing: toVsCodeRangeFromDto(item.ranges.replacing)
                            };
                            completion.sortText = item.sortText;
                            completion.preselect = item.preselect;
                            if (item.documentation) {
                                completion.documentation = new vscode.MarkdownString(item.documentation);
                            }
                            if (item.insertTextIsSnippet) {
                                completion.insertText = new vscode.SnippetString(item.insertText);
                            } else {
                                completion.insertText = item.insertText;
                            }
                            return completion;
                        }),
                        false
                    );
                }
            },
            "."
        ),
    vscode.languages.registerDocumentSymbolProvider({ language: "smallbasic" }, {
      provideDocumentSymbols(document) {
        return toVsCodeDocumentSymbols(toSharedDocumentSymbols(collectOutlineSymbols(cache.get(document))));
      }
    }),
    vscode.languages.registerHoverProvider({ language: "smallbasic" }, {
      provideHover(document, position) {
        const compilation = cache.get(document);
        const hover = provideHoverInfo(compilation, { line: position.line, column: position.character });
        if (!hover) {
          return undefined;
        }

        return new vscode.Hover(
          hover.contents.map((line) => new vscode.MarkdownString(line)),
          toVsCodeRangeFromDto(hover.range)
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
          const builder = new vscode.SemanticTokensBuilder(legend);

          for (const token of provideSemanticTokens(cache.get(document))) {
            builder.push(
              token.line,
              token.column,
              token.length,
              semanticTokenTypes.indexOf(token.type),
              token.modifiers
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

function toVsCodeDocumentSymbols(symbols: readonly LanguageDocumentSymbol[]): vscode.DocumentSymbol[] {
  return symbols.map((symbol) => {
    const children = toVsCodeDocumentSymbols(symbol.children);
    const documentSymbol = new vscode.DocumentSymbol(
      symbol.name,
      symbol.detail,
      symbol.kind === "sub" || symbol.kind === "function" ? vscode.SymbolKind.Function : vscode.SymbolKind.Variable,
      toVsCodeRangeFromDto(symbol.range),
      toVsCodeRangeFromDto(symbol.selectionRange)
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
    provideDiagnostics(compilation).map((diagnostic) => toVsCodeDiagnostic(diagnostic))
  );
}

function toVsCodeDiagnostic(diagnostic: LanguageDiagnostic): vscode.Diagnostic {
  return new vscode.Diagnostic(
    toVsCodeRangeFromDto(diagnostic.range),
    diagnostic.message,
    vscode.DiagnosticSeverity.Error
  );
}

function toVsCodeRangeFromDto(range: LanguageRange): vscode.Range {
  return new vscode.Range(range.start.line, range.start.column, range.end.line, range.end.column);
}

