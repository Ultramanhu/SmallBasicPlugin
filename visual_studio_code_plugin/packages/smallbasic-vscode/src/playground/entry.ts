import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import "./playground.css";
import type { LanguageDiagnostic, LanguageDocumentSymbol } from "smallbasic-language-services";
import {
  BlazorDebugTransport,
  JsDebugTransport,
  PlaygroundDebugController,
  type DebugBackendKind,
  type DebugEvent
} from "./debug-controller";
import { LanguageWorkerClient } from "../monaco/language-client";
import { PLAYGROUND_THEME, registerSmallBasicLanguage } from "../monaco/register-language";
import { registerSmallBasicProviders } from "../monaco/register-providers";

interface ShellProgram {
  path: string;
  name: string;
  graphics: boolean;
  source?: string;
  local?: boolean;
}

interface ShellManifest {
  default: string;
  items: ShellProgram[];
}

interface ProgramSnapshot {
  name: string;
  source: string;
  modelVersion?: number;
}

interface SmallBasicWebApi {
  runJavaScript(source: string, hooks: unknown): Promise<number>;
  debugStart(json: string): void;
  debugCommand(json: string): void;
  debugStop(): void;
}

interface RunHostController {
  setStatus(text: string): void;
  setLanguageDiagnostics(text: string): void;
  showRuntimeDiagnostics(text: string): void;
  selectBackend(backend: string): void;
  getBackend(): string;
  probeJavaScriptBackend(): Promise<void>;
  loadJavaScriptBackend(): Promise<SmallBasicWebApi>;
  runProgram(snapshot: ProgramSnapshot | null): Promise<void>;
  stopRun(): Promise<void>;
  isRunning(): boolean;
  setRunning(running: boolean): void;
  requestDebugInput(numberInput: boolean): Promise<string>;
  appendConsole(text: string, foreground: number, background: number): void;
  mirrorToConsole(text: string): void;
  startBlazor(): Promise<void>;
  invokeBlazor(method: string, ...args: unknown[]): Promise<unknown>;
  banner(text: string): void;
  debugListener: ((message: DebugEvent) => void) | null;
  onHostWrite: ((text: string) => void) | null;
  dispose(): void;
}

type ControllerDomValue = HTMLElement | HTMLInputElement | HTMLSelectElement | null;

interface ShellApi {
  BACKEND_JAVASCRIPT: string;
  BACKEND_BLAZOR: string;
  FALLBACK_PROGRAM: ShellProgram;
  isChineseLocale(): boolean;
  applyStaticText(table: Record<string, string>): void;
  stripBom(text: string): string;
  detectGraphicsUsage(source: string): boolean;
  loadProgramManifest(): Promise<ShellManifest>;
  ensureProgramSource(program: ShellProgram): Promise<ShellProgram>;
  createRunHostController(options: { dom: Record<string, ControllerDomValue> }): RunHostController;
}

interface DomHandles {
  [key: string]: ControllerDomValue;
  page: HTMLElement;
  sampleSelect: HTMLSelectElement;
  backend: HTMLSelectElement;
  run: HTMLButtonElement;
  stop: HTMLButtonElement;
  status: HTMLElement;
  diagnostics: HTMLElement;
  console: HTMLElement;
  inputRow: HTMLElement;
  inputPrompt: HTMLElement;
  inputField: HTMLInputElement;
  outputNote: HTMLElement;
  blazorHost: HTMLElement;
  file: HTMLInputElement;
  newButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  outlineButton: HTMLButtonElement;
  editorHost: HTMLElement;
  outline: HTMLElement;
  outlineTitle: HTMLElement;
  outlineList: HTMLElement;
  outlineEmpty: HTMLElement;
  debugButton: HTMLButtonElement;
  debugToolbar: HTMLElement;
  debugPanel: HTMLElement;
  debugStack: HTMLElement;
  debugVariables: HTMLElement;
  debugToggle: HTMLButtonElement;
  debugToggleIcon: HTMLElement;
  debugStepOver: HTMLButtonElement;
  debugStepInto: HTMLButtonElement;
  debugStepOut: HTMLButtonElement;
  debugRestart: HTMLButtonElement;
  debugStop: HTMLButtonElement;
}

