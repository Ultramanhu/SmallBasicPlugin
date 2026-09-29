import * as vscode from "vscode";
import { resolveDocumentationLocale, setDocumentationLocale } from "smallbasic-lang-core";
import { registerSmallBasicInlineValues } from "../debug/inline-values";
import { CompilationCache } from "../language/compilation-cache";
import { isSmallBasicDocument, publishDiagnostics, registerLanguageFeatures } from "../language/providers";
import { runJavaScriptCompilation } from "../run/javascript-runner";

export interface PlatformActivation {
  debugAdapterFactory: vscode.DebugAdapterDescriptorFactory;
  debugConfigurationProvider: vscode.DebugConfigurationProvider;
  runJavaScript?: () => Promise<void>;
  runCSharp?: () => Promise<void>;
  runBlazor?: () => Promise<void>;
}

export function activateCommon(context: vscode.ExtensionContext, platform: PlatformActivation): void {
  // Serve localized IntelliSense descriptions for the user's UI language
  // (falls back to the built-in English documentation when unavailable).
  setDocumentationLocale(resolveDocumentationLocale(vscode.env.language));

  const cache = new CompilationCache();
  const diagnostics = vscode.languages.createDiagnosticCollection("smallbasic");
  const debounceMs = () => vscode.workspace.getConfiguration("smallbasic").get<number>("diagnostics.debounceMs", 150);
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const scheduleDiagnostics = (document: vscode.TextDocument): void => {
    if (!isSmallBasicDocument(document)) {
      return;
    }

    const key = document.uri.toString();
    const existing = pending.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    pending.set(key, setTimeout(() => {
      pending.delete(key);
      publishDiagnostics(document, cache, diagnostics);
    }, debounceMs()));
  };

  registerLanguageFeatures(context, cache, diagnostics);
  registerSmallBasicInlineValues(context);
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory("smallbasic", platform.debugAdapterFactory),
    vscode.debug.registerDebugConfigurationProvider(
      "smallbasic",
      platform.debugConfigurationProvider,
      vscode.DebugConfigurationProviderTriggerKind.Initial
    )
  );

  for (const document of vscode.workspace.textDocuments) {
    scheduleDiagnostics(document);
  }

  const subscriptions: vscode.Disposable[] = [
    vscode.workspace.onDidOpenTextDocument(scheduleDiagnostics),
    vscode.workspace.onDidChangeTextDocument((event) => {
      cache.delete(event.document.uri);
      scheduleDiagnostics(event.document);

      if (shouldTriggerSuggest(event)) {
        setTimeout(() => {
          void vscode.commands.executeCommand("editor.action.triggerSuggest");
        }, 0);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const existing = pending.get(key);
      if (existing) {
        clearTimeout(existing);
        pending.delete(key);
      }

      cache.delete(document.uri);
      diagnostics.delete(document.uri);
    }),
    vscode.commands.registerCommand("smallbasic.newFile", async (resource?: vscode.Uri) => {
      await createNewFile(resource);
    }),
    vscode.commands.registerCommand("smallbasic.runJavaScript", async () => {
      if (platform.runJavaScript) {
        await platform.runJavaScript();
      } else {
        await runActiveDocument(cache, diagnostics);
      }
    })
  ];

  if (platform.runCSharp) {
    subscriptions.push(vscode.commands.registerCommand("smallbasic.runCSharp", platform.runCSharp));
  }

  if (platform.runBlazor) {
    subscriptions.push(vscode.commands.registerCommand("smallbasic.runBlazor", platform.runBlazor));
  }

  context.subscriptions.push(...subscriptions);
}

async function createNewFile(resource?: vscode.Uri): Promise<void> {
  const folder = await resolveTargetFolder(resource);
  if (!folder) {
    const document = await vscode.workspace.openTextDocument({
      language: "smallbasic",
      content: "' My first SmallBasic program\nTextWindow.WriteLine(\"Hello World\")\n"
    });
    await vscode.window.showTextDocument(document, { preview: false });
    return;
  }

  const file = await nextAvailableFile(folder);
  await vscode.workspace.fs.writeFile(
    file,
    new TextEncoder().encode("' My first SmallBasic program\nTextWindow.WriteLine(\"Hello World\")\n")
  );

  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function resolveTargetFolder(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (resource) {
    try {
      const stat = await vscode.workspace.fs.stat(resource);
      return stat.type === vscode.FileType.Directory ? resource : vscode.Uri.joinPath(resource, "..");
    } catch {
      return vscode.Uri.joinPath(resource, "..");
    }
  }

  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function nextAvailableFile(folder: vscode.Uri): Promise<vscode.Uri> {
  for (let index = 1; index < 1000; index += 1) {
    const candidate = vscode.Uri.joinPath(folder, `Untitled-${index}.sb`);
    try {
      await vscode.workspace.fs.stat(candidate);
    } catch {
      return candidate;
    }
  }

  return vscode.Uri.joinPath(folder, `Untitled-${Date.now()}.sb`);
}

async function runActiveDocument(
  cache: CompilationCache,
  diagnostics: vscode.DiagnosticCollection
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isSmallBasicDocument(editor.document)) {
    void vscode.window.showWarningMessage("请先打开一个 SmallBasic (.sb) 文件。");
    return;
  }

  if (!editor.document.isUntitled) {
    const saved = await editor.document.save();
    if (!saved) {
      void vscode.window.showWarningMessage("运行前需要先保存当前文件。");
      return;
    }
  }

  publishDiagnostics(editor.document, cache, diagnostics);
  const compilation = cache.get(editor.document);
  runJavaScriptCompilation(editor.document, compilation);
}

function shouldTriggerSuggest(event: vscode.TextDocumentChangeEvent): boolean {
  if (!isSmallBasicDocument(event.document)) {
    return false;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
    return false;
  }

  if (event.contentChanges.length !== 1) {
    return false;
  }

  const [change] = event.contentChanges;
  if (change.rangeLength !== 0 || change.text.length === 0) {
    return false;
  }

  return /^\.?$|^[\r\n]+$|^[\p{L}\p{N}_]$/u.test(change.text);
}
