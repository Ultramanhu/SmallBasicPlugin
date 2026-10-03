import type { Compilation } from "smallbasic-lang-core";
import type { LanguageSignatureHelp } from "./protocol";
import { getMethodSignature } from "./method-signatures";

export function provideSignatureHelpInfo(
  lineText: string,
  character: number,
  compilation?: Compilation
): LanguageSignatureHelp | undefined {
  const signature = getMethodSignature(lineText, character, compilation);
  if (!signature) {
    return undefined;
  }

  return {
    signatures: [{
      label: signature.label,
      documentation: signature.description,
      parameters: signature.parameters.map((parameter) => ({
        name: parameter.name,
        description: parameter.description
      }))
    }],
    activeSignature: 0,
    activeParameter: signature.activeParameter
  };
}
