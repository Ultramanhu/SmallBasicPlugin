# 04 Visual Studio 2026 插件设计

落地目录：`visual_studio_plugin/`。目标：发布 VSIX（支持 VS 2022 17.x 与 VS 2026 18.x），为 `*.sb` 提供文件创建、着色、IntelliSense、编译运行与调试。

> **2026-09-28 现状校准**
>
> - 已落地 **经典 VSIX + MEF 编辑器扩展 + AsyncPackage/VSCT 命令**，并通过 Visual Studio Debug Adapter Host 接入 **C#、JavaScript、Blazor 三套 DAP**。
> - 解决方案是新格式 `SmallBasic.VisualStudio.slnx`，收录 `src/SmallBasic.Vsix`、`src/SmallBasic.Ext`、`src/SmallBasic.VsCommon`、`src/SmallBasic.LanguageServices`、`src/SmallBasic.RunHost`、`tests/SmallBasic.Compiler.Tests`、`tests/SmallBasic.Ext.Tests` 与 `vendor/SmallBasicEditor` 的 Compiler/Utilities；`src/SmallBasic.Blazor.*` 三件套由 Vsix/Ext 项目的 MSBuild Target 间接构建并发布。**没有**独立的 `SB.DebugAdapter` 项目（调试内嵌在 RunHost），也**没有** `vsdconfig`。
> - VSIX 主项目只有 `Commands/`、`Services/`、`Editor/` 三类代码；`Editor/` 内含分类、补全、QuickInfo、Squiggle（错误列表）、大纲折叠、文档大纲工具窗、原生导航栏与调试内联值。**没有** `Templates/`、`Resources/`（无项模板），`Editor/Breadcrumb/` 为空目录。
> - 打开文件夹时 `F5`/`F10`/`F11` 交给 VS 调试目标机制（仓库根 `launch.vs.json` 的 `smallbasic` 配置按其 `backend` 生效；`.vscode/launch.json` 仅供 VS Code 使用）；解决方案或无工作区时 `F5` 默认纯 C# DAP 调试；`Ctrl+F5` 始终运行 `SelectedBackend`（默认 C#）；调试会话激活期间命令过滤器把 `F5/F10/F11` 转发给调试器。Tools 菜单提供 C#/JS/Blazor 的运行与调试入口（共 6 项；文档大纲工具窗只在新框架路线 `SmallBasic.Ext` 里提供，经典包没有该命令）。**没有**“工具→选项”设置页，后端由菜单/快捷键直接决定。
> - C# 运行/调试用随 VSIX 分发的 `net48` 宿主，支持图形；JS 路径只捆 `runhost/javascript` bundle 并依赖外部 Node.js 20+，不支持图形；Blazor 路径用 `dotnet ...SmallBasic.Blazor.RunHost.dll`，跨平台提供图形。
>
> **2026-09-30 补充（与新框架路线共用代码）**
>
> - Visual Studio 侧新增了第二条路线 `src/SmallBasic.Ext`（VisualStudio.Extensibility in-proc + 内置 LSP server），详见 [11-VisualStudio.Extensibility迁移设计.md](./11-VisualStudio.Extensibility迁移设计.md)。
> - 本文描述的命令/调试/分类器/折叠/导航栏/内联值等实现已**物理移动到公共库 `src/SmallBasic.VsCommon`（net48）**，由 `SmallBasic.Vsix` 与 `SmallBasic.Ext` 共同引用；两个包都把该程序集声明为 MEF 组件。命名空间仍是 `SmallBasic.Vsix.*`，因此本文其余章节的路径描述需要按“`src/SmallBasic.Vsix/...` → `src/SmallBasic.VsCommon/...`”理解。
> - 唯一例外：`SmallBasicLanguageService.cs` 必须留在包程序集（`ProvideObject` + `RegistrationMethod.CodeBase` 会把 CLSID 指向包程序集），详见 11 文档 6.3。
> - 补全 / QuickInfo / Squiggle 仍只属于经典路线，位于 `src/SmallBasic.Vsix/Editor/{Completion,QuickInfo,Squiggles}`；新框架路线改用 LSP 提供同等能力。

