import { CompilerPosition, CompilerRange } from "smallbasic-lang-core";
import type { LanguagePosition, LanguageRange } from "./protocol";

export function toCompilerPosition(position: LanguagePosition): CompilerPosition {
  return new CompilerPosition(position.line, position.column);
}

export function toLanguagePosition(position: CompilerPosition | { line: number; column: number }): LanguagePosition {
  return { line: position.line, column: position.column };
}

export function toLanguageRange(range: CompilerRange): LanguageRange {
  return {
    start: toLanguagePosition(range.start),
    end: toLanguagePosition(range.end)
  };
}

export function lineTextAt(source: string, line: number): string {
  const lines = splitLines(source);
  return lines[Math.max(0, Math.min(line, lines.length - 1))] ?? "";
}

export function splitLines(source: string): string[] {
  return source.split(/\r?\n/u);
}

export function offsetAt(source: string, position: LanguagePosition): number {
  const lines = splitLines(source);
  const safeLine = Math.max(0, Math.min(position.line, lines.length - 1));
  const safeColumn = Math.max(0, Math.min(position.column, lines[safeLine]?.length ?? 0));

  let line = 0;
  let offset = 0;
  while (line < safeLine && offset < source.length) {
    const current = source.charCodeAt(offset);
    offset += 1;
    if (current === 13) {
      if (source.charCodeAt(offset) === 10) {
        offset += 1;
      }
      line += 1;
    } else if (current === 10) {
      line += 1;
    }
  }

  return offset + safeColumn;
}

export function textBeforePosition(source: string, position: LanguagePosition): string {
  return source.slice(0, offsetAt(source, position));
}
