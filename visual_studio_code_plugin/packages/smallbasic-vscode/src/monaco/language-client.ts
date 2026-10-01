import * as monaco from "monaco-editor";
import type {
  LanguageCompletionList,
  LanguageDocumentSnapshot,
  LanguageDocumentSymbol,
  LanguageFoldingRange,
  LanguageHover,
  LanguagePosition,
  LanguageRange,
  LanguageSemanticToken,
  LanguageSignatureHelp,
  WorkerDocumentPayload,
  WorkerPositionPayload,
  WorkerRequest,
  WorkerRequestType,
  WorkerResponse,
  WorkerConfigurePayload,
  WorkerUriPayload
} from "smallbasic-language-services";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  type: WorkerRequestType;
}

export class LanguageWorkerClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  public constructor(private readonly worker: Worker) {
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError);
  }

  public configure(language: string): Promise<void> {
    const payload: WorkerConfigurePayload = { language };
    return this.request("configure", payload);
  }

  public async syncModel(model: monaco.editor.ITextModel): Promise<LanguageDocumentSnapshot> {
    return this.request("sync", this.documentPayload(model));
  }

  public async provideCompletions(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<LanguageCompletionList> {
    return this.request("completion", this.positionPayload(model, position));
  }

  public async provideHover(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<LanguageHover | undefined> {
    return this.request("hover", this.positionPayload(model, position));
  }

  public async provideSignatureHelp(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<LanguageSignatureHelp | undefined> {
    return this.request("signature", this.positionPayload(model, position));
  }

  public async provideDocumentSymbols(model: monaco.editor.ITextModel): Promise<LanguageDocumentSymbol[]> {
    return this.request("symbols", this.documentPayload(model));
  }

  public async provideSemanticTokens(model: monaco.editor.ITextModel): Promise<LanguageSemanticToken[]> {
    return this.request("semanticTokens", this.documentPayload(model));
  }

  public async provideFoldingRanges(model: monaco.editor.ITextModel): Promise<LanguageFoldingRange[]> {
    return this.request("folding", this.documentPayload(model));
  }

  public async provideDefinition(model: monaco.editor.ITextModel, position: monaco.Position): Promise<LanguageRange | undefined> {
    return this.request("definition", this.positionPayload(model, position));
  }

  public async provideReferences(model: monaco.editor.ITextModel, position: monaco.Position): Promise<LanguageRange[]> {
    return this.request("references", this.positionPayload(model, position));
  }

  public async disposeDocument(uri: monaco.Uri | string): Promise<void> {
    const payload: WorkerUriPayload = { uri: typeof uri === "string" ? uri : uri.toString() };
    await this.request("dispose", payload);
  }

  public dispose(): void {
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError);
    this.worker.terminate();
    for (const request of this.pending.values()) {
      request.reject(new Error("Language worker disposed."));
    }
    this.pending.clear();
  }

  private request<TResult>(type: WorkerRequestType, payload: WorkerDocumentPayload | WorkerPositionPayload | WorkerUriPayload | WorkerConfigurePayload): Promise<TResult> {
    const id = this.nextId++;
    const request: WorkerRequest<typeof payload> = { id, type, payload };

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, type });
      this.worker.postMessage(request);
    });
  }

  private readonly handleMessage = (event: MessageEvent<WorkerResponse<unknown>>): void => {
    const response = event.data;
    if (!response || typeof response.id !== "number") {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    this.pending.delete(response.id);
    if (!response.ok) {
      pending.reject(new Error(response.error));
      return;
    }

    pending.resolve(response.result);
  };

  private readonly handleError = (event: ErrorEvent): void => {
    const message = event.message || "Language worker failed.";
    for (const request of this.pending.values()) {
      request.reject(new Error(message));
    }
    this.pending.clear();
  };

  private documentPayload(model: monaco.editor.ITextModel): WorkerDocumentPayload {
    return {
      uri: model.uri.toString(),
      version: model.getVersionId(),
      source: model.getValue()
    };
  }

  private positionPayload(model: monaco.editor.ITextModel, position: monaco.Position): WorkerPositionPayload {
    return {
      ...this.documentPayload(model),
      position: toLanguagePosition(position)
    };
  }
}

function toLanguagePosition(position: monaco.Position): LanguagePosition {
  return {
    line: Math.max(0, position.lineNumber - 1),
    column: Math.max(0, position.column - 1)
  };
}
