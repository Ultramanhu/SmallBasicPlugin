import * as vscode from "vscode";
import { provideSignatureHelpInfo } from "smallbasic-language-services";

export function provideLibrarySignatureHelp(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.SignatureHelp | undefined {
  const line = document.lineAt(position.line).text;
  const signature = provideSignatureHelpInfo(line, position.character);
  if (!signature) {
    return undefined;
  }

  const information = new vscode.SignatureInformation(
    signature.signatures[0].label,
    new vscode.MarkdownString(signature.signatures[0].documentation)
  );
  signature.signatures[0].parameters.forEach((parameter) => {
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
