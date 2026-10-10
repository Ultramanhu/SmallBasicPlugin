import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import "./playground.css";
import type { LanguageDiagnostic, LanguageDocumentSymbol } from "smallbasic-language-services";
import {
  BlazorDebugTransport,
  JsDebugTransport,
  PlaygroundDebugController,
  type DebugBackendKind,
  type DebugEvent,
  type DebugTransport
} from "./debug-controller";
import { LanguageWorkerClient } from "../monaco/language-client";
import { PLAYGROUND_THEME, registerSmallBasicLanguage } from "../monaco/register-language";
import { registerSmallBasicProviders } from "../monaco/register-providers";
import { NEW_PROGRAM_TEMPLATE } from "../common/messages";
import { echoToConsole } from "./console-echo";

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
  registerCustomBackend(id: string, handler: PlaygroundBackendHandler): void;
  setSessionInputVisible(visible: boolean): void;
  /** Host notifications (web-debug protocol) drive status + debug routing. */
  handleHostNotification(message: DebugEvent): void;
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

interface SaveFilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: SaveFilePickerType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
}

/**
 * `showSaveFilePicker` belongs to the File System Access API: TypeScript's DOM
 * lib ships the handle/stream types but not the picker entry point, so it is
 * declared here. Chromium-only and secure-context-only; everywhere else the
 * save flow degrades to a download.
 */
interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}

/** Editor snapshot handed to run/debug entry points. */
export interface ProgramSnapshot {
  name: string;
  source: string;
  modelVersion?: number;
}

/**
 * A run backend registered by an embedder (currently the Tauri desktop shell,
 * doc 10 §19). The shell controller routes Run/Stop/stdin to it; debug
 * transports register separately through {@link PlaygroundGlobalApi}.
 */
export interface PlaygroundBackendHandler {
  label: string;
  /** Fixed note shown above the output pane while this backend is selected. */
  outputNote?: string;
  run?(snapshot: ProgramSnapshot): Promise<void>;
  stop?(): Promise<void>;
  onInput?(text: string): void;
}

/** The controller slice an embedder may drive. */
export interface PlaygroundControllerFacade {
  setStatus(text: string): void;
  setRunning(running: boolean): void;
  isRunning(): boolean;
  appendConsole(text: string, foreground: number, background: number): void;
  mirrorToConsole(text: string): void;
  showRuntimeDiagnostics(text: string): void;
  selectBackend(backend: string): void;
  getBackend(): string;
  /** Persistent stdin row for CLI run sessions. */
  setSessionInputVisible(visible: boolean): void;
}

/**
 * Localized status-line texts of the playground page. Embedders receive this
 * table through {@link PlaygroundContext.status} so the desktop CLI sessions
 * and native dialogs report progress in the same language as the page chrome
 * (see the `status` table in {@link TEXT}).
 */
export interface PlaygroundStatusText {
  loadingEditor: string;
  needsLocalServer: string;
  loaded(name: string): string;
  saved(name: string): string;
  failed: string;
  stopping: string;
  stopped: string;
  completed: string;
  exitedWithCode(code: number): string;
  startingDebugSession: string;
  debugSessionError: string;
  backendStarting(label: string): string;
  backendRunning(name: string): string;
  desktopBackendsUnavailable: string;
  editingEndedCliSession: string;
}

/**
 * An embedder backend that stages a compiled artifact instead of interpreting
 * the program: Run and Debug need an output directory before the session can
 * start. The page owns the field (visibility, rendering, the pre-run prompt)
 * and the embedder owns the native picker and the remembered value - design
 * doc 10, §19.5.
 */
export interface PlaygroundCompileDirectory {
  /** Backend id whose selection reveals the compile-directory field. */
  backend: string;
  /** The chosen directory, or null while the user has not picked one. */
  getDirectory(): string | null;
  /** Native folder picker; resolves the chosen directory, or null on cancel. */
  chooseDirectory(): Promise<string | null>;
}

export interface PlaygroundContext {
  controller: PlaygroundControllerFacade;
  /** Shared host-notification path: status bar + debug event routing. */
  notify(event: DebugEvent): void;
  debug: PlaygroundDebugController;
  model: monaco.editor.ITextModel;
  editor: monaco.editor.IStandaloneCodeEditor;
  state: { currentFileName: string; dirty: boolean };
  /** Status-line vocabulary shared with the embedder's own status writes. */
  status: PlaygroundStatusText;
  snapshot(): ProgramSnapshot;
}

