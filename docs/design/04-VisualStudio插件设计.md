# 04 Visual Studio 2026 插件设计

落地目录：`visual_studio_plugin/`。目标：发布 VSIX（支持 VS 2022 17.x 与 VS 2026 18.x），为 `*.sb` 提供文件创建、着色、IntelliSense、编译运行与调试。

> **2026-09-30 最终态校准**
>
> - Visual Studio 侧已收敛为**单包**：`src/SmallBasic.Vsix`（新版扩展 SDK in-proc 混合托管 + 内置 LSP server）。过渡期的旧工程与公共库 `src/SmallBasic.VsCommon` 已删除，内容全部并入本工程（命名空间统一为 `SmallBasic.Vsix.*`）；迁移与收敛记录见本文第 9 节。
> - 解决方案是新格式 `SmallBasic.VisualStudio.slnx`，收录 `src/SmallBasic.Vsix`、`src/SmallBasic.LanguageServices`、`src/SmallBasic.RunHost`、`tests/SmallBasic.Compiler.Tests`、`tests/SmallBasic.LanguageServices.Tests` 与 `vendor/SmallBasicEditor` 的 Compiler/Utilities；`src/SmallBasic.Blazor.*` 三件套由 Ext 项目的 MSBuild Target 间接构建并发布。**没有**独立的 `SB.DebugAdapter` 项目（调试内嵌在 RunHost），也**没有** `vsdconfig`。
> - 包内代码分为新框架层（`Commands/` 的新 SDK 命令、`LanguageServer/`、`ToolWindows/`）与兼容层（`Commands/` 的调试启动与 F5 过滤器、`Services/`、`Workspace/`、`Editor/` 的分类/折叠/导航栏/调试内联值）。**没有** `Templates/`、`Resources/`（无项模板）。补全 / QuickInfo / Squiggle 的旧 MEF 实现已删除，同等能力由 LSP 提供。
> - 打开文件夹时 `F5`/`F10`/`F11` 交给 VS 调试目标机制（仓库根 `launch.vs.json` 的 `smallbasic` 配置按其 `backend` 生效；`.vscode/launch.json` 仅供 VS Code 使用）；解决方案或无工作区时 `F5` 默认纯 C# DAP 调试；`Ctrl+F5` 始终运行 `SelectedBackend`（默认 C#）；调试会话激活期间命令过滤器把 `F5/F10/F11` 转发给调试器。Tools 菜单提供 C#/JS/Blazor 的运行与调试入口及 Show Document Outline（共 7 项），仅当活动编辑器是 `.sb` 文件时启用。**没有**“工具→选项”设置页，后端由菜单/快捷键直接决定。
> - C# 运行/调试用随 VSIX 分发的 `net48` 宿主，支持图形；JS 路径只捆 `runhost/javascript` bundle 并依赖外部 Node.js 20+，不支持图形；Blazor 路径用 `dotnet ...SmallBasic.Blazor.RunHost.dll`，跨平台提供图形。
> - 本文其余章节若出现 `src/SmallBasic.Vsix/...` 或 `src/SmallBasic.VsCommon/...` 路径，按“均已并入 `src/SmallBasic.Vsix/...`”理解。

## 1. 技术路线选择

VS 2026 有两代扩展模型：

| 模型 | 说明 | 本方案采用度 |
|---|---|---|
| VisualStudio.Extensibility（in-proc 混合托管） | 微软新一代模型；菜单/命令/工具窗/LSP 走新 SDK，深能力靠 in-proc 兼容层 | **采用**（唯一包形态） |
| **VS SDK in-proc（MEF / VSCT 传统路径）** | 编辑器深层扩展（分类器/导航栏/内联值）与调试接线的成熟路径 | **采用**（作为包内兼容层，不再是独立包） |

调试走 **Debug Adapter Host**（VS 2017 15.6+ 内置，`Microsoft.VisualStudio.Debugger.VSCodeDebuggerHost`），挂载自研 DAP 适配器，**不写 AD7 调试引擎**。详见 [05-调试架构设计.md](./05-调试架构设计.md)。

## 2. 解决方案结构

