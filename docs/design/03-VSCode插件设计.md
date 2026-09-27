# 03 VS Code 插件设计

落地目录：`visual_studio_code_plugin/`。目标：发布到 VS Code Marketplace 的扩展，支持 `.sb` 文件创建、着色、IntelliSense、运行、调试。

> **2026-09-28 现状校准**
>
> - monorepo 实际只有两个包：`packages/smallbasic-lang-core`（语言核心，仅再导出 `vendor/SmallBasicOnline` 并补充调试表达式求值）与 `packages/smallbasic-vscode`（扩展本体，调试适配器内嵌其中）。**没有**独立的 `sb-debug` 包，也**没有** `conformance/` 目录。
> - 扩展同时提供桌面入口（`src/extension.ts`）与 Web 入口（`src/web/extension.ts`，清单 `browser` 字段）；Web 端只支持 JavaScript 后端。
> - 已实现：`.sb` 关联、TextMate + 语义令牌双层着色、诊断、悬停、上下文补全、文档大纲（Sub 与变量首次使用）、调试内联值、`TextWindow` 文本运行，以及 **JS / C# / Blazor 三后端**的运行与调试。
> - 运行是三个**显式命令**（不再有统一的 `smallbasic.run`，也没有 `smallbasic.backend` 设置）：
>   - `smallbasic.runJavaScript` —— 内置 JS 引擎，跨平台（含 VS Code for the Web），无图形能力；
>   - `smallbasic.runCSharp` —— 内置 .NET 宿主：Windows 为 `net8.0-windows` 图形宿主，其它平台为 `net8.0` 便携文本宿主；
>   - `smallbasic.runBlazor` —— 跨平台；文本程序留在终端，图形程序才打开浏览器 WASM 页面。
> - 调试在 `launch.json` 用 `backend = "javascript" | "csharp" | "blazor"` 选择；缺省规则为「Windows 且有 C# 宿主 → `csharp`，否则 `javascript`」，Blazor 仅支持显式指定。设置项为 `smallbasic.diagnostics.debounceMs`、`smallbasic.csharp.runHostPath`、`smallbasic.blazor.runHostPath`。
> - 未实现：定义跳转、引用、重命名、签名帮助、折叠等（原方案的若干“二期”项）。

## 1. 工程结构

采用 monorepo（npm workspaces + tsup 打包 + 仓库根 vitest）：

```
visual_studio_code_plugin/
├── package.json                  # workspaces 根（build / typecheck / test / package:vsix）
├── tsconfig.base.json
├── vitest.config.ts              # 收集 packages/**/*.spec.ts
├── vendor/
│   └── SmallBasicOnline/         # 拷贝升级自 official_repo/online（src/compiler + src/strings + tests/compiler）
│       └── UPSTREAM.md           # 来源路径与拷贝日期
├── packages/
│   ├── smallbasic-lang-core/     # 语言核心：再导出 vendor 编译器 + 调试表达式求值
│   │   ├── src/index.ts          # 公共出口：Compilation/ExecutionEngine/services/类型
│   │   ├── src/debug-expression.ts  # 断点条件与求值表达式的编译/执行
│   │   ├── tests/                # runtime-compat / completion-regressions / vendor tests-list
│   │   └── package.json          # 零依赖纯 TS 包（main 直指 src/index.ts）
│   └── smallbasic-vscode/        # VS Code 扩展本体（调试适配器内嵌）
│       ├── package.json          # 扩展清单（contributes 见 §3）
│       ├── src/
│       │   ├── extension.ts      # 桌面入口（activate/deactivate）
│       │   ├── common/activation.ts   # 跨平台公共激活与运行逻辑
│       │   ├── web/extension.ts       # Web 入口（browser 字段，仅 JS 后端）
│       │   ├── language/         # 补全/悬停/诊断/语义令牌/文档大纲
│       │   ├── run/              # JS 终端会话 + C# / Blazor 运行后端
│       │   ├── runhost/main.ts   # 独立 Node CLI 运行宿主（产物 dist/runhost.js）
│       │   └── debug/            # 内嵌 DAP 调试适配器（session/factory/inline-values）
│       ├── syntaxes/smallbasic.tmLanguage.json   # TextMate 语法
│       ├── language-configuration.json           # 括号/注释/缩进规则
│       ├── snippets/smallbasic.json
│       ├── runhost/              # 暂存的 windows / portable / blazor 宿主载荷
│       └── media/                # 图标
├── scripts/                      # package-vsix.mjs / stage-runhost.mjs
└── build/                        # Package-Vsix.ps1 与产出的 vsix
```