/**
 * Extension surface of the playground page. The web build defines it but
 * nothing consumes it; the desktop entry (`smallbasic_playground_app`)
 * registers CLI backends, debug transports, native file dialogs, the compiler
 * backend's artifact directory and edit teardown hooks through it.
 */
export interface PlaygroundGlobalApi {
  whenReady: Promise<PlaygroundContext>;
  registerBackend(id: string, handler: PlaygroundBackendHandler): void;
  registerDebugBackend(id: string, factory: () => Promise<DebugTransport>): void;
  registerSaveHandler(handler: (name: string, source: string) => Promise<string | null>): void;
  registerCompileDirectory(binding: PlaygroundCompileDirectory | null): void;
  addModelChangedListener(listener: () => void): void;
  setGraphicsBackendResolver(resolver: (() => string | null) | null): void;
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
  compileDirectoryField: HTMLElement;
  compileDirectoryValue: HTMLElement;
  compileDirectoryButton: HTMLButtonElement;
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
    saveFailed: (message: string) => chinese ? `保存失败：${message}` : `Failed to save: ${message}`,
    saveFileType: chinese ? "Small Basic 程序" : "Small Basic program",
    compileDirectoryEmpty: chinese ? "未选择" : "Not set",
    /**
     * Status-line vocabulary. shell-core.js localizes everything the shell
     * writes itself; this table covers the strings this page writes plus the
     * ones its embedders write (the Tauri desktop entry, whose CLI sessions and
     * native dialogs reuse it through `PlaygroundContext.status`).
     */
    status: (chinese
      ? {
          loadingEditor: "正在加载编辑器…",
          needsLocalServer: "需要本地服务器",
          loaded: (name: string) => `已加载 ${name}`,
          saved: (name: string) => `已保存 ${name}`,
          failed: "失败",
          stopping: "正在停止…",
          stopped: "已停止",
          completed: "已完成",
          exitedWithCode: (code: number) => `已退出，代码 ${code}`,
          startingDebugSession: "正在启动调试会话…",
          debugSessionError: "调试会话错误。",
          backendStarting: (label: string) => `正在启动 ${label}…`,
          backendRunning: (name: string) => `正在运行 ${name}…`,
          desktopBackendsUnavailable: "桌面后端不可用",
          editingEndedCliSession: "编辑已终止 CLI 会话。"
        }
      : {
          loadingEditor: "Loading editor…",
          needsLocalServer: "Needs a local server",
          loaded: (name: string) => `Loaded ${name}`,
          saved: (name: string) => `Saved ${name}`,
          failed: "Failed",
          stopping: "Stopping…",
          stopped: "Stopped",
          completed: "Completed",
          exitedWithCode: (code: number) => `Exited with code ${code}`,
          startingDebugSession: "Starting debug session…",
          debugSessionError: "Debug session error.",
          backendStarting: (label: string) => `Starting ${label}…`,
          backendRunning: (name: string) => `Running ${name}…`,
          desktopBackendsUnavailable: "Desktop backends unavailable",
          editingEndedCliSession: "Editing ended the CLI session."
        }),
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
  sampleLabel: "Sample",
  newButton: "New",
  fileField: "Open…",
  fileFieldTitle: "Open a local .sb file into the editor.",
  saveButton: "Save",
  outlineButton: "Symbols",
  backendLabel: "Backend",
  backendJavaScript: "JavaScript (TextWindow)",
  backendBlazor: "Blazor WASM (GraphicsWindow)",
  runButton: "Run",
  debugButton: "Debug",
  debugButtonTitle: "Run with the debugger (breakpoints)",
  stopButton: "Stop",
  statusReady: "Ready",
  editorTitle: "Editor",
  editorNote: "Shared VS Code language layer: diagnostics, completion, hover and signature help run offline in the browser.",
  outputTitle: "Output",
  inputPromptRead: "Read",
  sendButton: "Send",
  outlineTitle: "Quick Outline",
  outlineEmpty: "No navigable symbols in this document.",
  blazorError: "An unhandled error occurred while running the Small Basic Blazor WASM backend.",
  // Only revealed by an embedder that registers a compiler backend
  // (`registerCompileDirectory`); the HTML ships the Chinese copy.
  compileDirectoryLabel: "Compile directory",
  compileDirectoryChange: "Change…",
  compileDirectoryTitle: "Output folder for the compiled EXE.",
  // Only applied for non-Chinese browsers; the HTML ships the Chinese copy.
  debugStackTitle: "Call Stack",
  debugVariablesTitle: "Variables",
  reloadButton: "Reload"
});