```
visual_studio_plugin/
├── SmallBasic.VisualStudio.slnx           # 新格式解决方案（收录 Ext / LanguageServices / RunHost / 两个测试工程 / vendor Compiler+Utilities）
├── Directory.Build.props                  # LangVersion=latest；Nullable=enable；抑制部分告警
├── src/
│   ├── SmallBasic.LanguageServices/       # 公共库（netstandard2.0）：LSP 与大纲语言层
│   │   ├── Lsp/                           # LSP 模型 / 编译语义映射 / Content-Length 帧 / 内置 server
│   │   └── Outline/                       # SmallBasicOutlineBuilder（编译器大纲 → 工具窗树形数据）
│   ├── SmallBasic.Vsix/                    # 唯一的 VS 扩展包（net48，VisualStudio.Extensibility 混合托管）
│   │   ├── source.extension.vsixmanifest   # ExtensionType=VSSDK+VisualStudio.Extensibility；MefComponent: SmallBasic.Vsix.dll
│   │   ├── SmallBasicExtension.cs         # Extension 入口 + DI
│   │   ├── SmallBasicPackage.cs        # 兼容 AsyncPackage（语言服务注册链）
│   │   ├── VersionInfo.g.cs               # 由 version.json 生成（namespace SmallBasic.Vsix）
│   │   ├── Commands/                      # 新 SDK 菜单/命令 + 兼容层 CommandService/DebugLauncher/RunCommandFilter
│   │   ├── Services/                      # 编译缓存（ITextBuffer → SmallBasicCompilation）、输出窗口诊断
│   │   ├── Workspace/                     # SmallBasicLaunchDebugTargetProvider（Open Folder 调试目标）
│   │   ├── LanguageServer/                # SmallBasicLanguageServerProvider（LSP 客户端接线）
│   │   ├── ToolWindows/Outline/           # Remote UI 大纲工具窗（Control/XAML/ViewModel）
│   │   └── Editor/
│   │       ├── ContentType.cs             # "smallbasic" content type，.sb 关联
│   │       ├── Classification/            # SmallBasicClassifier / SimpleLexer / Formats / Provider
│   │       ├── Outlining/                 # OutliningTagger + Provider（折叠）
│   │       ├── NavigationBar/             # 原生导航栏 + SmallBasicLanguageService（必须在包程序集，CodeBase 注册）
│   │       └── Debugging/                 # SmallBasicInlineValuesAdornment（调试内联值）
│   ├── SmallBasic.RunHost/                # 运行/调试宿主，多目标 net48;net8.0;net8.0-windows
│   │   ├── Program.cs                     # run --file <f.sb> [--pause] / debug
│   │   ├── Libraries/                     # GraphicsWindow/Shapes/Turtle/TextWindow/... + UnsupportedLibraries
│   │   └── Debug/                         # DebugAdapter（原生 DAP）+ DapStream
│   ├── SmallBasic.Blazor.Shared/          # 宿主↔浏览器消息契约（Protocol.cs）
│   ├── SmallBasic.Blazor.Client/          # WASM：引擎会话、图形库、SVG/Canvas 渲染
│   └── SmallBasic.Blazor.RunHost/         # Kestrel 宿主 + 会话 API + WebSocket 桥 + DAP
├── tests/SmallBasic.Compiler.Tests/       # net8.0-windows，xunit 2.9.2 + FluentAssertions 7.0.0
├── tests/SmallBasic.LanguageServices.Tests/            # net8.0，直接引用 SmallBasic.LanguageServices 做单元与 LSP 协议测试
├── vendor/SmallBasicEditor/Source/        # 拷贝升级的编译器/引擎/分析器（netstandard2.0）+ UPSTREAM.md
└── build/Package-Vsix.ps1                 # 打包脚本（含载荷与 MEF 资产校验）
```

> `SmallBasic.Blazor.*` 三件套未列入 `.slnx`，由 Ext 项目的 `PrepareRunHostForVsix` Target 通过 `dotnet publish -f net8.0` 发布到 `runhost/blazor` 后再收入 VSIX。

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

## 3. 编辑器与语言服务集成

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