const shell = (window as typeof window & { SmallBasicRunHostShell?: ShellApi }).SmallBasicRunHostShell;
if (!shell) {
  throw new Error("SmallBasicRunHostShell 未加载，请先引入 shell-core.js。");
}
const shellApi: ShellApi = shell;

// UI hints follow the browser language (zh-* keeps the Chinese copy baked
// into the HTML; everything else gets English). See shell-core.js for the
// locale detection shared with the RunHost page.
const TEXT = (() => {
  const chinese = shellApi.isChineseLocale();
  return {
    fileProtocolBanner: () => chinese
      ? "当前页面通过 <code>file://</code> 打开。Playground 需要 HTTP 托管才能正确加载 Monaco Worker、TextMate WASM 与 Blazor WASM。请改用 <code>runhost\\web\\run.bat</code>、<code>runhost\\web\\run.ps1</code> 或 <code>node serve.mjs</code> 启动。"
      : 'This page was opened via <code>file://</code>. The playground needs an HTTP host to load the Monaco workers, the TextMate WASM and the Blazor WASM. Start it with <code>runhost\\web\\run.bat</code>, <code>runhost\\web\\run.ps1</code> or <code>node serve.mjs</code> instead.',
    languageServiceFailed: (message: string) => chinese
      ? `编辑器语言服务失败：${message}`
      : `The editor language service failed: ${message}`,
    confirmDiscard: () => chinese
      ? "当前内容尚未保存，继续操作会覆盖编辑器中的改动。是否继续？"
      : "Your current changes are not saved. Continuing will overwrite the editor content. Continue?",
    diagnosticsSummary: (count: number) => chinese ? `编辑期诊断（${count}）` : `Editor diagnostics (${count})`,
    diagnosticsMore: (count: number) => chinese ? `- … 另有 ${count} 条` : `- … ${count} more`,
    frameLabel: (name: string, monacoLine: number) => chinese
      ? `${name}（第 ${monacoLine} 行）`
      : `${name} (line ${monacoLine})`,
    emptyStack: chinese ? "程序未暂停。" : "The program is not paused.",
    emptyVariables: chinese ? "暂无局部变量。" : "No variables in scope.",
    editEndedSession: chinese ? "编辑已终止调试会话。" : "Editing ended the debug session.",
    backendUnavailable: (message: string) => chinese
      ? `无法启动调试后端：${message}`
      : `Failed to start the debug backend: ${message}`,
    titles: chinese
      ? {
          continue: "继续",
          pause: "暂停",
          stepOver: "单步跳过",
          stepInto: "单步进入",
          stepOut: "单步跳出",
          restart: "重启调试",
          stop: "停止",
          breakpoint: "断点"
        }
      : {
          continue: "Continue",
          pause: "Pause",
          stepOver: "Step Over",
          stepInto: "Step Into",
          stepOut: "Step Out",
          restart: "Restart Debugging",
          stop: "Stop",
          breakpoint: "Breakpoint"
        }
  };
})();

shellApi.applyStaticText({
  fileFieldTitle: "Open a local .sb file into the editor.",
  editorNote: "Shared VS Code language layer: diagnostics, completion, hover and signature help run offline in the browser.",
  outlineEmpty: "No navigable symbols in this document.",
  blazorError: "An unhandled error occurred while running the Small Basic Blazor WASM backend.",
  // Only applied for non-Chinese browsers; the HTML ships the Chinese copy.
  debugStackTitle: "Call Stack",
  debugVariablesTitle: "Variables"
});

