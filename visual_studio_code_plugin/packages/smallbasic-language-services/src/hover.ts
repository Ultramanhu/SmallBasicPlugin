import { Compilation, HoverService } from "smallbasic-lang-core";
import type { LanguageHover, LanguagePosition } from "./protocol";
import { toCompilerPosition, toLanguageRange } from "./ranges";

export function provideHoverInfo(compilation: Compilation, position: LanguagePosition): LanguageHover | undefined {
  const hover = HoverService.provideHover(compilation, toCompilerPosition(position));
  if (!hover) {
    return undefined;
  }

  return {
    contents: [...hover.text],
    range: toLanguageRange(hover.range)
  };
}
