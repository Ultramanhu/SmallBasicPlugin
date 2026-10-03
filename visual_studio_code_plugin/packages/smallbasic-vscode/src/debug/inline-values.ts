import * as vscode from "vscode";

const identifierPattern = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
const keywords = new Set([
  "and", "dim", "else", "elseif", "endfor", "endfunction", "endif", "endsub", "endwhile",
  "for", "function", "goto", "if", "or", "return", "step", "sub", "then", "to", "while"
]);

export function registerSmallBasicInlineValues(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.languages.registerInlineValuesProvider(
    { language: "smallbasic" },
    {
      provideInlineValues(document, viewPort, inlineContext) {
        if (vscode.debug.activeDebugSession?.type !== "smallbasic") {
          return [];
        }

        const values: vscode.InlineValue[] = [];
        const lastLine = Math.min(viewPort.end.line, inlineContext.stoppedLocation.end.line);
        for (let lineNumber = viewPort.start.line; lineNumber <= lastLine; lineNumber += 1) {
          const line = document.lineAt(lineNumber);
          identifierPattern.lastIndex = 0;
          for (let match = identifierPattern.exec(line.text); match; match = identifierPattern.exec(line.text)) {
            const identifier = match[0];
            if (keywords.has(identifier.toLowerCase())) {
              continue;
            }

            const previous = match.index > 0 ? line.text[match.index - 1] : "";
            const following = line.text.slice(match.index + identifier.length).trimStart()[0] ?? "";
            if (previous === "." || following === ".") {
              continue;
            }

            const range = new vscode.Range(
              lineNumber,
              match.index,
              lineNumber,
              match.index + identifier.length
            );
            values.push(new vscode.InlineValueVariableLookup(range, identifier, false));
          }
        }

        return values;
      }
    }
  ));
}