const DIAGNOSTIC_OWNER = "smallbasic.language";
const DEFAULT_PROGRAM_NAME = "program.sb";
const NEW_FILE_TEMPLATE = [
  "' My first Small Basic program",
  'TextWindow.WriteLine("Hello World")'
].join("\n");

void bootstrap();

// Monaco spawns its editor worker lazily (links, word suggestions, ...); the
// ESM build only knows how to find it through MonacoEnvironment, resolved
// relative to this bundle so sub-directory deployments keep working.
(globalThis as typeof globalThis & { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new Worker(new URL("./editor/editor.worker.js", import.meta.url), { type: "module" })
};

async function bootstrap(): Promise<void> {
  const dom = bindDom();
  const controller = shellApi.createRunHostController({ dom });

  const state = {
    programs: [] as ShellProgram[],
    currentFileName: DEFAULT_PROGRAM_NAME,
    dirty: false,
    suppressDirty: false,
    diagnosticsVersion: 0,
    outlineVisible: false
  };

  controller.setStatus("Loading editor…");

  if (location.protocol === "file:") {
    controller.banner(TEXT.fileProtocolBanner());
    controller.setStatus("Needs a local server");
    return;
  }

  await registerSmallBasicLanguage(new URL("./editor/onig.wasm", import.meta.url).toString());
  const languageWorker = new Worker(new URL("./editor/language.worker.js", import.meta.url), { type: "module" });
  const client = new LanguageWorkerClient(languageWorker);
  // Hover/completion documentation follows the same locale decision as the
  // UI chrome (browser language, overridden by the header toggle).
  await client.configure(shellApi.isChineseLocale() ? "zh-CN" : "en-US");
  const providers = registerSmallBasicProviders(client);
  const model = monaco.editor.createModel("", "smallbasic", monaco.Uri.parse("file:///program.sb"));
  const editor = monaco.editor.create(dom.editorHost, {
    model,
    language: "smallbasic",
    automaticLayout: false,
    minimap: { enabled: false },
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    glyphMargin: true,
    folding: true,
    wordBasedSuggestions: "off",
    tabSize: 2,
    insertSpaces: true,
    fontSize: 14,
    lineHeight: 22,
    scrollBeyondLastLine: false,
    theme: PLAYGROUND_THEME
  });
  const resizeObserver = new ResizeObserver(() => editor.layout());
  resizeObserver.observe(dom.editorHost);

  await controller.probeJavaScriptBackend();

  // In-page debugging: gutter breakpoints + the floating step toolbar + the
  // stack/variables panel, over the web debug protocol. The JS engine runs in
  // this page; the Blazor engine runs in the WebAssembly component and is
  // reached through SetSession/DispatchDebugCommand interop.
  const debug = new PlaygroundDebugController({
    editor,
    model,
    shell: controller,
    dom: {
      debugButton: dom.debugButton,
      toolbar: dom.debugToolbar,
      panel: dom.debugPanel,
      stack: dom.debugStack,
      variables: dom.debugVariables,
      toggleButton: dom.debugToggle,
      toggleIcon: dom.debugToggleIcon,
      stepOverButton: dom.debugStepOver,
      stepIntoButton: dom.debugStepInto,
      stepOutButton: dom.debugStepOut,
      restartButton: dom.debugRestart,
      stopButton: dom.debugStop
    },
    labels: {
      frame: TEXT.frameLabel,
      emptyStack: TEXT.emptyStack,
      emptyVariables: TEXT.emptyVariables,
      editEndedSession: TEXT.editEndedSession,
      titles: TEXT.titles
    },
    sessionId: "playground",
    createTransport: async (backend: DebugBackendKind) => {
      if (backend === "blazor") {
        return new BlazorDebugTransport(
          {
            startBlazor: () => controller.startBlazor(),
            invoke: (method: string, ...args: unknown[]) => controller.invokeBlazor(method, ...args)
          },
          "playground"
        );
      }

      await controller.loadJavaScriptBackend();
      return new JsDebugTransport(webApi(), "playground");
    }
  });
  // Debug TextWindow output goes to the panel console (and stays mirrored to
  // F12); notifications fan out to both the shell statuses and the debugger.
  controller.onHostWrite = (text) => {
    controller.appendConsole(text, 15, 0);
    controller.mirrorToConsole(text);
  };
  controller.debugListener = (event) => debug.handleEvent(event);

  const syncDiagnostics = debounce(async () => {
    const version = model.getVersionId();
    try {
      const snapshot = await client.syncModel(model);
      if (snapshot.version !== model.getVersionId() || snapshot.version !== version) {
        return;
      }

      state.diagnosticsVersion = snapshot.version;
      monaco.editor.setModelMarkers(model, DIAGNOSTIC_OWNER, snapshot.diagnostics.map(toMarker));
      controller.setLanguageDiagnostics(formatDiagnostics(snapshot.diagnostics));
      providers.refreshSemanticTokens();
    } catch (error) {
      monaco.editor.setModelMarkers(model, DIAGNOSTIC_OWNER, []);
      controller.setLanguageDiagnostics(TEXT.languageServiceFailed(error instanceof Error ? error.message : String(error)));
    }
  }, 150);

  model.onDidChangeContent(() => {
    debug.onModelChanged();
    if (!state.suppressDirty) {
      state.dirty = true;
    }

    void syncDiagnostics();
  });

  editor.addAction({
    id: "smallbasic.playground.run",
    label: "Run Small Basic Program",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    run: async () => controller.runProgram(currentSnapshot(model, state.currentFileName))
  });

  editor.addAction({
    id: "smallbasic.playground.outline",
    label: "Show Small Basic Symbols",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO],
    run: async () => toggleOutline(dom, client, model, editor, state)
  });

  dom.run.addEventListener("click", () => {
    void controller.runProgram(currentSnapshot(model, state.currentFileName));
  });
  dom.stop.addEventListener("click", () => {
    if (debug.isActive) {
      debug.stop();
      return;
    }

    void controller.stopRun();
  });
  dom.debugButton.addEventListener("click", () => {
    void startDebugSession(controller, debug, currentSnapshot(model, state.currentFileName));
  });
  dom.debugToggle.addEventListener("click", () => debug.togglePause());
  dom.debugStepOver.addEventListener("click", () => debug.step("next"));
  dom.debugStepInto.addEventListener("click", () => debug.step("stepIn"));
  dom.debugStepOut.addEventListener("click", () => debug.step("stepOut"));
  dom.debugRestart.addEventListener("click", () => debug.restart());
  dom.debugStop.addEventListener("click", () => debug.stop());
  dom.backend.addEventListener("change", () => {
    controller.selectBackend(dom.backend.value);
  });
  dom.newButton.addEventListener("click", () => {
    void createNewProgram(controller, model, state, NEW_FILE_TEMPLATE, debug);
  });
  dom.file.addEventListener("change", async () => {
    const file = dom.file.files?.[0];
    dom.file.value = "";
    if (!file) {
      return;
    }

    if (!(await confirmDiscard(state))) {
      return;
    }

    const source = shellApi.stripBom(await file.text());
    debug.stop();
    if (controller.isRunning()) {
      await controller.stopRun();
    }

    await loadIntoEditor(model, state, file.name, source, controller, shellApi.detectGraphicsUsage(source));
  });
  dom.saveButton.addEventListener("click", () => {
    saveProgram(state.currentFileName, model.getValue());
  });
  dom.outlineButton.addEventListener("click", () => {
    void toggleOutline(dom, client, model, editor, state);
  });
  dom.sampleSelect.addEventListener("change", () => {
    void selectSample(dom.sampleSelect.value, controller, model, state, debug);
  });

  document.addEventListener("click", (event) => {
    if (!state.outlineVisible) {
      return;
    }

    if (dom.outline.contains(event.target as Node) || dom.outlineButton.contains(event.target as Node)) {
      return;
    }

    hideOutline(dom, state);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveProgram(state.currentFileName, model.getValue());
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      void toggleOutline(dom, client, model, editor, state);
      return;
    }

    if (event.key === "Escape" && state.outlineVisible) {
      hideOutline(dom, state);
      return;
    }

    // VS Code debug keys, captured only while a debug session is running so
    // the browser keeps its own F5 otherwise.
    if (!debug.isActive) {
      return;
    }

    if (event.key === "F5") {
      event.preventDefault();
      if (event.shiftKey) {
        debug.stop();
      } else {
        debug.togglePause();
      }
      return;
    }

    if (event.key === "F10") {
      event.preventDefault();
      debug.step("next");
      return;
    }

    if (event.key === "F11") {
      event.preventDefault();
      if (event.shiftKey) {
        debug.step("stepOut");
      } else {
        debug.step("stepIn");
      }
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) {
      return;
    }

    event.preventDefault();
    event.returnValue = "";
  });

  const manifest = await shellApi.loadProgramManifest();
  state.programs = manifest.items;
  populateSamples(dom.sampleSelect, manifest.items);
  const initial = manifest.items.find((item) => item.path === manifest.default) ?? manifest.items[0] ?? shellApi.FALLBACK_PROGRAM;
  if (state.programs.length === 0) {
    state.programs = [shellApi.FALLBACK_PROGRAM];
    populateSamples(dom.sampleSelect, state.programs);
  }
  await selectSample(initial.path, controller, model, state, debug);
  await syncDiagnostics();

  // Monaco measures itself once at creation; if the stylesheet or fonts were
  // still settling, the content area can end up 0-sized while the host is
  // fine. Re-layout after the first paint and once fonts are ready.
  editor.layout();
  void document.fonts?.ready.then(() => editor.layout());

  window.addEventListener("unload", () => {
    resizeObserver.disconnect();
    debug.dispose();
    providers.dispose();
    void client.disposeDocument(model.uri.toString()).catch(() => undefined);
    client.dispose();
    model.dispose();
    editor.dispose();
    controller.dispose();
  });
}

