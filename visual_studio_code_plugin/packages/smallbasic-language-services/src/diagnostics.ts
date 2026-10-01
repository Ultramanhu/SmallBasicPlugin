import { Compilation } from "smallbasic-lang-core";
import type { LanguageDiagnostic } from "./protocol";
import { toLanguageRange } from "./ranges";

export function provideDiagnostics(compilation: Compilation): LanguageDiagnostic[] {
  return compilation.diagnostics.map((diagnostic) => ({
    range: toLanguageRange(diagnostic.range),
    message: diagnostic.toString(),
    severity: "error"
  }));
}
