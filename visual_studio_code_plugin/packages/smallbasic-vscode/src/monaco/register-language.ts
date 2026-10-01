import * as monaco from "monaco-editor";
import configurationJson from "../../language-configuration.json";
import { registerTextMateTokenProvider } from "./textmate";

export const LANGUAGE_ID = "smallbasic";
// Monaco does not ship VS Code's named themes, so this replicates the current
// default dark look (Dark Modern editor colors; its token colors are the
// Dark+/vs-dark set) under our own id.
export const PLAYGROUND_THEME = "smallbasic-dark-modern";

interface RawLanguageConfiguration {
  readonly comments?: { readonly lineComment?: string };
  readonly brackets?: ReadonlyArray<readonly [string, string]>;
  readonly autoClosingPairs?: ReadonlyArray<{ readonly open: string; readonly close: string }>;
  readonly surroundingPairs?: ReadonlyArray<readonly [string, string]>;
  readonly indentationRules?: {
    readonly increaseIndentPattern?: string;
    readonly decreaseIndentPattern?: string;
  };
  readonly wordPattern?: string;
}

let registrationPromise: Promise<void> | undefined;

export async function registerSmallBasicLanguage(onigurumaUrl: string): Promise<void> {
  if (!registrationPromise) {
    registrationPromise = doRegister(onigurumaUrl).catch((error) => {
      registrationPromise = undefined;
      throw error;
    });
  }

  await registrationPromise;
}

async function doRegister(onigurumaUrl: string): Promise<void> {
  monaco.languages.register({
    id: LANGUAGE_ID,
    aliases: ["SmallBasic", "smallbasic"],
    extensions: [".sb"]
  });

  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, toMonacoLanguageConfiguration(configurationJson as unknown as RawLanguageConfiguration));

  monaco.editor.defineTheme(PLAYGROUND_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      // The rules mirror the Dark+ token colors. Scope names must match the
      // scopes emitted by syntaxes/smallbasic.tmLanguage.json: anything the
      // grammar leaves unscoped (identifiers, operators, punctuation) keeps
      // the editor foreground.
      { token: "comment", foreground: "6A9955" },
      { token: "string", foreground: "CE9178" },
      { token: "constant.numeric", foreground: "B5CEA8" },
      { token: "keyword.control", foreground: "C586C0" },
      { token: "support.class", foreground: "4EC9B0" }
    ],
    colors: {
      "editor.background": "#1F1F1F",
      "editor.foreground": "#CCCCCC",
      "editorLineNumber.foreground": "#6E7681",
      "editorLineNumber.activeForeground": "#CCCCCC",
      "editorCursor.foreground": "#AEAFAD",
      "editor.selectionBackground": "#264F78",
      "editor.inactiveSelectionBackground": "#3A3D41",
      "editor.lineHighlightBackground": "#282828",
      "editorGutter.background": "#1F1F1F",
      "editorWidget.background": "#202420",
      "editorWidget.border": "#454545",
      "editorSuggestWidget.background": "#202420",
      "editorSuggestWidget.border": "#454545",
      "editorSuggestWidget.selectedBackground": "#04395E"
    }
  });
  monaco.editor.setTheme(PLAYGROUND_THEME);

  await registerTextMateTokenProvider(LANGUAGE_ID, onigurumaUrl);
}

function toMonacoLanguageConfiguration(configuration: RawLanguageConfiguration): monaco.languages.LanguageConfiguration {
  const increaseIndentPattern = compilePattern(configuration.indentationRules?.increaseIndentPattern);
  const decreaseIndentPattern = compilePattern(configuration.indentationRules?.decreaseIndentPattern);

  return {
    comments: configuration.comments,
    brackets: configuration.brackets?.map((pair) => [pair[0], pair[1]] as [string, string]),
    autoClosingPairs: configuration.autoClosingPairs?.map((pair) => ({ ...pair })),
    surroundingPairs: configuration.surroundingPairs?.map((pair) => ({ open: pair[0], close: pair[1] })),
    indentationRules: increaseIndentPattern && decreaseIndentPattern ? {
      increaseIndentPattern,
      decreaseIndentPattern
    } : undefined,
    wordPattern: compilePattern(configuration.wordPattern)
  };
}

function compilePattern(pattern: string | undefined): RegExp | undefined {
  if (!pattern) {
    return undefined;
  }

  return new RegExp(pattern);
}