function bindDom(): DomHandles {
  const page = mustElement<HTMLElement>("web-runhost");
  return {
    page,
    sampleSelect: mustElement<HTMLSelectElement>("program-select"),
    backend: mustElement<HTMLSelectElement>("backend-select"),
    run: mustElement<HTMLButtonElement>("run-button"),
    stop: mustElement<HTMLButtonElement>("stop-button"),
    status: mustElement<HTMLElement>("status"),
    diagnostics: mustElement<HTMLElement>("diagnostics"),
    console: mustElement<HTMLElement>("console"),
    inputRow: mustElement<HTMLElement>("input-row"),
    inputPrompt: mustElement<HTMLElement>("input-prompt"),
    inputField: mustElement<HTMLInputElement>("input-field"),
    outputNote: mustElement<HTMLElement>("output-note"),
    blazorHost: mustElement<HTMLElement>("blazor-host"),
    file: mustElement<HTMLInputElement>("file-input"),
    newButton: mustElement<HTMLButtonElement>("new-button"),
    saveButton: mustElement<HTMLButtonElement>("save-button"),
    outlineButton: mustElement<HTMLButtonElement>("outline-button"),
    editorHost: mustElement<HTMLElement>("editor-host"),
    outline: mustElement<HTMLElement>("outline"),
    outlineTitle: mustElement<HTMLElement>("outline-title"),
    outlineList: mustElement<HTMLElement>("outline-list"),
    outlineEmpty: mustElement<HTMLElement>("outline-empty"),
    debugButton: mustElement<HTMLButtonElement>("debug-button"),
    debugToolbar: mustElement<HTMLElement>("debug-toolbar"),
    debugPanel: mustElement<HTMLElement>("debug-panel"),
    debugStack: mustElement<HTMLElement>("debug-stack"),
    debugVariables: mustElement<HTMLElement>("debug-variables"),
    debugToggle: mustElement<HTMLButtonElement>("debug-toggle"),
    debugToggleIcon: mustElement<HTMLElement>("debug-toggle-icon"),
    debugStepOver: mustElement<HTMLButtonElement>("debug-step-over"),
    debugStepInto: mustElement<HTMLButtonElement>("debug-step-into"),
    debugStepOut: mustElement<HTMLButtonElement>("debug-step-out"),
    debugRestart: mustElement<HTMLButtonElement>("debug-restart"),
    debugStop: mustElement<HTMLButtonElement>("debug-stop")
  };
}

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: #${id}`);
  }

  return element as T;
}

