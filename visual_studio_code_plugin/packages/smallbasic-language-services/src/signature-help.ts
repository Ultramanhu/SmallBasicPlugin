import type { LanguageSignatureHelp } from "./protocol";
import { getMethodSignature } from "./method-signatures";

export function provideSignatureHelpInfo(lineText: string, character: number): LanguageSignatureHelp | undefined {
  const signature = getMethodSignature(lineText, character);
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