## 2. smallbasic-lang-core：语言核心的接入

**消费方式**：`SmallBasicOnline` 的源码**拷贝**到 `vendor/SmallBasicOnline`（含 `UPSTREAM.md`）脱离上游独立维护（ADR-4），不用子模块/npm 外链；`packages/smallbasic-lang-core` 仅作为**再导出层**——`src/index.ts` 从 vendor 转出 `Compilation`/`ExecutionEngine`/服务/类型，并新增 `src/debug-expression.ts`（断点条件与求值表达式的编译/执行）。

**拷贝范围**：

| 拷贝 | 不拷贝 |
|---|---|
| `src/compiler/**`（syntax/binding/emitting/runtime/services/utils） | `src/app`（React/Monaco UI）、`electron/`、`build/`、webpack/gulp 配置 |
| `src/strings/**`（编译器/诊断/文档本地化文案） | |
| `tests/compiler/**` | app 相关测试无（测试仅覆盖 compiler） |

**升级清单**（适配最新编译器与运行时）：

| 项 | 从 | 到 |
|---|---|---|
| TypeScript | 2.5.3 | **5.9.x**，`tsc --noEmit` 类型检查 + tsup（esbuild）打包 |
| 模块系统 | namespace + webpack 3 | ESM 源码（扩展打包时由 tsup 转 CJS 单文件） |
| 运行时基线 | Node 8 时代 | **Node 20 LTS**（VS Code 1.96+ 扩展宿主内置） |
| 测试 | jasmine 2.8 + webpack bundle | 仓库根 **vitest**（`tests/legacy-compiler.spec.ts` 直接 import vendor 的 `tests-list`；另有 `runtime-compat` 等补充用例） |
| 依赖 | pubsub-js | 保留 |
| 代码质量 | tslint 5.7 | 类型检查即 lint（`npm run lint` 复用 `tsc --noEmit`，未引入 eslint） |
| 严格模式 | 无 | tsconfig 开启 `strict` |

**验收**：vendor 的 `tests/compiler` 用例在 vitest 下通过（覆盖 scanner/parser/binder/runtime/services，是回归安全网）；升级阶段**零语义改动**。

**对外 API 冻结层**（`index.ts`）：`Compilation`、`ExecutionEngine`、`ExecutionMode/State`、`CompletionService`、`HoverService`、`Diagnostic/CompilerPosition/CompilerRange`、`ITextWindowLibraryPlugin`/`IGraphicsWindowLibraryPlugin`/`IShapesLibraryPlugin` 等宿主接口，以及 `compileDebugExpression`/`evaluateDebugCondition`/`evaluateDebugExpression` 与 `setDocumentationLocale`。扩展与适配器只依赖此出口。

## 3. 扩展清单（package.json contributes）