### 3.3 IntelliSense 与诊断（LSP）

| LSP 能力 | 服务端实现 | Visual Studio 呈现 |
|---|---|---|
| Completion | `SmallBasicLspAnalysisService` | `.` / 标识符 / Ctrl+Space 补全；补全文本已摊平为普通参数名 |
| Hover | `SmallBasicLspAnalysisService` | Quick Info，文档来自 vendor 本地化资源 |
| Diagnostics | `publishDiagnostics` | 编辑器波浪线与 Error List |
| Document Symbols | `SmallBasic.LanguageServices` | 文档符号与大纲数据源 |
| Signature Help | **未实现** | 当前内置 LSP 未发布该能力 |

旧 `IAsyncCompletionSource`、`IAsyncQuickInfoSource` 与 `ITagger<IErrorTag>` 实现已经删除，不能再视为当前架构。LSP 使用 0-based 行列 DTO，并由 `LanguageServerProvider` 建立进程内客户端/服务端连接。

### 3.4 编译服务与缓存

`SmallBasic.LanguageServices` 负责 LSP 分析和编译结果复用；包内 `SmallBasicCompilationService` 继续服务分类、折叠、导航栏与调试内联值等 MEF 兼容层能力。两条路径共享 vendor 编译器语义，但分别保持其宿主生命周期。

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
- `Run with Blazor Backend`（`0x0105`）：执行 `dotnet "<...>runhost\blazor\SmallBasic.Blazor.RunHost.dll" run --file "<path>.sb" --pause`；跨平台提供图形（见 [09](./09-Blazor与Web运行宿主.md)）。

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
- 携带载荷：`SmallBasic.Vsix.dll/.pkgdef`、`SmallBasic.LanguageServices.dll`、vendor 的 `SmallBasic.Compiler.dll`/`SmallBasic.Utilities.dll` 及依赖、`debugadapter/adapter.js`（JS DAP bundle）、`runhost/csharp/SmallBasic.RunHost.exe`（net48）、`runhost/blazor/**`（net8.0 发布输出）、`runhost/javascript/smallbasic-runhost.js`。
- `build/Package-Vsix.ps1` 在打包后校验 VSIX v3 必需条目（`extension.vsixmanifest`/`manifest.json`/`catalog.json`/`[Content_Types].xml`）与必需载荷，并**拒绝内置 node.exe/node_modules**（不得内置 Node 运行时）。
- `build/Package-Vsix.ps1` 依赖 `runhost/Build-RunHost.ps1` 的输出（VSIX 携带其中的 RunHost、Blazor 与 JavaScript 载荷），因此默认先构建 RunHost 分发再 `dotnet build`；`Build-All.ps1` 已构建过该分发，故传入 `-SkipRunHost` 避免重复构建。VSIX 工程自身的 `PrepareRunHostForVsix` target 仍会按需构建 net48 宿主并发布 Blazor 宿主。
- 版本单一来源为仓库根 `version.json`（当前 `0.1.5`），由 `tools/sync-version.mjs` 同步到 manifest 与 `VersionInfo.g.cs`。
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

## 9. VisualStudio.Extensibility 迁移与收敛记录

> 本节由原 11 号文档并入，记录从经典 VSSDK 包到单一混合托管包的演进、删除项和验收基线；当前使用说明仍以前述第 1 至 8 节为准。

落地目录：`visual_studio_plugin/src/SmallBasic.Vsix/`。本文档描述**最终态**：Small Basic 的 Visual Studio 支持收敛为唯一的扩展包 `SmallBasic.Vsix.<version>.vsix`，技术栈为 VisualStudio.Extensibility 入口层 + in-proc VSSDK 兼容层。

> **历史说明**
>
> 本方案经历两轮演进：
>
> 1. 经典 `SmallBasic.Vsix`（纯 VSSDK + MEF + VSCT）→ 新增 `SmallBasic.Ext`（新框架路线），两者经 `SmallBasic.VsCommon` 共享实现；
> 2. 新框架路线验证可行后反向收敛：`SmallBasic.Ext` 吸收 `SmallBasic.VsCommon` 全部内容并**改回 `SmallBasic.Vsix` 之名**，旧经典工程与共享库删除，包 Id 恢复为 `smallbasic-tools-vs`（老用户直接升级替换，无共存冲突）。

