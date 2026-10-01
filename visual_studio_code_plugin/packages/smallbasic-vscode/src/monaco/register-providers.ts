import * as monaco from "monaco-editor";
import {
  semanticTokenTypes,
  type LanguageCompletionItem,
  type LanguageDocumentSymbol,
  type LanguageRange,
  type LanguageSemanticToken
} from "smallbasic-language-services";
import { LanguageWorkerClient } from "./language-client";
import { LANGUAGE_ID } from "./register-language";
import { getSnippetCompletionItems } from "./snippets";

export interface RegisteredProviders {
  refreshSemanticTokens(): void;
  dispose(): void;
}

export function registerSmallBasicProviders(client: LanguageWorkerClient): RegisteredProviders {
  const semanticEmitter = new monaco.Emitter<void>();
  const disposables: monaco.IDisposable[] = [
    monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
      triggerCharacters: ["."],
      async provideCompletionItems(model, position, _context, token) {
        const workerItems = await client.provideCompletions(model, position);
        if (token.isCancellationRequested) {
          return { suggestions: [] };
        }

        const snippets = getSnippetCompletionItems(model.getLineContent(position.lineNumber), position.lineNumber - 1, position.column - 1);
        return {
          suggestions: mergeCompletions([...workerItems.items, ...snippets]).map((item) => toMonacoCompletion(item))
        };
      }
    }),
    monaco.languages.registerHoverProvider(LANGUAGE_ID, {
      async provideHover(model, position, token) {
        const hover = await client.provideHover(model, position);
        if (token.isCancellationRequested || !hover) {
          return undefined;
        }

        return {
          range: toMonacoRange(hover.range),
          contents: hover.contents.map((value) => ({ value }))
        };
      }
    }),
    monaco.languages.registerSignatureHelpProvider(LANGUAGE_ID, {
      signatureHelpTriggerCharacters: ["(", ","],
      signatureHelpRetriggerCharacters: [","],
      async provideSignatureHelp(model, position, token) {
        const signature = await client.provideSignatureHelp(model, position);
        if (token.isCancellationRequested || !signature) {
          return undefined;
        }

        return {
          value: {
            signatures: signature.signatures.map((item) => ({
              label: item.label,
              documentation: item.documentation,
              parameters: item.parameters.map((parameter) => ({
                label: parameter.name,
                documentation: parameter.description
              }))
            })),
            activeSignature: signature.activeSignature,
            activeParameter: signature.activeParameter,
            dispose() {
              // Monaco requires a dispose callback on signature help results.
            }
          },
          dispose() {
            // No per-request resources to release.
          }
        };
      }
    }),
    monaco.languages.registerDocumentSymbolProvider(LANGUAGE_ID, {
      async provideDocumentSymbols(model, token) {
        const symbols = await client.provideDocumentSymbols(model);
        if (token.isCancellationRequested) {
          return [];
        }

        return symbols.map((symbol) => toMonacoDocumentSymbol(symbol));
      }
    }),
    monaco.languages.registerFoldingRangeProvider(LANGUAGE_ID, {
      async provideFoldingRanges(model, _context, token) {
        const ranges = await client.provideFoldingRanges(model);
        if (token.isCancellationRequested) {
          return [];
        }

        return ranges.map((range) => ({
          start: range.startLine + 1,
          end: range.endLine + 1,
          kind: monaco.languages.FoldingRangeKind.Region
        }));
      }
    }),
    monaco.languages.registerDefinitionProvider(LANGUAGE_ID, {
      async provideDefinition(model, position, token) {
        const definition = await client.provideDefinition(model, position);
        if (token.isCancellationRequested || !definition) {
          return undefined;
        }

        return {
          range: toMonacoRange(definition),
          uri: model.uri
        };
      }
    }),
    monaco.languages.registerReferenceProvider(LANGUAGE_ID, {
      async provideReferences(model, position, _context, token) {
        const references = await client.provideReferences(model, position);
        if (token.isCancellationRequested) {
          return [];
        }

        return references.map((reference) => ({
          range: toMonacoRange(reference),
          uri: model.uri
        }));
      }
    }),
    monaco.languages.registerDocumentSemanticTokensProvider(LANGUAGE_ID, {
      getLegend() {
        return {
          tokenTypes: [...semanticTokenTypes],
          tokenModifiers: []
        };
      },
      onDidChange: semanticEmitter.event,
      async provideDocumentSemanticTokens(model, _lastResultId, token) {
        const items = await client.provideSemanticTokens(model);
        if (token.isCancellationRequested) {
          return { data: new Uint32Array() };
        }

        return {
          data: encodeSemanticTokens(items)
        };
      },
      releaseDocumentSemanticTokens() {
        // No semantic token caches to release on the Monaco side.
      }
    })
  ];

  return {
    refreshSemanticTokens() {
      semanticEmitter.fire();
    },
    dispose() {
      semanticEmitter.dispose();
      for (const disposable of disposables) {
        disposable.dispose();
      }
    }
  };
}

function mergeCompletions(items: readonly LanguageCompletionItem[]): LanguageCompletionItem[] {
  const seen = new Set<string>();
  const merged: LanguageCompletionItem[] = [];
  for (const item of items) {
    const key = item.filterText.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(item);
  }

  return merged.sort((left, right) => left.sortText.localeCompare(right.sortText));
}

function toMonacoCompletion(item: LanguageCompletionItem): monaco.languages.CompletionItem {
  return {
    label: item.label,
    kind: toMonacoCompletionKind(item.kind),
    detail: item.detail,
    documentation: item.documentation ? { value: item.documentation } : undefined,
    filterText: item.filterText,
    sortText: item.sortText,
    preselect: item.preselect,
    insertText: item.insertText,
    insertTextRules: item.insertTextIsSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range: {
      insert: toMonacoRange(item.ranges.inserting),
      replace: toMonacoRange(item.ranges.replacing)
    }
  };
}

function toMonacoCompletionKind(kind: LanguageCompletionItem["kind"]): monaco.languages.CompletionItemKind {
  switch (kind) {
    case "class":
      return monaco.languages.CompletionItemKind.Class;
    case "method":
      return monaco.languages.CompletionItemKind.Method;
    case "snippet":
      return monaco.languages.CompletionItemKind.Snippet;
    case "event":
      return monaco.languages.CompletionItemKind.Event;
    default:
      return monaco.languages.CompletionItemKind.Property;
  }
}

function toMonacoRange(range: LanguageRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.column + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.column + 1
  };
}

function toMonacoDocumentSymbol(symbol: LanguageDocumentSymbol): monaco.languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: symbol.detail,
    kind: symbol.kind === "sub" ? monaco.languages.SymbolKind.Function : monaco.languages.SymbolKind.Variable,
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: symbol.children.map((child) => toMonacoDocumentSymbol(child)),
    tags: []
  };
}

function encodeSemanticTokens(items: readonly LanguageSemanticToken[]): Uint32Array {
  const data = new Uint32Array(items.length * 5);
  let previousLine = 0;
  let previousColumn = 0;

  items.forEach((item, index) => {
    const offset = index * 5;
    const deltaLine = item.line - previousLine;
    const deltaStart = deltaLine === 0 ? item.column - previousColumn : item.column;
    data[offset] = deltaLine;
    data[offset + 1] = deltaStart;
    data[offset + 2] = item.length;
    data[offset + 3] = semanticTokenTypes.indexOf(item.type);
    data[offset + 4] = item.modifiers;
    previousLine = item.line;
    previousColumn = item.column;
  });

  return data;
}