function populateSamples(select: HTMLSelectElement, programs: readonly ShellProgram[]): void {
  select.textContent = "";
  for (const program of programs) {
    const option = document.createElement("option");
    option.value = program.path;
    option.textContent = program.name || program.path;
    select.appendChild(option);
  }
}

async function selectSample(
  path: string,
  controller: RunHostController,
  model: monaco.editor.ITextModel,
  state: { programs: ShellProgram[]; currentFileName: string; dirty: boolean; suppressDirty: boolean; outlineVisible: boolean },
  debug: PlaygroundDebugController,
  skipConfirm = false
): Promise<void> {
  const program = state.programs.find((item) => item.path === path);
  if (!program) {
    return;
  }

  if (!skipConfirm && !(await confirmDiscard(state))) {
    return;
  }

  const resolved = await shellApi.ensureProgramSource(program);
  debug.stop();
  if (controller.isRunning()) {
    await controller.stopRun();
  }

  await loadIntoEditor(model, state, resolved.name, resolved.source ?? "", controller, resolved.graphics);
  const select = document.getElementById("program-select") as HTMLSelectElement | null;
  if (select) {
    select.value = resolved.path;
  }
}

async function loadIntoEditor(
  model: monaco.editor.ITextModel,
  state: { currentFileName: string; dirty: boolean; suppressDirty: boolean; outlineVisible: boolean },
  fileName: string,
  source: string,
  controller: RunHostController,
  graphics: boolean
): Promise<void> {
  state.suppressDirty = true;
  model.setValue(source);
  state.suppressDirty = false;
  state.currentFileName = fileName || DEFAULT_PROGRAM_NAME;
  state.dirty = false;
  controller.setStatus(`Loaded ${state.currentFileName}`);
  if (graphics) {
    controller.selectBackend(shellApi.BACKEND_BLAZOR);
  }
}