## 1. 技术路线选择

VS 2026 有两代扩展模型：

| 模型 | 说明 | 本方案采用度 |
|---|---|---|
| **经典 VSIX + MEF（进程内）** | 编辑器扩展（分类器/补全/错误列表）唯一成熟路径；.NET Framework 4.8 进程内 | **采用**（语言特性全部走这里） |
| VisualStudio.Extensibility（进程外, .NET 8） | 微软新一代模型，编辑器深层扩展能力仍在补齐 | 不采用（跟踪，未来可迁移外围命令） |

调试走 **Debug Adapter Host**（VS 2017 15.6+ 内置，`Microsoft.VisualStudio.Debugger.VSCodeDebuggerHost`），挂载自研 DAP 适配器，**不写 AD7 调试引擎**。详见 [05-调试架构设计.md](./05-调试架构设计.md)。

## 2. 解决方案结构

```
visual_studio_plugin/
├── SmallBasic.VisualStudio.slnx           # 新格式解决方案（收录 Vsix / RunHost / Compiler.Tests / vendor Compiler+Utilities）
├── Directory.Build.props                  # LangVersion=latest；Nullable=enable；抑制部分告警
├── src/
│   ├── SmallBasic.VsCommon/               # 公共库（net48）：两条 VS 路线共享的 VS 集成层
│   │   ├── Commands/                      # SmallBasicBackend / CommandService / DebugLauncher / RunCommandFilter
│   │   ├── Services/                      # 编译缓存（ITextBuffer → SmallBasicCompilation）、输出窗口诊断
│   │   ├── Workspace/                     # SmallBasicLaunchDebugTargetProvider（Open Folder 调试目标）
│   │   ├── Editor/
│   │   │   ├── ContentType.cs             # "smallbasic" content type，.sb 关联
│   │   │   ├── Classification/            # SmallBasicClassifier / SimpleLexer / Formats / Provider
│   │   │   ├── Outlining/                 # OutliningTagger + Provider（折叠）
│   │   │   ├── NavigationBar/             # 原生导航栏（IVsDropdownBarClient，不含 SmallBasicLanguageService）
│   │   │   └── Debugging/                 # SmallBasicInlineValuesAdornment（调试内联值）
│   │   ├── Properties/AssemblyInfo.cs     # InternalsVisibleTo(SmallBasic.Vsix / SmallBasic.Ext)
│   │   └── VersionInfo.g.cs               # 由 version.json 生成
│   ├── SmallBasic.LanguageServices/       # 公共库（netstandard2.0）：LSP 与大纲语言层
│   │   ├── Lsp/                           # LSP 模型 / 编译语义映射 / Content-Length 帧 / 内置 server
│   │   └── Outline/                       # SmallBasicOutlineBuilder（编译器大纲 → 工具窗树形数据）
│   ├── SmallBasic.Vsix/                   # 经典 VSIX 主项目（net48，VS SDK）
│   │   ├── source.extension.vsixmanifest   # MefComponent: SmallBasic.Vsix.dll + SmallBasic.VsCommon.dll
│   │   ├── SmallBasicPackage.cs           # AsyncPackage 入口 + ProvideMenuResource/ProvideLanguageService
│   │   ├── Menus.vsct                     # Tools → Small Basic 子菜单（运行/调试 6 个命令）
│   │   └── Editor/
│   │       ├── Completion/                # CompletionSource / Snippet / CommitManager / Provider
│   │       ├── QuickInfo/                 # IAsyncQuickInfoSource（悬停）
│   │       ├── Squiggles/                 # ITagger<IErrorTag>（错误列表）
│   │       └── NavigationBar/SmallBasicLanguageService.cs   # 必须留在包程序集，见 11 文档 6.3
│   ├── SmallBasic.Ext/                    # VisualStudio.Extensibility 替代实现（net48）
│   │   ├── source.extension.vsixmanifest   # ExtensionType=VSSDK+VisualStudio.Extensibility
│   │   ├── SmallBasicExtension.cs         # Extension 入口 + DI
│   │   ├── SmallBasicExtPackage.cs        # 最小兼容 AsyncPackage（语言服务注册链）
│   │   ├── Commands/                      # MenuConfiguration + 六个运行/调试命令 + Show Document Outline
│   │   ├── LanguageServer/                # SmallBasicLanguageServerProvider（LSP 客户端接线）
│   │   └── ToolWindows/Outline/           # Remote UI 大纲工具窗（Control/XAML/ViewModel）
│   ├── SmallBasic.RunHost/                # 运行/调试宿主，多目标 net48;net8.0;net8.0-windows
│   │   ├── Program.cs                     # run --file <f.sb> [--pause] / debug
│   │   ├── Libraries/                     # GraphicsWindow/Shapes/Turtle/TextWindow/... + UnsupportedLibraries
│   │   └── Debug/                         # DebugAdapter（原生 DAP）+ DapStream
│   ├── SmallBasic.Blazor.Shared/          # 宿主↔浏览器消息契约（Protocol.cs）
│   ├── SmallBasic.Blazor.Client/          # WASM：引擎会话、图形库、SVG/Canvas 渲染
│   └── SmallBasic.Blazor.RunHost/         # Kestrel 宿主 + 会话 API + WebSocket 桥 + DAP
├── tests/SmallBasic.Compiler.Tests/       # net8.0-windows，xunit 2.9.2 + FluentAssertions 7.0.0
├── tests/SmallBasic.Ext.Tests/            # net8.0，直接引用 SmallBasic.LanguageServices 做单元与 LSP 协议测试
├── vendor/SmallBasicEditor/Source/        # 拷贝升级的编译器/引擎/分析器（netstandard2.0）+ UPSTREAM.md
├── build/Package-Vsix.ps1                 # 经典包打包脚本（含载荷与 MEF 资产校验）
└── build/Package-Ext-Vsix.ps1             # 新框架包打包脚本
```

