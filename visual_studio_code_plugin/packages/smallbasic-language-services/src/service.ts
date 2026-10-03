import { Compilation } from "smallbasic-lang-core";
import { provideCompletionItems } from "./completions";
import { provideDiagnostics } from "./diagnostics";
import { collectOutlineSymbols, toDocumentSymbols } from "./document-symbols";
import { provideFoldingRanges } from "./folding";
import { provideHoverInfo } from "./hover";
import type {
  LanguageCompletionList,
  LanguageDocumentSnapshot,
  LanguageDocumentSymbol,
  LanguageFoldingRange,
  LanguageHover,
  LanguagePosition,
  LanguageRange,
  LanguageSemanticToken,
  LanguageSignatureHelp
} from "./protocol";
import { lineTextAt } from "./ranges";
import { provideDefinition, provideReferences } from "./navigation";
import { provideSemanticTokens } from "./semantic-tokens";
import { provideSignatureHelpInfo } from "./signature-help";

interface DocumentState {
  readonly uri: string;
  readonly version: number;
  readonly source: string;
  readonly compilation: Compilation;
}

export class SmallBasicLanguageService {
  private readonly documents = new Map<string, DocumentState>();

  public syncDocument(uri: string, source: string, version: number): LanguageDocumentSnapshot {
    const state = this.ensureDocument(uri, source, version);
    return {
      uri: state.uri,
      version: state.version,
      diagnostics: provideDiagnostics(state.compilation)
    };
  }

  public provideCompletionItems(uri: string, source: string, version: number, position: LanguagePosition): LanguageCompletionList {
    const state = this.ensureDocument(uri, source, version);
    return provideCompletionItems({
      source,
      lineText: lineTextAt(source, position.line),
      position,
      compilation: state.compilation
    });
  }

  public provideHover(uri: string, source: string, version: number, position: LanguagePosition): LanguageHover | undefined {
    const state = this.ensureDocument(uri, source, version);
    return provideHoverInfo(state.compilation, position);
  }

  public provideSignatureHelp(uri: string, source: string, version: number, position: LanguagePosition): LanguageSignatureHelp | undefined {
    const state = this.ensureDocument(uri, source, version);
    return provideSignatureHelpInfo(lineTextAt(source, position.line), position.column, state.compilation);
  }

  public provideDocumentSymbols(uri: string, source: string, version: number): LanguageDocumentSymbol[] {
    const state = this.ensureDocument(uri, source, version);
    return toDocumentSymbols(collectOutlineSymbols(state.compilation));
  }

  public provideSemanticTokens(uri: string, source: string, version: number): LanguageSemanticToken[] {
    const state = this.ensureDocument(uri, source, version);
    return provideSemanticTokens(state.compilation);
  }

  public provideFoldingRanges(uri: string, source: string, version: number): LanguageFoldingRange[] {
    this.ensureDocument(uri, source, version);
    return provideFoldingRanges(source);
  }

  public provideDefinition(uri: string, source: string, version: number, position: LanguagePosition): LanguageRange | undefined {
    const state = this.ensureDocument(uri, source, version);
    return provideDefinition(state.compilation, position);
  }

  public provideReferences(uri: string, source: string, version: number, position: LanguagePosition): LanguageRange[] {
    const state = this.ensureDocument(uri, source, version);
    return provideReferences(state.compilation, position);
  }

  public disposeDocument(uri: string): void {
    this.documents.delete(uri);
  }

  private ensureDocument(uri: string, source: string, version: number): DocumentState {
    const existing = this.documents.get(uri);
    if (existing && existing.version === version && existing.source === source) {
      return existing;
    }

    const state: DocumentState = {
      uri,
      version,
      source,
      compilation: new Compilation(source)
    };
    this.documents.set(uri, state);
    return state;
  }
}