```jsonc
{
  "main": "./dist/extension.js",
  "browser": "./dist/web/extension.js",          // Web 入口（仅 JS 后端）
  "engines": { "vscode": "^1.96.0" },
  "capabilities": { "virtualWorkspaces": true },
  "activationEvents": ["onLanguage:smallbasic"],
  "contributes": {
    "languages": [{
      "id": "smallbasic",
      "aliases": ["SmallBasic", "smallbasic"],
      "extensions": [".sb"],
      "configuration": "./language-configuration.json",
      "icon": { "light": "./media/SmallBasic.svg", "dark": "./media/SmallBasic.svg" }
    }],
    "breakpoints": [{ "language": "smallbasic" }],
    "grammars": [{
      "language": "smallbasic",
      "scopeName": "source.smallbasic",
      "path": "./syntaxes/smallbasic.tmLanguage.json"
    }],
    "snippets": [{ "language": "smallbasic", "path": "./snippets/smallbasic.json" }],
    "commands": [
      { "command": "smallbasic.newFile",       "title": "SmallBasic: New File" },
      { "command": "smallbasic.runJavaScript", "title": "SmallBasic: Run with JavaScript Backend", "icon": "$(play)" },
      { "command": "smallbasic.runCSharp",     "title": "SmallBasic: Run with C# Backend",         "icon": "$(play)" },
      { "command": "smallbasic.runBlazor",     "title": "SmallBasic: Run with Blazor Backend",     "icon": "$(play)" }
    ],
    "menus": {
      "editor/title/run": [
        { "command": "smallbasic.runJavaScript", "when": "resourceLangId == smallbasic" },
        { "command": "smallbasic.runCSharp",     "when": "resourceLangId == smallbasic && !isWeb" },
        { "command": "smallbasic.runBlazor",     "when": "resourceLangId == smallbasic && !isWeb" }
      ],
      "explorer/context": [{ "command": "smallbasic.newFile", "when": "explorerResourceIsFolder" }]
    },
    "debuggers": [{ "type": "smallbasic", ... }],   // 详见 05 文档
    "configuration": { "properties": {
      "smallbasic.diagnostics.debounceMs": { "type": "number", "default": 150, "minimum": 0 },
      "smallbasic.csharp.runHostPath": { "type": "string", "default": "",
        "description": "SmallBasic.RunHost 路径；为空时使用扩展内置宿主" },
      "smallbasic.blazor.runHostPath": { "type": "string", "default": "",
        "description": "SmallBasic.Blazor.RunHost 路径；为空时使用扩展内置宿主" }
    }}
  }
}
```

`language-configuration.json`：注释 `'`，括号配对，缩进规则（`If/For/While/Sub` 增、`EndIf/EndFor/EndWhile/EndSub/Else/ElseIf` 减），`wordPattern`（SB 标识符支持非 ASCII，数组用 `arr["k"]`）。

## 4. 语法着色（双层）

**第 1 层 TextMate**（`syntaxes/smallbasic.tmLanguage.json`，零运行时成本）：

| 类别 | 模式 |
|---|---|
| `keyword`（控制流/逻辑） | `If Then Else ElseIf EndIf For To Step EndFor While EndWhile Sub EndSub GoTo And Or` |
| 字符串 | `"..."`（SB 无转义，`""` 表引号） |
| 数字 | 数字字面量 |
| 注释 | `' ...` |
| 库类型名 | 语法内列举的部分库对象名（当前为 `Array/Clock/Controls/Math/Program/Shapes/Stack/Text/TextWindow/Turtle`） |

**第 2 层语义令牌**（`DocumentSemanticTokensProvider`，基于 `Compilation.tokens` 与绑定结果）：legend 为 `keyword/comment/string/number/class/function/variable`。区分 **变量 vs 库对象 vs 子程序**：库元数据中的标识符 → `class`，已绑定的子过程 → `function`，其余标识符 → `variable`。TextMate 负责静态词法着色，语义令牌补齐上下文区分。

性能：语义令牌以文档版本缓存 Compilation，与诊断共享同一份编译结果（见 §7）。

## 5. IntelliSense 映射

