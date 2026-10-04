import { TextWindowColor } from "smallbasic-lang-core";

/**
 * ANSI escape mapping of the TextWindow colors, shared by the terminal-ish
 * hosts (the Node run host's stdout and the VS Code pseudoterminal). The
 * foreground/background codes are the standard 16-color SGR numbers.
 */

export const ANSI_FOREGROUND: Record<TextWindowColor, number> = {
  [TextWindowColor.Black]: 30,
  [TextWindowColor.DarkBlue]: 34,
  [TextWindowColor.DarkGreen]: 32,
  [TextWindowColor.DarkCyan]: 36,
  [TextWindowColor.DarkRed]: 31,
  [TextWindowColor.DarkMagenta]: 35,
  [TextWindowColor.DarkYellow]: 33,
  [TextWindowColor.Gray]: 37,
  [TextWindowColor.DarkGray]: 90,
  [TextWindowColor.Blue]: 94,
  [TextWindowColor.Green]: 92,
  [TextWindowColor.Cyan]: 96,
  [TextWindowColor.Red]: 91,
  [TextWindowColor.Magenta]: 95,
  [TextWindowColor.Yellow]: 93,
  [TextWindowColor.White]: 97
};

export const ANSI_BACKGROUND: Record<TextWindowColor, number> = {
  [TextWindowColor.Black]: 40,
  [TextWindowColor.DarkBlue]: 44,
  [TextWindowColor.DarkGreen]: 42,
  [TextWindowColor.DarkCyan]: 46,
  [TextWindowColor.DarkRed]: 41,
  [TextWindowColor.DarkMagenta]: 45,
  [TextWindowColor.DarkYellow]: 43,
  [TextWindowColor.Gray]: 47,
  [TextWindowColor.DarkGray]: 100,
  [TextWindowColor.Blue]: 104,
  [TextWindowColor.Green]: 102,
  [TextWindowColor.Cyan]: 106,
  [TextWindowColor.Red]: 101,
  [TextWindowColor.Magenta]: 105,
  [TextWindowColor.Yellow]: 103,
  [TextWindowColor.White]: 107
};

/** Wraps `text` in the SGR sequence for the given TextWindow colors. */
export function ansiColorize(text: string, foreground: TextWindowColor, background: TextWindowColor): string {
  return `\u001b[${ANSI_FOREGROUND[foreground]};${ANSI_BACKGROUND[background]}m${text}\u001b[0m`;
}
