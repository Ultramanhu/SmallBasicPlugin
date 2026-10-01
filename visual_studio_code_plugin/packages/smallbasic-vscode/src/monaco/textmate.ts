import * as monaco from "monaco-editor";
import {
  INITIAL,
  Registry,
  parseRawGrammar,
  type StateStack
} from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import grammarJson from "../../syntaxes/smallbasic.tmLanguage.json";

class TextMateState implements monaco.languages.IState {
  public constructor(public readonly ruleStack: StateStack) {}

  public clone(): TextMateState {
    return this;
  }

  public equals(other: monaco.languages.IState): boolean {
    return other instanceof TextMateState && (other.ruleStack === this.ruleStack || other.ruleStack.equals(this.ruleStack));
  }
}

let registrationPromise: Promise<void> | undefined;

export async function registerTextMateTokenProvider(languageId: string, onigurumaUrl: string): Promise<void> {
  if (!registrationPromise) {
    registrationPromise = doRegister(languageId, onigurumaUrl).catch((error) => {
      registrationPromise = undefined;
      throw error;
    });
  }

  await registrationPromise;
}

async function doRegister(languageId: string, onigurumaUrl: string): Promise<void> {
  const onigLib = loadOniguruma(onigurumaUrl);
  // No custom IRawTheme on purpose: the grammar only supplies scopes, and
  // colors resolve through the Monaco theme rules defined in
  // register-language.ts. A separate TextMate color map is one more table to
  // keep in lockstep (and a bad entry silently falls back to Color.red), so
  // the Monaco theme is the single source of color truth.
  const registry = new Registry({
    onigLib,
    loadGrammar: async (scopeName) => {
      if (scopeName !== grammarJson.scopeName) {
        return null;
      }

      return parseRawGrammar(JSON.stringify(grammarJson), "smallbasic.tmLanguage.json");
    }
  });

  const grammar = await registry.loadGrammar(grammarJson.scopeName);
  if (!grammar) {
    throw new Error(`Unable to load TextMate grammar: ${grammarJson.scopeName}`);
  }

  monaco.languages.setTokensProvider(languageId, {
    getInitialState: () => new TextMateState(INITIAL),
    tokenize(line: string, state: monaco.languages.IState) {
      const result = grammar.tokenizeLine(line, (state as TextMateState).ruleStack);
      // Monaco's theme matcher consumes a single dotted scope string (its
      // IToken.scopes is `string`, matched by segment prefix against the
      // theme rules), so emit the innermost scope of each TextMate token.
      const tokens = result.tokens.map((token) => ({
        startIndex: token.startIndex,
        scopes: token.scopes[token.scopes.length - 1]
      }));
      return {
        tokens,
        endState: new TextMateState(result.ruleStack)
      };
    }
  });
}

let onigurumaPromise: Promise<{
  createOnigScanner(patterns: string[]): OnigScanner;
  createOnigString(source: string): OnigString;
}> | undefined;

function loadOniguruma(onigurumaUrl: string): Promise<{
  createOnigScanner(patterns: string[]): OnigScanner;
  createOnigString(source: string): OnigString;
}> {
  if (!onigurumaPromise) {
    onigurumaPromise = fetch(onigurumaUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load ${onigurumaUrl}: HTTP ${response.status}`);
        }

        await loadWASM(await response.arrayBuffer());
        return {
          createOnigScanner(patterns: string[]) {
            return new OnigScanner(patterns);
          },
          createOnigString(source: string) {
            return new OnigString(source);
          }
        };
      })
      .catch((error) => {
        onigurumaPromise = undefined;
        throw error;
      });
  }

  return onigurumaPromise;
}
