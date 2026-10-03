export interface LanguagePosition {
  readonly line: number;
  readonly column: number;
}

export interface LanguageRange {
  readonly start: LanguagePosition;
  readonly end: LanguagePosition;
}

export interface LanguageDiagnostic {
  readonly range: LanguageRange;
  readonly message: string;
  readonly severity: "error";
}

export type LanguageCompletionKind = "class" | "method" | "property" | "event" | "snippet";

export interface LanguageCompletionItem {
  readonly kind: LanguageCompletionKind;
  readonly label: string;
  readonly filterText: string;
  readonly sortText: string;
  readonly detail?: string;
  readonly documentation?: string;
  readonly insertText: string;
  readonly insertTextIsSnippet: boolean;
  readonly preselect: boolean;
  readonly ranges: {
    readonly inserting: LanguageRange;
    readonly replacing: LanguageRange;
  };
}

export interface LanguageCompletionList {
  readonly items: readonly LanguageCompletionItem[];
}

export interface LanguageHover {
  readonly contents: readonly string[];
  readonly range: LanguageRange;
}

export interface LanguageSignatureParameter {
  readonly name: string;
  readonly description: string;
}

export interface LanguageSignature {
  readonly label: string;
  readonly documentation: string;
  readonly parameters: readonly LanguageSignatureParameter[];
}

export interface LanguageSignatureHelp {
  readonly signatures: readonly LanguageSignature[];
  readonly activeSignature: number;
  readonly activeParameter: number;
}

export type LanguageSymbolKind = "sub" | "function" | "variable";

export interface LanguageDocumentSymbol {
  readonly name: string;
  readonly detail: string;
  readonly kind: LanguageSymbolKind;
  readonly range: LanguageRange;
  readonly selectionRange: LanguageRange;
  readonly children: readonly LanguageDocumentSymbol[];
}

export type LanguageSemanticTokenType =
  | "keyword"
  | "comment"
  | "string"
  | "number"
  | "class"
  | "function"
  | "parameter"
  | "variable";

export interface LanguageSemanticToken {
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly type: LanguageSemanticTokenType;
  readonly modifiers: number;
}

export interface LanguageFoldingRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly kind?: "region";
}

export interface LanguageDocumentSnapshot {
  readonly uri: string;
  readonly version: number;
  readonly diagnostics: readonly LanguageDiagnostic[];
}

export type WorkerRequestType =
  | "configure"
  | "sync"
  | "completion"
  | "hover"
  | "signature"
  | "symbols"
  | "semanticTokens"
  | "folding"
  | "definition"
  | "references"
  | "dispose";

export interface WorkerRequest<TPayload = unknown> {
  readonly id: number;
  readonly type: WorkerRequestType;
  readonly payload: TPayload;
}

export interface WorkerSuccessResponse<TResult = unknown> {
  readonly id: number;
  readonly ok: true;
  readonly type: WorkerRequestType;
  readonly result: TResult;
}

export interface WorkerErrorResponse {
  readonly id: number;
  readonly ok: false;
  readonly type: WorkerRequestType;
  readonly error: string;
}

export type WorkerResponse<TResult = unknown> = WorkerSuccessResponse<TResult> | WorkerErrorResponse;

export interface WorkerDocumentPayload {
  readonly uri: string;
  readonly version: number;
  readonly source: string;
}

export interface WorkerPositionPayload extends WorkerDocumentPayload {
  readonly position: LanguagePosition;
}

export interface WorkerUriPayload {
  readonly uri: string;
}

/** BCP-47 UI language tag (e.g. "zh-CN"); the worker maps it to a documentation locale. */
export interface WorkerConfigurePayload {
  readonly language: string;
}