> `SmallBasic.Blazor.*` 三件套未列入 `.slnx`，由 Vsix 项目的 `PrepareRunHostForVsix` Target 通过 `dotnet publish -f net8.0` 发布到 `runhost/blazor` 后再收入 VSIX。

**源码消费方式：拷贝升级，不引用子模块**（ADR-4）。将 `official_repo/editor/Source` 下的 `SmallBasic.Compiler`、`SmallBasic.Utilities`、`SmallBasic.Tests`、`SmallBasic.Editor/Libraries`、`SmallBasic.Analyzers` 连同 `Directory.Build.props`、`stylecop.json` 拷贝到 `vendor/SmallBasicEditor/Source`（含 `UPSTREAM.md`），编译器/工具库保持 `netstandard2.0`：

| 项 | 从 | 到 |
|---|---|---|
| 项目格式 | 旧式 csproj + `global.json` 锁 SDK 2.1.816 | **SDK 风格 csproj**，`.NET 8 SDK` 构建 |
| 目标框架 | netstandard2.0（库）/ netcoreapp2.0（测试） | 库保持 **netstandard2.0**；`SmallBasic.RunHost` 多目标 `net48;net8.0;net8.0-windows`；VSIX `net48`；Blazor 三件套 `net8.0`；测试 **net8.0-windows** |
| C# 语言 | LangVersion=latest（2018 时点） | 根 `Directory.Build.props` 设 **LangVersion=latest + Nullable=enable** |
| 分析器 | StyleCop + 注入式分析器 | **保留** vendor 原 StyleCop/`SmallBasic.Analyzers` 链（未换成 NetAnalyzers） |
| 测试库 | xunit 2.3.1 + FluentAssertions 5.4.1 | **xunit 2.9.2 + FluentAssertions 7.0.0** |