async function createNewProgram(
  controller: RunHostController,
  model: monaco.editor.ITextModel,
  state: { currentFileName: string; dirty: boolean; suppressDirty: boolean; outlineVisible: boolean },
  template: string,
  debug: PlaygroundDebugController
): Promise<void> {
  if (!(await confirmDiscard(state))) {
    return;
  }

  debug.stop();
  if (controller.isRunning()) {
    await controller.stopRun();
  }

  await loadIntoEditor(model, state, DEFAULT_PROGRAM_NAME, template, controller, false);
}

async function confirmDiscard(state: { dirty: boolean }): Promise<boolean> {
  if (!state.dirty) {
    return true;
  }

  return window.confirm(TEXT.confirmDiscard());
}

function currentSnapshot(model: monaco.editor.ITextModel, fileName: string): ProgramSnapshot {
  return {
    name: fileName || DEFAULT_PROGRAM_NAME,
    source: model.getValue(),
    modelVersion: model.getVersionId()
  };
}

function toMarker(diagnostic: LanguageDiagnostic): monaco.editor.IMarkerData {
  return {
    severity: monaco.MarkerSeverity.Error,
    message: diagnostic.message,
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.column + 1,
    endLineNumber: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.column + 1
  };
}

function formatDiagnostics(diagnostics: readonly LanguageDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }

  return [
    TEXT.diagnosticsSummary(diagnostics.length),
    ...diagnostics.slice(0, 5).map((item) => `- ${item.message}`),
    diagnostics.length > 5 ? TEXT.diagnosticsMore(diagnostics.length - 5) : ""
  ].filter(Boolean).join("\n");
}