const DIAGNOSTIC_OWNER = "smallbasic.language";
const DEFAULT_PROGRAM_NAME = "program.sb";
const NEW_FILE_TEMPLATE = NEW_PROGRAM_TEMPLATE;

// Extension surface for embedders (currently the Tauri desktop shell, doc 10
// §19). The web build defines the API but nothing registers through it, so
// the page behaves exactly like before; the staged desktop entry attaches
// the CLI backends while bootstrap is still loading.
let resolveReady: ((context: PlaygroundContext) => void) | undefined;
const whenReady = new Promise<PlaygroundContext>((resolve) => {
  resolveReady = resolve;
});
/**
 * The live controller, once bootstrap built it. Embedders that await
 * {@link PlaygroundGlobalApi.whenReady} register *after* bootstrap has drained
 * the queued backends, so late registrations must be forwarded here or the CLI
 * options never reach the backend `<select>`.
 */
let controllerRef: RunHostController | null = null;
const customBackends = new Map<string, PlaygroundBackendHandler>();
const debugBackendFactories = new Map<string, () => Promise<DebugTransport>>();
const modelChangeListeners = new Set<() => void>();
let saveHandlerOverride: ((name: string, source: string) => Promise<string | null>) | null = null;
let graphicsBackendResolver: (() => string | null) | null = null;
/**
 * Compiler backend binding registered by an embedder, plus the bootstrap-owned
 * renderer for the compile-directory field. Both stay null in the browser
 * build, so the field never leaves its `hidden` state there.
 */
let compileDirectoryBinding: PlaygroundCompileDirectory | null = null;
let refreshCompileDirectory: (() => void) | null = null;
/**
 * Target chosen through the File System Access picker, reused so later saves
 * (Ctrl+S) overwrite the same file instead of re-opening the dialog. Cleared
 * whenever another document is loaded into the editor.
 */
let saveFileHandle: FileSystemFileHandle | null = null;

