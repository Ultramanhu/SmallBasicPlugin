import { CompletionService } from "smallbasic-lang-core";

export interface RankedCompletion {
  readonly item: CompletionService.Result;
  readonly priority: number;
  readonly preselect?: boolean;
}

type BlockKind = "if" | "for" | "while" | "sub";

function startsWithIgnoreCase(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

function stripComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    if (current === '"') {
      inString = !inString;
      continue;
    }

    if (current === "'" && !inString) {
      return line.slice(0, index);
    }
  }

  return line;
}

function detectOpenBlocks(sourceBeforeCursor: string): BlockKind[] {
  const stack: BlockKind[] = [];

  for (const rawLine of sourceBeforeCursor.split(/\r?\n/u)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }

    if (/^endif\b/i.test(line)) {
      popLatest(stack, "if");
      continue;
    }

    if (/^endfor\b/i.test(line)) {
      popLatest(stack, "for");
      continue;
    }

    if (/^endwhile\b/i.test(line)) {
      popLatest(stack, "while");
      continue;
    }

    if (/^endsub\b/i.test(line)) {
      popLatest(stack, "sub");
      continue;
    }

    if (/^if\b.*\bthen\b/i.test(line) && !/^elseif\b/i.test(line)) {
      stack.push("if");
      continue;
    }

    if (/^for\b.*\bto\b/i.test(line)) {
      stack.push("for");
      continue;
    }

    if (/^while\b/i.test(line)) {
      stack.push("while");
      continue;
    }

    if (/^sub\b\s+[^\s(]+/i.test(line)) {
      stack.push("sub");
    }
  }

  return stack;
}

function popLatest(stack: BlockKind[], kind: BlockKind): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index] === kind) {
      stack.splice(index, 1);
      return;
    }
  }
}

function snippet(title: string, insertText: string, priority: number, preselect = false): RankedCompletion {
  return {
    item: {
      kind: CompletionService.ResultKind.Snippet,
      title,
      description: title,
      insertText
    },
    priority,
    preselect
  };
}

export function getContextualCompletions(
  sourceBeforeCursor: string,
  prefix: string
): RankedCompletion[] {
  const results: RankedCompletion[] = [];
  const activeBlock = detectOpenBlocks(sourceBeforeCursor).at(-1);

  switch (activeBlock) {
    case "if":
      results.push(snippet("EndIf", "EndIf", 0, true));
      results.push(snippet("ElseIf", "ElseIf ${1:condition} Then", 1));
      results.push(snippet("Else", "Else", 2));
      break;
    case "for":
      results.push(snippet("EndFor", "EndFor", 0, true));
      break;
    case "while":
      results.push(snippet("EndWhile", "EndWhile", 0, true));
      break;
    case "sub":
      results.push(snippet("EndSub", "EndSub", 0, true));
      break;
    default:
      break;
  }

  const filtered = results.filter((entry) => startsWithIgnoreCase(entry.item.title, prefix));
  const unique = new Map<string, RankedCompletion>();
  for (const entry of filtered.sort((left, right) => left.priority - right.priority || left.item.title.localeCompare(right.item.title))) {
    const key = entry.item.title.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, entry);
    }
  }

  return [...unique.values()];
}