### 1. 最终架构

```text
visual_studio_plugin/
├── src/
│   ├── SmallBasic.LanguageServices/      # 语言能力层（netstandard2.0）
│   │   ├── Lsp/                          # LSP 模型 / 编译语义映射 / 帧 / 内置 server
│   │   └── Outline/                      # 编译器大纲 → 工具窗树形数据
│   ├── SmallBasic.Vsix/                  # 唯一的 VS 扩展包（net48，混合托管）
│   │   ├── SmallBasicExtension.cs        # Extension 入口 + DI
│   │   ├── SmallBasicPackage.cs          # 兼容 AsyncPackage（语言服务注册兜底）
│   │   ├── Commands/                     # 新 SDK 菜单命令 + 兼容层运行/调试/过滤器
│   │   ├── LanguageServer/               # LanguageServerProvider（LSP 客户端接线）
│   │   ├── ToolWindows/Outline/          # Remote UI 大纲工具窗
│   │   ├── Editor/                       # MEF：分类/折叠/导航栏/调试内联值/ContentType
│   │   ├── Services/                     # 编译服务 / 诊断日志
│   │   ├── Workspace/                    # Open Folder 调试目标提供器
│   │   └── VersionInfo.g.cs              # 由 version.json 生成（namespace SmallBasic.Vsix）
│   └── SmallBasic.RunHost 等             # 进程外运行/调试载荷（不受本次改造影响）
├── tests/
│   ├── SmallBasic.Compiler.Tests/        # 编译器 + 运行时回归（vendor 测试套）
│   └── SmallBasic.LanguageServices.Tests/  # 语言层测试（引用 SmallBasic.LanguageServices）
└── build/
    └── Package-Vsix.ps1                  # 唯一的 VS 打包脚本
```

### 2. 为什么共享层只保留 LanguageServices

过渡期曾把两条 VS 路线共用的实现抽成 `SmallBasic.VsCommon`。收敛为单包后共享前提消失：

- 只剩一个消费方，"程序集级共享"不再有收益；
- `InternalsVisibleTo` 跨程序集可见性徒增复杂度。

因此 VS 集成层全部回到包工程本体。真正仍然共享的只有 `SmallBasic.LanguageServices`（netstandard2.0）：它被扩展（net48）与测试（net8.0）同时引用同一程序集，且不含任何 VS 依赖。测试工程随之命名 `SmallBasic.LanguageServices.Tests`——它只测语言层，名实相符。

### 3. 能力实现路径（最终态）

| 能力 | 实现 |
|---|---|
| 扩展入口 / DI | `Extension`（`RequiresInProcessHosting = true`） |
| Tools 菜单 / 六个运行调试命令 / 大纲命令 | `Command` / `MenuConfiguration` |
| 命令启用规则 | `EnabledWhen`（活动编辑器为 `*.sb` 时启用） |
| 文档大纲工具窗 | `ToolWindow` + Remote UI |
| 补全 / 悬停 / 实时诊断 / 文档符号 | 内置 LSP server + `LanguageServerProvider` |
| 分类着色 / 折叠 / 导航栏 / 调试内联值 | editor MEF（in-proc 兼容层） |
| F5 / Ctrl+F5 / F10 / F11 拦截 | `IOleCommandTarget` 过滤器（in-proc） |
| Open Folder 调试（launch.vs.json） | `ILaunchDebugTargetProvider4`（in-proc） |
| 调试启动（三后端 DAP） | DTE `DebugAdapterHost.Launch`（in-proc） |
| 语言服务注册链 | `ProvideLanguageService` 等 + `ProvideObject(CodeBase)`（类型必须在包程序集内） |

**调试结论**：新扩展 SDK（17.14）没有调试启动 / 调试引擎 / 命令拦截 API；调试链路 100% 走 in-proc 兼容层。这正是选择 `VssdkCompatibleExtension` + `RequiresInProcessHosting` 混合托管的原因，也是最终形态，不等待新 SDK 补调试 API。

