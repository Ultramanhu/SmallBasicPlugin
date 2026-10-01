import type { LanguageCompletionItem } from "smallbasic-language-services";
import { getCompletionSpan } from "smallbasic-language-services";
import snippetsJson from "../../snippets/smallbasic.json";

interface RawSnippet {
  readonly prefix: string | readonly string[];
  readonly body: string | readonly string[];
  readonly description?: string;
}

const snippets = Object.entries(snippetsJson as Record<string, RawSnippet>).map(([name, snippet]) => {
  const prefixes = Array.isArray(snippet.prefix) ? [...snippet.prefix] : [snippet.prefix];
  return {
    name,
    prefixes,
    body: Array.isArray(snippet.body) ? snippet.body.join("\n") : snippet.body,
    description: snippet.description ?? name
  };
}) as Array<{ name: string; prefixes: string[]; body: string; description: string }>;

export function getSnippetCompletionItems(lineText: string, line: number, column: number): LanguageCompletionItem[] {
  const span = getCompletionSpan(lineText, column);
  const prefix = lineText.slice(span.start, column).toLowerCase();

  return snippets
    .filter((snippet) => prefix.length === 0 || snippet.prefixes.some((value) => value.toLowerCase().startsWith(prefix)))
    .map((snippet, index) => ({
      kind: "snippet",
      label: snippet.prefixes[0],
      filterText: snippet.prefixes[0],
      sortText: `90_${index.toString().padStart(2, "0")}_${snippet.prefixes[0]}`,
      detail: snippet.description,
      documentation: snippet.description,
      insertText: snippet.body,
      insertTextIsSnippet: true,
      preselect: false,
      ranges: {
        inserting: {
          start: { line, column: span.start },
          end: { line, column }
        },
        replacing: {
          start: { line, column: span.start },
          end: { line, column: span.end }
        }
      }
    } satisfies LanguageCompletionItem));
}