**本地扩展**：vendor 的 `SmallBasicCompilation` 增加了 `GetExecutableLines()`（断点吸附）、`CompileExpression(string)`（调试表达式/条件）、`GetOutlineItems()`（大纲）以及 `ProvideCompletionItems/ProvideHover` 等语言服务入口；`SmallBasicEngine` 增加 `CurrentSourceLine`/`GetSnapshot()`/`EvaluateConditionAsync` 等调试 API。

**不拷贝**：`SmallBasic.Editor`（Blazor 0.7 UI 主体）、`SmallBasic.Server`、`SmallBasic.Bridge`、`SmallBasic.Client`。

**验收**：升级期零语义改动；`SmallBasic.Compiler.Tests` 全部用例通过，作为后续一切开发的安全网。

## 3. 编辑器集成（MEF）

### 3.1 内容类型与文件关联

```csharp
// ContentType.cs
[Export] [Name("smallbasic")] [BaseDefinition("code")]
internal static ContentTypeDefinition SBContentType;

[Export] [FileExtension(".sb")] [ContentType("smallbasic")]
internal static FileExtensionToContentTypeDefinition SBFileExtension;
```

### 3.2 语法着色：`IClassifier`

- 分类类型（`SmallBasicClassificationDefinitions`）：`sb-keyword`、`sb-string`、`sb-number`、`sb-comment`、`sb-library`、`sb-identifier`、`sb-function`，各自 `BaseDefinition` 映射到 VS 内建类型（keyword/string/number/comment/class/method 等）。
- `SmallBasicClassifier` + `SmallBasicSimpleLexer`：对当前快照**全量扫描**（SB 文件小，成本微秒级），把 token 映射为 `ClassificationSpan`；库对象/子程序名等需上下文区分的 token 复用缓存的 `SmallBasicCompilation` 绑定结果。
- 事件驱动：`TextBuffer.Changed` → 防抖 150ms → 触发 `ClassificationChanged` 重分类。
- 各分类默认前景色由 `ClassificationFormatDefinition` 提供并响应深浅主题（可编辑于“字体和颜色”）。

### 3.3 IntelliSense

| VS API | 实现 | 数据源 |
|---|---|---|
| `IAsyncCompletionSource` | `SmallBasicCompletionSource` | `SmallBasicCompilation.ProvideCompletionItems(TextPosition)`；`.` 触发成员补全，标识符/Ctrl+Space 触发一般补全；`CompletionItem.Icon` 用 VS `KnownMonikers`；描述文案来自 vendor 的本地化库文档 |
| `IAsyncQuickInfoSource` | `SmallBasicQuickInfoSource` | `ProvideHover(TextPosition)` → `ContainerElement`；诊断处优先显示错误 |
| `ITagger<IErrorTag>` + Error List | `SmallBasicErrorTagger` | `compilation.Diagnostics`（`TextRange` 0-based → `SnapshotSpan`）呈现于波浪线与错误列表 |
| Signature Help | **未实现** | —— |

**坐标换算**：VS `SnapshotPoint` → 行列 0-based（`ITextSnapshotLine`），与 `TextPosition(int Line, int Column)` 天然同基。

### 3.4 编译服务缓存

`SmallBasicCompilationService`：以 `(ITextBuffer, ITextVersion)` 为键缓存 `SmallBasicCompilation`，供分类器/补全/QuickInfo/ErrorTagger/大纲与结构折叠共享——**同一份编译结果服务多个功能**，是 VS 侧性能核心（预算见 07）。

### 3.5 大纲、导航栏与折叠