function webApi(): SmallBasicWebApi {
  const api = (window as typeof window & { SmallBasicWeb?: SmallBasicWebApi }).SmallBasicWeb;
  if (!api) {
    throw new Error("smallbasic-js.js did not expose SmallBasicWeb.");
  }

  return api;
}

async function startDebugSession(
  controller: RunHostController,
  debug: PlaygroundDebugController,
  snapshot: ProgramSnapshot
): Promise<void> {
  try {
    await debug.start(snapshot.name, snapshot.source, controller.getBackend() === shellApi.BACKEND_BLAZOR ? "blazor" : "javascript");
  } catch (error) {
    controller.showRuntimeDiagnostics(TEXT.backendUnavailable(error instanceof Error ? error.message : String(error)));
    controller.setStatus("Failed");
  }
}

function saveProgram(fileName: string, source: string): void {  const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || DEFAULT_PROGRAM_NAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function toggleOutline(
  dom: Pick<DomHandles, "outline" | "outlineTitle" | "outlineList" | "outlineEmpty">,
  client: LanguageWorkerClient,
  model: monaco.editor.ITextModel,
  editor: monaco.editor.IStandaloneCodeEditor,
  state: { outlineVisible: boolean }
): Promise<void> {
  if (state.outlineVisible) {
    hideOutline(dom, state);
    return;
  }

  const symbols = await client.provideDocumentSymbols(model);
  dom.outlineList.textContent = "";
  dom.outlineEmpty.hidden = symbols.length > 0;
  for (const symbol of symbols) {
    renderOutlineSymbol(dom.outlineList, symbol, editor, state, 0);
  }

  dom.outlineTitle.textContent = "Quick Outline";
  dom.outline.hidden = false;
  state.outlineVisible = true;
}

function hideOutline(
  dom: Pick<DomHandles, "outline">,
  state: { outlineVisible: boolean }
): void {
  dom.outline.hidden = true;
  state.outlineVisible = false;
}

function renderOutlineSymbol(
  list: HTMLElement,
  symbol: LanguageDocumentSymbol,
  editor: monaco.editor.IStandaloneCodeEditor,
  state: { outlineVisible: boolean },
  depth: number
): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "web-outline-item";
  button.style.paddingLeft = `${12 + depth * 18}px`;
  button.textContent = `${symbol.kind === "sub" ? "ƒ" : "•"} ${symbol.name}`;
  button.addEventListener("click", () => {
    const lineNumber = symbol.selectionRange.start.line + 1;
    const column = symbol.selectionRange.start.column + 1;
    editor.focus();
    editor.setPosition({ lineNumber, column });
    editor.revealLineInCenter(lineNumber);
    state.outlineVisible = false;
    const outline = document.getElementById("outline");
    if (outline) {
      outline.hidden = true;
    }
  });
  list.appendChild(button);

  for (const child of symbol.children) {
    renderOutlineSymbol(list, child, editor, state, depth + 1);
  }
}

function debounce<T>(callback: () => Promise<T>, wait: number): () => Promise<T | undefined> {
  let timeout: number | undefined;
  let pending: Promise<T | undefined> | undefined;

  return () => {
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }

    pending = new Promise<T | undefined>((resolve) => {
      timeout = window.setTimeout(() => {
        timeout = undefined;
        void callback().then(resolve, () => resolve(undefined));
      }, wait);
    });

    return pending;
  };
}
