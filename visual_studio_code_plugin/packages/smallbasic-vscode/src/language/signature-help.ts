import * as vscode from "vscode";
import { getMethodSignature } from "./method-signatures";

export function provideLibrarySignatureHelp(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.SignatureHelp | undefined {
  const line = document.lineAt(position.line).text;
  const signature = getMethodSignature(line, position.character);
  if (!signature) {
    return undefined;
  }

  const information = new vscode.SignatureInformation(
    signature.label,
    new vscode.MarkdownString(signature.description)
  );
  signature.parameters.forEach((parameter) => {
    information.parameters.push(
      new vscode.ParameterInformation(parameter.name, new vscode.MarkdownString(parameter.description))
    );
  });

  const help = new vscode.SignatureHelp();
  help.signatures = [information];
  help.activeSignature = 0;
  help.activeParameter = signature.activeParameter;
  return help;
}