**manifest 源生成器约束**：命令类必须**直接**继承 `Command` 并在类上声明具体 `CommandConfiguration`，否则命令会从生成的 `extension.json` 中静默丢失（间接继承基类中的配置不被发现）。六个运行/调试命令因此各自持有 `CommandConfiguration`，共享部分（图标、`EnabledWhen`）由基类静态成员提供。

### 4. 退役与删除清单

| 删除项 | 理由 |
|---|---|
| 旧经典 `SmallBasic.Vsix` 工程（VSCT、旧包入口） | 被新包取代 |
| 旧经典包独有的 `Editor/Completion`、`Editor/QuickInfo`、`Editor/Squiggles` | 由 LSP completion / hover / publishDiagnostics 取代 |
| `SmallBasicSnippet` + 其测试 | VS 的 LSP 客户端**不会**展开 snippet（`insertTextFormat: Snippet` 中的 `${1:x}` 占位符被原样插入编辑器），补全文本已在 `SmallBasicLspAnalysisService` 统一摊平为纯文本参数名，解析器无存在必要 |
| `SmallBasic.VsCommon` | 唯一消费方，迁回包工程 |
| `build/Package-Ext-Vsix.ps1` | 只剩一个包，合并为 `build/Package-Vsix.ps1` |

### 5. 身份标识与注册稳定性

- VSIX Id **恢复为 `smallbasic-tools-vs`**：与旧经典包同 Id，VSIX Installer 直接升级替换，无共存冲突；
- DisplayName 为 `SmallBasic for Visual Studio`（不带任何括号后缀）；
- 包 GUID `B2A8F1D6-...`、语言服务 GUID `8F2B7C41-...`、内容类型名 `smallbasic`、Open Folder provider GUID 全部不变；
- 用户只需安装 `SmallBasic.Vsix.<version>.vsix` 一个包。

### 6. 已修复的已知问题

1. **LSP server 生命周期**：`CreateServerConnectionAsync` 的 `cancellationToken` 只约束"创建连接"，不再传给 server 读循环；改为 `CancellationToken.None`，依赖管道关闭（`ReadMessageAsync` 返回 `null`）退出，异常仍经 `TraceSource` 上报。
2. **System.Text.Json 版本下探**：`SmallBasic.LanguageServices` 引用 **8.0.5**（所用 API 自 6.0 起稳定），覆盖 VS 17.14 随附的 8.0.x 与 VS 18 的 10.0.0.10（devenv 绑定重定向 `0.0.0.0–10.0.0.10` 已实测）。
3. **命令启用规则**：六个运行/调试命令增加 `EnabledWhen`（仅 `.sb` 活动文档时启用）。
4. 诊断每次击键全量重编译暂不去抖（Small Basic 程序规模小，编译亚毫秒级，记录在案）。

### 7. 测试策略

- `SmallBasic.LanguageServices.Tests`（net8.0 → LanguageServices netstandard2.0）：LSP 协议映射、帧读写、端到端 JSON-RPC、大纲构建；
- `SmallBasic.Compiler.Tests`：编译器与运行时回归（vendor 测试套）；
- 打包脚本校验：VSIX v3 条目、`SmallBasic.Vsix.dll/.pkgdef`、`SmallBasic.LanguageServices.dll`、RunHost 三后端载荷、`debugadapter/adapter.js`、MEF 资产声明、Release 无 PDB、不夹带 Node.js。

### 8. 验收标准（已达成）

- 单一 VS 扩展工程 `SmallBasic.Vsix`；旧经典工程与 `SmallBasic.VsCommon` 目录不存在；
- 解决方案、Build-All、版本同步脚本均指向现存工程；
- `dotnet build` 全量通过；两个测试工程全绿（23 + 577）；
- `build/Package-Vsix.ps1` 产出 `SmallBasic.Vsix.<version>.vsix` 且校验通过；
- 包能力对照第 3 节表格无退化（语言能力走 LSP，调试走 in-proc 兼容层）；
- README 与设计文档索引同步更新。
