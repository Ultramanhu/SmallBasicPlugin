export interface CompletionSpan {
  readonly start: number;
  readonly end: number;
}

const completionSeparatorPattern = /[\s()\[\],.:+\-*/=<>"']/u;

export function isCompletionWordChar(char: string): boolean {
  return char.length > 0 && !completionSeparatorPattern.test(char);
}

export function getCompletionSpan(lineText: string, character: number): CompletionSpan {
  const safeCharacter = Math.max(0, Math.min(character, lineText.length));

  let start = safeCharacter;
  while (start > 0 && isCompletionWordChar(lineText[start - 1])) {
    start -= 1;
  }

  let end = safeCharacter;
  while (end < lineText.length && isCompletionWordChar(lineText[end])) {
    end += 1;
  }

  return { start, end };
}
