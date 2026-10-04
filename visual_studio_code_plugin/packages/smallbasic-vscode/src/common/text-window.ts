import {
  BaseValue,
  ITextWindowLibraryPlugin,
  NumberValue,
  StringValue,
  TextWindowColor,
  ValueKind
} from "smallbasic-lang-core";

/**
 * Shared plumbing of the `ITextWindowLibraryPlugin` implementations: the
 * pushed-input buffer, the pending input kind and the active TextWindow
 * colors. The hosts (Node run host, browser run host, debug driver, VS Code
 * pseudoterminal) only supply their own `writeText` and any extra lifecycle.
 */

/** Converts a `TextWindow.Read`/`ReadNumber` line into an engine value. */
export function parseConsoleInput(kind: ValueKind | undefined, raw: string): BaseValue {
  if (kind === ValueKind.Number) {
    const parsed = Number(raw);
    return new NumberValue(Number.isFinite(parsed) ? parsed : 0);
  }

  return new StringValue(raw);
}

export abstract class BufferedTextWindowPlugin implements ITextWindowLibraryPlugin {
  private readonly inputBuffer: BaseValue[] = [];
  private foreground = TextWindowColor.White;
  private background = TextWindowColor.Black;
  /** Kind of the pending `Read`/`ReadNumber`, cleared by {@link pushInput}. */
  protected pendingInputKind: ValueKind | undefined;

  public inputIsNeeded(kind: ValueKind): void {
    this.pendingInputKind = kind;
  }

  public checkInputBuffer(): BaseValue | undefined {
    return this.inputBuffer.shift();
  }

  public isWaitingForInput(): boolean {
    return this.pendingInputKind !== undefined;
  }

  public pushInput(raw: string): void {
    this.inputBuffer.push(parseConsoleInput(this.pendingInputKind, raw));
    this.pendingInputKind = undefined;
  }

  public getForegroundColor(): TextWindowColor {
    return this.foreground;
  }

  public setForegroundColor(color: TextWindowColor): void {
    this.foreground = color;
  }

  public getBackgroundColor(): TextWindowColor {
    return this.background;
  }

  public setBackgroundColor(color: TextWindowColor): void {
    this.background = color;
  }

  public abstract writeText(value: string, appendNewLine: boolean): void;
}