- **原生导航栏**：注册一个不含着色器与编辑器工厂的极简遗留语言服务 `SmallBasicLanguageService`（`IVsLanguageInfo`）以取得 `IVsCodeWindow`，再由 `SmallBasicCodeWindowManager` 挂上 `IVsDropdownBar`；`SmallBasicNavigationBarClient` 提供两个下拉——左侧 `<主程序>` + 所有过程，右侧当前作用域首次使用的变量，光标移动时自动同步。
- **文档大纲工具窗**：`SmallBasicOutlineToolWindow`（Tools → Small Basic → Show Document Outline）列出当前文件的 Sub 与变量，双击跳转。
- **代码折叠 + 结构**：`SmallBasicOutliningTagger` 折叠 `If/While/For` 控制流块；`SmallBasicStructureTagger` 用编译器 `GetOutlineItems()` 产生过程/变量结构。
- **调试内联值**：`SmallBasicInlineValuesAdornment` 在断点暂停时于编辑器内联显示当前行相关变量。

## 4. 新建文件（未实现）

- 当前 VSIX **不提供项模板与“新建 Small Basic 文件”命令**（无 `Templates/`、无相关命令 id）；所有能力基于已打开的 `.sb` 文件。
- SB 无项目系统：不提供 `.sbproj`；“打开文件夹”即获得全部编辑/运行/调试能力。

## 5. 编译运行（非调试）

Tools → Small Basic 子菜单提供三个运行入口（外加 `Ctrl+F5` 默认 C#）；命令在运行前统一用编译器编译并校验诊断：

- `Ctrl+F5` / `Run with C# Backend`（命令 id `0x0100`）：启动随 VSIX 分发的 `runhost\csharp\SmallBasic.RunHost.exe run --file "<path>.sb" --pause`（net48，支持图形）。
- `Run with JavaScript Backend`（`0x0102`）：要求系统 Node 20+，执行 `node "<...>runhost\javascript\smallbasic-runhost.js" run --file "<path>.sb" --pause`；若程序使用图形库则弹窗拒绝并建议改用 C#。
- `Run with Blazor Backend`（`0x0105`）：执行 `dotnet "<...>runhost\blazor\SmallBasic.Blazor.RunHost.dll" run --file "<path>.sb" --pause`；跨平台提供图形（见 [09](./09-Blazor后端与RunHost.md)）。

运行宿主内部把 `SmallBasicCompilation` 交给 `SmallBasicEngine`，由 `RuntimeLibrariesCollection` 提供 `IEngineLibraries` 实现（`TextWindow` 走控制台，图形走图形窗口）。

## 6. 调试接入

