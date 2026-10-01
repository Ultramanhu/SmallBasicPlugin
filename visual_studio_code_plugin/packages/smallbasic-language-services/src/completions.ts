import { Compilation, CompletionService, CompilerPosition, CompilerRange } from "smallbasic-lang-core";
import { getCompletionSpan } from "./completion-span";
import { getContextualCompletions, type RankedCompletion } from "./contextual-completions";
import type { LanguageCompletionItem, LanguageCompletionKind, LanguageCompletionList, LanguagePosition } from "./protocol";
import { textBeforePosition, toLanguageRange } from "./ranges";

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

export interface CompletionRequest {
  readonly source: string;
  readonly lineText: string;
  readonly position: LanguagePosition;
  readonly compilation: Compilation;
}

export function provideCompletionItems(request: CompletionRequest): LanguageCompletionList {
  const span = getCompletionSpan(request.lineText, request.position.column);
  const prefix = request.lineText.slice(span.start, request.position.column);
  const results = CompletionService.provideCompletion(
    request.compilation,
    new CompilerPosition(request.position.line, request.position.column)
  );
  const sourceBeforeCursor = textBeforePosition(request.source, request.position);
  const isMemberAccess = span.start > 0 && request.lineText[span.start - 1] === ".";
  const contextual = isMemberAccess ? [] : getContextualCompletions(sourceBeforeCursor, prefix);
  const baseline = results.length === 0 && prefix.length === 0
    ? baselineCompletions().map((item) => ({ item, priority: 20 } satisfies RankedCompletion))
    : [];
  const combined = dedupeCompletions([
    ...contextual,
    ...results.map((item) => ({ item, priority: 10 } satisfies RankedCompletion)),
    ...baseline
  ]);

  const replacingRange = toLanguageRange(CompilerRange.fromValues(
    request.position.line,
    span.start,
    request.position.line,
    span.end
  ));
  const insertingRange = toLanguageRange(CompilerRange.fromValues(
    request.position.line,
    span.start,
    request.position.line,
    request.position.column
  ));

  return {
    items: combined.map(({ item, priority, preselect }) => {
      const kind = mapCompletionKind(item.kind);
      const label = item.parameters !== undefined
        ? `${item.title}(${item.parameters.join(", ")})`
        : item.title;
      return {
        kind,
        label,
        detail: item.description,
        filterText: item.title,
        sortText: `${priority.toString().padStart(2, "0")}_${item.title}`,
        documentation: item.parameterDescriptions !== undefined && item.parameterDescriptions.length > 0
          ? item.parameters!.map((parameter, index) => `- **${parameter}**: ${item.parameterDescriptions![index]}`).join("\n")
          : undefined,
        insertText: item.insertText ?? item.title,
        insertTextIsSnippet: item.insertText !== undefined,
        preselect: !!preselect,
        ranges: {
          inserting: insertingRange,
          replacing: replacingRange
        }
      } satisfies LanguageCompletionItem;
    })
  };
}

function mapCompletionKind(kind: CompletionService.ResultKind): LanguageCompletionKind {
  switch (kind) {
    case CompletionService.ResultKind.Class:
      return "class";
    case CompletionService.ResultKind.Method:
      return "method";
    case CompletionService.ResultKind.Snippet:
      return "snippet";
    case CompletionService.ResultKind.Event:
      return "event";
    default:
      return "property";
  }
}

function dedupeCompletions(items: readonly RankedCompletion[]): RankedCompletion[] {
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
