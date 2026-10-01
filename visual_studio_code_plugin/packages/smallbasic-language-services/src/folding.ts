import type { LanguageFoldingRange } from "./protocol";
import { splitLines } from "./ranges";

type BlockKind = "if" | "for" | "while" | "sub";

interface OpenBlock {
  kind: BlockKind;
  line: number;
}

export function provideFoldingRanges(source: string): LanguageFoldingRange[] {
  const lines = splitLines(source);
  const stack: OpenBlock[] = [];
  const ranges: LanguageFoldingRange[] = [];

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = stripComment(lines[lineNumber]).trim();
    if (!line) {
      continue;
    }

    if (/^endif\b/i.test(line)) {
      closeLatest(stack, "if", lineNumber, ranges);
      continue;
    }

    if (/^endfor\b/i.test(line)) {
      closeLatest(stack, "for", lineNumber, ranges);
      continue;
    }

    if (/^endwhile\b/i.test(line)) {
      closeLatest(stack, "while", lineNumber, ranges);
      continue;
    }

    if (/^endsub\b/i.test(line)) {
      closeLatest(stack, "sub", lineNumber, ranges);
      continue;
    }

    if (/^if\b.*\bthen\b/i.test(line) && !/^elseif\b/i.test(line)) {
      stack.push({ kind: "if", line: lineNumber });
      continue;
    }

    if (/^for\b.*\bto\b/i.test(line)) {
      stack.push({ kind: "for", line: lineNumber });
      continue;
    }

    if (/^while\b/i.test(line)) {
      stack.push({ kind: "while", line: lineNumber });
      continue;
    }

    if (/^sub\b\s+[^\s(]+/i.test(line)) {
      stack.push({ kind: "sub", line: lineNumber });
    }
  }

  return ranges;
}

function closeLatest(stack: OpenBlock[], kind: BlockKind, endLine: number, ranges: LanguageFoldingRange[]): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].kind !== kind) {
      continue;
    }

    const block = stack.splice(index, 1)[0];
    if (endLine > block.line) {
      ranges.push({ startLine: block.line, endLine, kind: "region" });
    }
    return;
  }
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