| VS Code API | 实现来源 | 要点 |
|---|---|---|
| `CompletionItemProvider` | `CompletionService.provideCompletion(compilation, pos)` + 上下文补全 | 触发字符 `.`、字母与 `_`；非成员位置叠加块结束补全（`EndIf/ElseIf/Else/EndFor/...`）与基线补全；库成员项附签名与文档文案；用 `CompletionItem.range` 精确替换 |
| `HoverProvider` | `HoverService.provideHover(...)` | Markdown 输出；诊断处悬停优先展示错误 |
| `DiagnosticCollection` | `compilation.diagnostics` | `CompilerRange`(0-based) → `vscode.Range` 直接映射；severity 全为 error（SB 编译器只产 error） |
| `DocumentSymbolProvider` | AST 遍历 Sub + 变量首次使用 | 已实现：大纲列出每个 `Sub…EndSub` 及其作用域内首次出现的变量 |
| `InlineValuesProvider` | 调试会话变量 | 已实现：断点暂停时在编辑器内联显示相关变量值 |

**尚未实现**：`SignatureHelpProvider`（签名帮助）、`DefinitionProvider`（定义跳转）、引用/重命名等（原方案的若干“二期”项）。

坐标转换统一封装在 `util/positions.ts`：compiler 0-based ↔ VS Code 0-based（**同基，仅类型转换**，比 Monaco 时代还简单）。

补全/悬停的文档文案来自 vendor 的本地化资源（`vendor/SmallBasicOnline/src/strings/documentation*.ts`）：扩展激活时调用 `setDocumentationLocale(resolveDocumentationLocale(vscode.env.language))`，按 VS Code UI 语言选择文案，取不到时回退内置英文。**没有** `data/library-docs.json` 之类的构建期产物。

## 6. 新建文件

- 命令 `smallbasic.newFile`：在资源管理器选中目录下创建 `Untitled-N.sb`/指定文件名，写入模板（`' My first Small Basic program` + `TextWindow.WriteLine("Hello World")`），打开并聚焦。
- snippets：当前提供 `if`、`for`、`hello` 三个前缀片段（`snippets/smallbasic.json`）。
- 欢迎页（Walkthrough，二期）：新建文件 → 运行 → 调试三步引导。

## 7. 编译缓存与防抖（性能关键路径）

```ts
// util/compilation-cache.ts 设计
class CompilationCache {
  private cache = new Map<string, { version: number; compilation: Compilation }>();
  get(doc: vscode.TextDocument): Compilation {
    const hit = this.cache.get(doc.uri.toString());
    if (hit && hit.version === doc.version) return hit.compilation;
    const c = new Compilation(doc.getText());   // 同步全量编译，SB 程序规模下 <10ms
    this.cache.set(doc.uri.toString(), { version: doc.version, compilation: c });
    return c;
  }
}
```

- **诊断**：`onDidChangeTextDocument` → 防抖 150ms → 全量重建 + 发布。
- **补全/悬停**：同步路径直接取缓存编译结果（通常命中，零等待）。
- **失效**：`onDidCloseTextDocument` 清条目，防止泄漏。
- 大文件（>5 万行，极端情况）二期迁 web worker；MVP 不测此路径。

## 8. 运行（非调试）

运行是三个**显式命令**（无统一入口，也无 `smallbasic.backend` 设置）：

**`smallbasic.runJavaScript`（内置 JS 引擎）**：

1. 保存文档 → `new Compilation(text)`；`!isReadyToRun` 或有诊断 → 在问题面板提示，不运行。
2. 若程序 `compilation.kind.drawsShapes()`（用图形库）→ 主动拒绝并提示改用 C# / Blazor 后端。
3. 创建 VS Code **Terminal**（`Pseudoterminal` 实现），实例化 `ExecutionEngine` 与 `ITextWindowLibraryPlugin` 的终端实现（`src/run/terminal-session.ts`）：`writeText` → PTY 写、`inputIsNeeded/checkInputBuffer` → PTY 行缓冲读、颜色 → ANSI。
4. 同一 CLI 契约另有独立的 Node 运行宿主 `dist/runhost.js`（`run --file <f.sb> [--pause]`），供 VS 侧 JS 后端复用。

