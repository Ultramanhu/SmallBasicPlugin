import { resolveDocumentationLocale, setDocumentationLocale } from "smallbasic-lang-core";
import {
  SmallBasicLanguageService,
  type WorkerRequest,
  type WorkerResponse
} from "smallbasic-language-services";

const service = new SmallBasicLanguageService();
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener("message", (event: MessageEvent<WorkerRequest<unknown>>) => {
  const request = event.data;
  if (!request || typeof request.id !== "number" || typeof request.type !== "string") {
    return;
  }

  void handleRequest(request);
});

async function handleRequest(request: WorkerRequest<unknown>): Promise<void> {
  try {
    const result = dispatch(request.type, request.payload as Record<string, unknown>);
    const response: WorkerResponse<unknown> = {
      id: request.id,
      ok: true,
      type: request.type,
      result
    };
    scope.postMessage(response);
  } catch (error) {
    const response: WorkerResponse<unknown> = {
      id: request.id,
      ok: false,
      type: request.type,
      error: error instanceof Error ? error.message : String(error)
    };
    scope.postMessage(response);
  }
}

function dispatch(type: WorkerRequest<unknown>["type"], payload: Record<string, unknown>): unknown {
  switch (type) {
    case "configure":
      // Mirror the page's UI-language decision (including the manual toggle)
      // so hover/completion documentation follows it. Messages are processed
      // in order, so this lands before the first analysis request.
      setDocumentationLocale(resolveDocumentationLocale(asString(payload.language, "language")));
      return undefined;
    case "sync":
      return service.syncDocument(asString(payload.uri, "uri"), asString(payload.source, "source"), asNumber(payload.version, "version"));
    case "completion":
      return service.provideCompletionItems(
        asString(payload.uri, "uri"),
        asString(payload.source, "source"),
        asNumber(payload.version, "version"),
        asPosition(payload.position)
      );
    case "hover":
      return service.provideHover(
        asString(payload.uri, "uri"),
        asString(payload.source, "source"),
        asNumber(payload.version, "version"),
        asPosition(payload.position)
      );
    case "signature":
      return service.provideSignatureHelp(
        asString(payload.uri, "uri"),
        asString(payload.source, "source"),
        asNumber(payload.version, "version"),
        asPosition(payload.position)
      );
    case "symbols":
      return service.provideDocumentSymbols(asString(payload.uri, "uri"), asString(payload.source, "source"), asNumber(payload.version, "version"));
    case "semanticTokens":
      return service.provideSemanticTokens(asString(payload.uri, "uri"), asString(payload.source, "source"), asNumber(payload.version, "version"));
    case "folding":
      return service.provideFoldingRanges(asString(payload.uri, "uri"), asString(payload.source, "source"), asNumber(payload.version, "version"));
    case "definition":
      return service.provideDefinition(
        asString(payload.uri, "uri"),
        asString(payload.source, "source"),
        asNumber(payload.version, "version"),
        asPosition(payload.position)
      );
    case "references":
      return service.provideReferences(
        asString(payload.uri, "uri"),
        asString(payload.source, "source"),
        asNumber(payload.version, "version"),
        asPosition(payload.position)
      );
    case "dispose":
      service.disposeDocument(asString(payload.uri, "uri"));
      return undefined;
    default:
      throw new Error(`Unsupported language worker request: ${type}`);
  }
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected string field: ${field}`);
  }

  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected numeric field: ${field}`);
  }

  return value;
}

function asPosition(value: unknown): { line: number; column: number } {
  if (!value || typeof value !== "object") {
    throw new Error("Expected a position object.");
  }

  const line = asNumber((value as { line?: unknown }).line, "position.line");
  const column = asNumber((value as { column?: unknown }).column, "position.column");
  return { line, column };
}