(window as typeof window & { SmallBasicPlayground?: PlaygroundGlobalApi }).SmallBasicPlayground = {
  whenReady,
  registerBackend(id: string, handler: PlaygroundBackendHandler): void {
    customBackends.set(id, handler);
    // The desktop entry registers through this API only after `whenReady`
    // resolved, i.e. after bootstrap drained the map above - without this
    // forwarding the CLI backends stay invisible (doc 10, §19.3 phase 2).
    controllerRef?.registerCustomBackend(id, handler);
  },
  registerDebugBackend(id: string, factory: () => Promise<DebugTransport>): void {
    debugBackendFactories.set(id, factory);
  },
  registerSaveHandler(handler: (name: string, source: string) => Promise<string | null>): void {
    saveHandlerOverride = handler;
  },
  registerCompileDirectory(binding: PlaygroundCompileDirectory | null): void {
    compileDirectoryBinding = binding;
    refreshCompileDirectory?.();
  },
  addModelChangedListener(listener: () => void): void {
    modelChangeListeners.add(listener);
  },
  setGraphicsBackendResolver(resolver: (() => string | null) | null): void {
    graphicsBackendResolver = resolver;
  }
};

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
  controllerRef = controller;
  // Embedders may have queued backend registrations while the page loaded.
  for (const [id, handler] of customBackends) {
    controller.registerCustomBackend(id, handler);
  }

  /**
   * Reveals the compile-directory field while the embedder's compiler backend
   * is the selected one, and renders the remembered directory. Registered as a
   * hook so `registerCompileDirectory` (which runs after `whenReady`) can
   * refresh the row without owning the DOM.
   */
  const renderCompileDirectory = (): void => {
    const binding = compileDirectoryBinding;
    const visible = binding !== null && binding.backend === controller.getBackend();
    dom.compileDirectoryField.hidden = !visible;
    if (!binding || !visible) {
      return;
    }

    const directory = binding.getDirectory();
    const text = directory ?? TEXT.compileDirectoryEmpty;
    dom.compileDirectoryValue.textContent = text;
    dom.compileDirectoryValue.title = text;
  };
  refreshCompileDirectory = renderCompileDirectory;

  /**
   * Run and Debug gate on the artifact directory: a compiler backend cannot
   * start without one, so the page opens the native folder picker itself when
   * the field is still empty and aborts when the user dismisses it (the next
   * attempt asks again). Every other backend - and the web build, which has no
   * binding at all - passes straight through.
   */
  const ensureCompileDirectory = async (): Promise<boolean> => {
    const binding = compileDirectoryBinding;
    if (!binding || binding.backend !== controller.getBackend()) {
      return true;
    }

    if (!binding.getDirectory()) {
      await binding.chooseDirectory();
    }

    renderCompileDirectory();
    return binding.getDirectory() !== null;
  };

  const state = {
    programs: [] as ShellProgram[],
    currentFileName: DEFAULT_PROGRAM_NAME,
    dirty: false,
    suppressDirty: false,
    diagnosticsVersion: 0,
    outlineVisible: false
  };

  controller.setStatus(TEXT.status.loadingEditor);

  if (location.protocol === "file:") {
    controller.banner(TEXT.fileProtocolBanner());
    controller.setStatus(TEXT.status.needsLocalServer);
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
  // The probe may have dropped the JavaScript option and re-selected Blazor.
  renderCompileDirectory();

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
      titles: TEXT.titles,
      startingSession: TEXT.status.startingDebugSession,
      failed: TEXT.status.failed,
      stopped: TEXT.status.stopped,
      sessionError: TEXT.status.debugSessionError
    },
    sessionId: "playground",
    createTransport: async (backend: DebugBackendKind) => {
      // CLI backends registered by the desktop shell take precedence.
      const factory = debugBackendFactories.get(backend);
      if (factory) {
        return factory();
      }

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
    echoToConsole(controller, text);
  };
  controller.debugListener = (event) => debug.handleEvent(event);

  // Save prefers the File System Access picker so the user can choose (and
  // keep) a real target file; an embedder (desktop shell) still wins with a
  // native dialog through registerSaveHandler, and browsers without the picker
  // (Firefox/Safari) fall back to the classic download.
  const saveProgram = async (): Promise<void> => {
    const fileName = state.currentFileName;
    const source = model.getValue();
    if (saveHandlerOverride) {
      const saved = await saveHandlerOverride(fileName, source);
      if (saved) {
        state.currentFileName = saved;
        controller.setStatus(TEXT.status.saved(saved));
      }
      return;
    }

    const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
    if (typeof picker !== "function") {
      downloadProgram(fileName, source);
      return;
    }

    let handle = saveFileHandle;
    if (handle && !(await ensureWritePermission(handle))) {
      handle = null;
      saveFileHandle = null;
    }

    // Only a fresh document opens the dialog; subsequent saves reuse the
    // granted handle so Ctrl+S writes straight back to the chosen file.
    if (!handle) {
      try {
        handle = await picker.call(window, {
          suggestedName: fileName || DEFAULT_PROGRAM_NAME,
          types: [{
            description: TEXT.saveFileType,
            accept: { "text/plain": [".sb", ".txt"] }
          }]
        });
        saveFileHandle = handle;
      } catch (error) {
        // Dismissing the dialog is a normal outcome and must not trigger a
        // surprise download; anything else means the picker is unusable here
        // (permissions policy, insecure context, ...), so keep the classic
        // download rather than leaving the user without a way to save.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        downloadProgram(fileName, source);
        return;
      }
    }

    try {
      const writable = await handle.createWritable();
      await writable.write(source);
      await writable.close();

      state.currentFileName = handle.name || fileName || DEFAULT_PROGRAM_NAME;
      state.dirty = false;
      controller.setStatus(TEXT.status.saved(state.currentFileName));
    } catch (error) {
      controller.showRuntimeDiagnostics(TEXT.saveFailed(error instanceof Error ? error.message : String(error)));
    }
  };

  const compileDirectoryChoice = async (): Promise<void> => {
    await compileDirectoryBinding?.chooseDirectory();
    renderCompileDirectory();
  };

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

    for (const listener of modelChangeListeners) {
      listener();
    }
    void syncDiagnostics();
  });

  /** Run entry point: the artifact directory is settled before anything runs. */
  const runProgram = async (): Promise<void> => {
    if (!(await ensureCompileDirectory())) {
      return;
    }

    await controller.runProgram(currentSnapshot(model, state.currentFileName));
  };

  /** Debug entry point; restarting reuses the directory this one settled on. */
  const debugProgram = async (): Promise<void> => {
    if (!(await ensureCompileDirectory())) {
      return;
    }

    await startDebugSession(controller, debug, currentSnapshot(model, state.currentFileName));
  };

  editor.addAction({
    id: "smallbasic.playground.run",
    label: "Run Small Basic Program",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    run: runProgram
  });

  editor.addAction({
    id: "smallbasic.playground.outline",
    label: "Show Small Basic Symbols",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO],
    run: async () => toggleOutline(dom, client, model, editor, state)
  });

  dom.run.addEventListener("click", () => {
    void runProgram();
  });
  dom.stop.addEventListener("click", () => {
    if (debug.isActive) {
      debug.stop();
      return;
    }

    void controller.stopRun();
  });
  dom.debugButton.addEventListener("click", () => {
    void debugProgram();
  });
  dom.debugToggle.addEventListener("click", () => debug.togglePause());
  dom.debugStepOver.addEventListener("click", () => debug.step("next"));
  dom.debugStepInto.addEventListener("click", () => debug.step("stepIn"));
  dom.debugStepOut.addEventListener("click", () => debug.step("stepOut"));
  dom.debugRestart.addEventListener("click", () => debug.restart());
  dom.debugStop.addEventListener("click", () => debug.stop());
  dom.backend.addEventListener("change", () => {
    controller.selectBackend(dom.backend.value);
    renderCompileDirectory();
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

    await loadIntoEditor(model, state, file.name, source, controller, shellApi.detectGraphicsUsage(source), graphicsBackendResolver);
  });
  dom.saveButton.addEventListener("click", () => {
    void saveProgram();
  });
  dom.compileDirectoryButton.addEventListener("click", () => {
    void compileDirectoryChoice();
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
      void saveProgram();
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

  resolveReady?.({
    controller,
    notify: (event) => controller.handleHostNotification(event),
    debug,
    model,
    editor,
    state,
    status: TEXT.status,
    snapshot: () => currentSnapshot(model, state.currentFileName)
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
    compileDirectoryField: mustElement<HTMLElement>("compile-directory-field"),
    compileDirectoryValue: mustElement<HTMLElement>("compile-directory"),
    compileDirectoryButton: mustElement<HTMLButtonElement>("compile-directory-button"),
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

  await loadIntoEditor(model, state, resolved.name, resolved.source ?? "", controller, resolved.graphics, graphicsBackendResolver);
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
  graphics: boolean,
  graphicsResolver: (() => string | null) | null
): Promise<void> {
  state.suppressDirty = true;
  model.setValue(source);
  state.suppressDirty = false;
  // The editor now holds a different document, so a previous picker handle no
  // longer describes it; the next save opens the dialog again.
  saveFileHandle = null;
  state.currentFileName = fileName || DEFAULT_PROGRAM_NAME;
  state.dirty = false;
  controller.setStatus(TEXT.status.loaded(state.currentFileName));
  if (graphics) {
    // Embedders may prefer a graphics-capable CLI backend (native
    // GraphicsWindow on Windows); the web default stays Blazor WASM.
    controller.selectBackend(graphicsResolver?.() ?? shellApi.BACKEND_BLAZOR);
    // The selected backend may have just changed under the compile-directory
    // field (a graphics program auto-selects a native host).
    refreshCompileDirectory?.();
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

  await loadIntoEditor(model, state, DEFAULT_PROGRAM_NAME, template, controller, false, graphicsBackendResolver);
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

/** Classic save fallback: the browser drops the file in its downloads folder. */
function downloadProgram(fileName: string, source: string): void {
  const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || DEFAULT_PROGRAM_NAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * `queryPermission`/`requestPermission` are Chromium extensions on the file
 * handle that lib.dom does not model, so they are probed structurally. When
 * they are absent the write is attempted as-is.
 */
async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const permissionHandle = handle as FileSystemFileHandle & {
    queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
    requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  };

  if (typeof permissionHandle.queryPermission !== "function") {
    return true;
  }

  let permission = await permissionHandle.queryPermission({ mode: "readwrite" });
  if (permission === "prompt" && typeof permissionHandle.requestPermission === "function") {
    permission = await permissionHandle.requestPermission({ mode: "readwrite" });
  }

  return permission === "granted";
}

async function startDebugSession(
  controller: RunHostController,
  debug: PlaygroundDebugController,
  snapshot: ProgramSnapshot
): Promise<void> {
  try {
    // Desktop-registered CLI backends flow through the same path; the
    // controller's transport registry resolves them (doc 10, §18.3).
    await debug.start(snapshot.name, snapshot.source, controller.getBackend());
  } catch (error) {
    controller.showRuntimeDiagnostics(TEXT.backendUnavailable(error instanceof Error ? error.message : String(error)));
    controller.setStatus(TEXT.status.failed);
  }
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

  // The dialog title is never rewritten here: playground.html ships the
  // localized copy (data-i18n="outlineTitle") and shell-core.js already swapped
  // it for English when the UI language is not Chinese.
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
  button.textContent = `${symbol.kind === "sub" || symbol.kind === "function" ? "ƒ" : "•"} ${symbol.name}`;
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