- `SmallBasicDebugLauncher` 通过 DTE 执行 `DebugAdapterHost.Launch /LaunchJson:"<path>" /ConfigurationName:"<name>"`，并在 `%TEMP%\SmallBasicPlugin\Debug\` 生成 `launch-csharp.json` / `launch-javascript.json` / `launch-blazor.json`；文件采用标准 `launch.vs.json` 形状（`version` / `defaults` / `configurations[]`），其中配置项包含 `$adapter`、`$adapterArgs`、`name`、`type="smallbasic"`、`request="launch"`、`program`、`stopOnEntry`，JS/Blazor 额外使用 `$adapterRuntime` 指向 `node.exe` / `dotnet.exe`。
- 适配器：C# → `runhost\csharp\SmallBasic.RunHost.exe debug`；Blazor → `dotnet "<...>runhost\blazor\SmallBasic.Blazor.RunHost.dll" debug`；JS → `node "<...>debugadapter\adapter.js"`（外部 Node 20+）。
- **打开文件夹**模式下由 `SmallBasicLaunchDebugTargetProvider`（`ILaunchDebugTargetProvider2`，MEF 导出，`Microsoft.VisualStudio.Workspace` 包编译期引用）接管调试目标：`launch.vs.json` 中 `type="smallbasic"` 的配置按其 `backend` 字段路由到对应适配器，`${file}` 解析为活动 .sb 文档；无 `launch.vs.json` 时"当前文档"目标按扩展名 `.sb` 匹配并默认 C# 后端。此时命令过滤器放行 `F5`/`F10`/`F11`，仅拦截 `Ctrl+F5`。
- 快捷键：解决方案/无工作区时 `F5` 默认 C# 调试（`stopOnEntry=false`）；设计态 `F10`/`F11` 以 `stopOnEntry=true` 启动；调试会话激活期间 `F5/F10/F11` 全部转发给 Debug Adapter Host。
- net48 C# 调试适配器运行在名为 `Debuggee` 的子 AppDomain 中：官方 `SmallBasicLibrary` 在该域名下跳过 `Process.GetCurrentProcess().Kill()`（原 Small Basic IDE 的宿主约定），关闭图形窗口只会关闭 WPF 调度器；适配器轮询 `GraphicsWindowLibrary.HasShutdown`（反射访问库的内部属性）后会话以退出码 0 正常结束，VS 不再弹"调试适配器已意外退出"。net8.0-windows 宿主（VS Code C# 后端）无 AppDomain 机制，关窗仍会强杀进程。
- 编辑器当前行高亮、断点 glyph、局部变量/调用栈窗口全部来自 VS 标准调试 UI，零自研 UI；断点吸附由适配器用 `GetExecutableLines()` 实现（见 05）。
- **无 `vsdconfig`**：VS 侧调试完全走上述 `DebugAdapterHost.Launch` 机制。

## 7. 兼容性与打包

- `source.extension.vsixmanifest`：`InstallationTarget` 为 `Microsoft.VisualStudio.Community [17.0,)`（amd64）与 `[17.4,)`（arm64）；`Dependencies` 要求 .NET Framework `[4.7.2,)`。
- 携带载荷：`SmallBasic.Vsix.dll/.pkgdef`、vendor 的 `SmallBasic.Compiler.dll`/`SmallBasic.Utilities.dll`/`SmallBasic.Analyzers.dll` 及依赖、`debugadapter/adapter.js`（JS DAP bundle）、`runhost/csharp/SmallBasic.RunHost.exe`（net48）、`runhost/blazor/**`（net8.0 发布输出）、`runhost/javascript/smallbasic-runhost.js`。
- `build/Package-Vsix.ps1` 在打包后校验 VSIX v3 必需条目（`extension.vsixmanifest`/`manifest.json`/`catalog.json`/`[Content_Types].xml`）与必需载荷，并**拒绝内置 node.exe/node_modules**（不得内置 Node 运行时）。
- `build/Package-Vsix.ps1` 依赖 `runhost/Build-RunHost.ps1` 的输出（VSIX 携带其中的 RunHost、Blazor 与 JavaScript 载荷），因此默认先构建 RunHost 分发再 `dotnet build`；`Build-All.ps1` 已构建过该分发，故传入 `-SkipRunHost` 避免重复构建。VSIX 工程自身的 `PrepareRunHostForVsix` target 仍会按需构建 net48 宿主并发布 Blazor 宿主。
- 版本单一来源为仓库根 `version.json`（当前 `0.1.2`），由 `tools/sync-version.mjs` 同步到 manifest 与 `VersionInfo.g.cs`。
- 当前 VSIX 产物约 17 MB。

## 8. 与 VS Code 侧的差异与一致性

| 关注点 | VS Code | Visual Studio |
|---|---|---|
| 着色 | TextMate + 语义令牌 | MEF IClassifier |
| 补全触发 | `.` / 字母 / Ctrl+Space | `.` / 标识符 / Ctrl+Space（同语义） |
| 诊断呈现 | Problems 面板 + 波浪线 | Error List + 波浪线 |
| 大纲 | 文档符号 + 内置面包屑 | 原生导航栏 + 文档大纲工具窗 + 结构折叠 |
| 运行 | 三个显式命令（JS/C#/Blazor） | `Ctrl+F5` 默认 C#；Tools 菜单三后端 |
| 调试 | DAP（内嵌 TS / RunHost / Blazor RunHost） | DAP（RunHost / Blazor RunHost / JS bundle）经 Debug Adapter Host |

两端**共享**：`.sb` 语言 ID、断点吸附/单步语义、库文档数据源（vendor 本地化资源）、示例程序与调试语义。