**`smallbasic.runCSharp`（.NET 引擎）**：

1. 通过 `smallbasic.csharp.runHostPath` 或内置 `runhost/`（Windows 用 `windows/SmallBasic.RunHost.exe`，其它平台用 `portable/SmallBasic.RunHost.dll`）定位宿主；找不到则提示安装 .NET 8 或配置路径。
2. 终端中执行宿主 `run --file "<path>.sb" --pause`：`ConsoleTextWindowLibrary` 读写该终端；Windows 图形宿主内置官方 `Microsoft.SmallBasic.Library` 的 `GraphicsWindow/Shapes/Turtle`。

**`smallbasic.runBlazor`（跨平台图形后端）**：

1. 通过 `smallbasic.blazor.runHostPath` 或内置 `runhost/blazor/SmallBasic.Blazor.RunHost.dll` 定位宿主。
2. 执行 `dotnet SmallBasic.Blazor.RunHost.dll run --file "<path>.sb"`：文本程序直接在终端跑；图形程序启动本机 Kestrel 并打开浏览器 WASM 页面渲染（见 [09](./09-Blazor后端与RunHost.md)）。

## 9. 调试接入

`contributes.debuggers` 声明 `type: "smallbasic"`，`languages: ["smallbasic"]`；`launch` 配置含 `program`（默认 `${file}`）、`backend`（枚举 `javascript|csharp|blazor`，**无默认值**）、`stopOnEntry`（默认 `true`）。三个 `configurationSnippets` 预置对应后端的启动项：

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Launch current file (JS debugger)",
  "program": "${file}", "backend": "javascript", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Debug current file with C# backend",
  "program": "${file}", "backend": "csharp", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Debug current file with Blazor backend",
  "program": "${file}", "backend": "blazor", "stopOnEntry": false }
```

**适配器分流**（`src/debug/factory.ts`）：

- `javascript`（默认）：以 `DebugAdapterExecutable(process.execPath, [dist/debug/adapter.js])` 启动内嵌 Node DAP；Web 端改用 `DebugAdapterInlineImplementation`（`src/web/debug-factory.ts`，只支持 JS）。
- `csharp` / `blazor`：以 `DebugAdapterExecutable` 启动对应 RunHost 的 `debug` 子命令（stdio 原生 DAP）。
- 缺省后端：`selectDefaultDebugBackend(platform, hasCSharpHost)` → Windows 且有 C# 宿主为 `csharp`，否则 `javascript`；Blazor 仅显式指定。

适配器内部结构与断点吸附见 [05-调试架构设计.md](./05-调试架构设计.md)。

## 10. 打包与发布

- tsup 打包：Node 目标产出 `dist/extension.js`、`dist/debug/adapter.js`、`dist/runhost.js`（外部仅留 `vscode`，`smallbasic-lang-core` 内联）；另有 Web 目标产出 `dist/web/extension.js`（注入 Buffer/process polyfill）。
- `@vscode/vsce package` 产出 vsix；打包脚本 `scripts/package-vsix.mjs` 会先构建，再由 `scripts/stage-runhost.mjs` 把 RunHost 的 windows/portable/blazor 载荷暂存进扩展 `runhost/`，最后打包。CI 流程：typecheck → vitest → 打包。
- 体积：因为内置了 windows/portable/blazor 三份宿主，当前 vsix 约 18 MB（远大于仅扩展本体的体积）。

## 11. 与 VS 侧的差异说明

VS Code 侧**不需要** MEF/分类器等概念，语言特性全部走 VS Code 声明式 API；TextMate 语法与语义令牌互补，语义令牌补齐 TextMate 做不到的上下文区分。调试适配器内嵌在扩展内（`dist/debug/adapter.js`），并非独立 npm 包——若未来需要被其它 DAP 客户端复用，可再抽出。
