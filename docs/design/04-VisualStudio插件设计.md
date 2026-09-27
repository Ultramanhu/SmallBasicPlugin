# 04 Visual Studio 2026 插件设计

落地目录：`visual_studio_plugin/`。目标：发布 VSIX（支持 VS 2022 17.x 与 VS 2026 18.x），为 `*.sb` 提供文件创建、着色、IntelliSense、编译运行与调试。

> **2026-09-26 现状校准**
>
> - 当前仓库已经落地 **经典 VSIX + MEF 编辑器扩展 + AsyncPackage/VSCT 命令**，并通过 Visual Studio Debug Adapter Host 接入 C# 与 JavaScript 两套 DAP。
> - 本次修复已完成两处关键问题：
>   1. `SmallBasicRunCommandFilter` 改为挂接 `Document` 文本视图，并正确保存/转发下一个命令过滤器，避免把 VS 自身命令链“吃掉”；
>   2. VSIX 构建输出与打包脚本会携带 `RunHost/SmallBasic.RunHost.exe`、JS 运行 bundle 与 JS DAP bundle，但不会携带 Node.js；JS 路径依赖外部 Node.js 20+。
> - `SmallBasic.RunHost` 现已接入官方 `Microsoft.SmallBasic.Library` 的 `GraphicsWindow`/`Shapes` 实现；`tetris.sb` 这类图形样例可以由运行宿主成功进入图形运行态。
> - `F5/Ctrl+F5` 默认使用 C# 调试/运行路径；Tools 菜单提供 C#/JS 各自的运行与调试入口。JS 路径不支持图形库，C# Windows 宿主支持图形运行与调试。

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
├── SBPlugin.sln
├── Directory.Build.props                 # 公共属性；LangVersion=latest；启用 NetAnalyzers
├── src/
│   ├── SB.Compiler/                      # 拷贝自 SmallBasic.Compiler（netstandard2.0, SDK 风格）
│   │   └── UPSTREAM.md                   # 来源提交哈希 + 本地改动记录
│   ├── SB.Utilities/                     # 拷贝自 SmallBasic.Utilities（resx 资源库）
│   ├── SB.Vsix/                          # VSIX 主项目（net48，VS SDK）
│   │   ├── source.extension.vsixmanifest
│   │   ├── SBPackage.cs                  # AsyncPackage 入口
│   │   ├── Editor/
│   │   │   ├── ContentType.cs            # "smallbasic" content type, .sb 关联
│   │   │   ├── Classification/
│   │   │   │   ├── SBClassifier.cs       # IClassifier（基于 Scanner tokens）
│   │   │   │   ├── SBClassifierProvider.cs
│   │   │   │   └── SBClassificationFormats.cs # 各分类默认色（尊重主题）
│   │   │   ├── Completion/
│   │   │   │   └── SBCompletionSource.cs # IAsyncCompletionSource
│   │   │   ├── QuickInfo/
│   │   │   │   └── SBQuickInfoSource.cs  # IAsyncQuickInfoSource（Hover）
│   │   │   ├── Squiggles/
│   │   │   │   └── SBErrorTagger.cs      # ITagger<IErrorTag> + Error List
│   │   │   └── SBTextDocumentListener.cs # ITextDocument 生命周期
│   │   ├── Services/
│   │   │   ├── SBCompilationService.cs   # 编译缓存（ITextBuffer → SmallBasicCompilation）
│   │   │   └── SBLibraryDocs.cs          # library-docs.json 反序列化
│   │   ├── Commands/
│   │   │   ├── NewSBFileCommand.cs       # “新建 Small Basic 文件”
│   │   │   └── RunSBFileCommand.cs       # F5/Ctrl+F5 运行
│   │   ├── Templates/
│   │   │   └── SmallBasicFile.zip        # 项模板（New File 对话框出现 .sb）
│   │   ├── Debugger/
│   │   │   └── SBDebugAdapterLauncher.cs # Debug Adapter Host 注册（pkgdef/Json）
│   │   └── Resources/library-docs.json   # 由 HomeSite XML 生成（共享脚本）
│   ├── SB.RunHost/                       # net8.0 控制台运行宿主（IEngineLibraries 实现）
│   │   └── Libraries/ConsoleTextWindowLibrary.cs ...
│   └── SB.DebugAdapter/                  # net8.0 DAP 适配器（包装 SmallBasicEngine）
├── tests/
│   ├── SB.Compiler.Tests/                # 拷贝自 SmallBasic.Tests，升级 net8.0 + xunit 2.9
│   ├── SB.Editor.UnitTests/              # MEF 组件单测（Editor MEF mocks）
│   ├── SB.Adapter.Tests/                 # DAP 协议测试
│   └── SB.Conformance.Tests/             # 一致性测试（共享测试集，见 07）
└── build/
    └── Generate-LibraryDocs.ps1          # 与 VS Code 侧共用生成逻辑
```

**源码消费方式：拷贝升级，不引用子模块**（ADR-4）。将 `SmallBasicEditor/Source` 下的 `SmallBasic.Compiler`、`SmallBasic.Utilities`、`SmallBasic.Tests` 三个项目的全部源码拷贝为上述 `SB.Compiler`、`SB.Utilities`、`SB.Compiler.Tests`，并升级：

| 项 | 从 | 到 |
|---|---|---|
| 项目格式 | 旧式 csproj + `global.json` 锁 SDK 2.1.816 | **SDK 风格 csproj**，`.NET 8 SDK` 构建 |
| 目标框架 | netstandard2.0 / netcoreapp2.0（测试） | 库保持 **netstandard2.0**（VS 进程内 net48 与 net8.0 宿主通吃；可选多目标 `netstandard2.0;net8.0` 供 RunHost/Adapter 用新 BCL），测试 **net8.0** |
| C# 语言 | LangVersion=latest（2018 时点） | **最新 LangVersion**；渐进启用 `Nullable` 注解 |
| 分析器 | StyleCop 1.0.2 + FxCop（注入式） | **Microsoft.CodeAnalysis.NetAnalyzers + .editorconfig** |
| 测试库 | xunit 2.3.1 + FluentAssertions 5.4.1 | **xunit 2.9.x + FluentAssertions 7.x**；`CultureFixture` 保留 |

**不拷贝**：`SmallBasic.Editor`（Blazor UI）、`SmallBasic.Server`、`SmallBasic.Bridge`、`SmallBasic.Client`、`SmallBasic.Analyzers`——仅作为宿主库实现的阅读参考。

**验收**：升级期零语义改动；`SB.Compiler.Tests` 全部用例在 net8.0 下通过，作为后续一切开发的安全网。

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

- 分类类型（`ClassificationTypeDefinition`）：`sb-keyword`、`sb-string`、`sb-number`、`sb-comment`、`sb-library`、`sb-subroutine`、`sb-label`。
- `SBClassifier.GetClassificationSpans(SnapshotSpan)`：对当前快照**全量扫描**（`Scanner` 构造即完成，SB 文件小，成本微秒级），把 `Token` 映射为 `ClassificationSpan`；库对象/子程序名等需上下文区分的 token 轻量过一遍 Parser 绑定结果（复用缓存的 `SmallBasicCompilation`）。
- 事件驱动：`TextBuffer.Changed` → 防抖 150ms → 触发 `ClassificationChanged` 重分类。
- `SBClassificationFormats` 用 `ClassificationFormatDefinition` 给默认前景色，并正确响应深色/浅色主题（可编辑于“字体和颜色”）。

### 3.3 IntelliSense

| VS API | 实现 | 数据源 |
|---|---|---|
| `IAsyncCompletionSource` | `SBCompletionSource` | `SmallBasicCompilation.ProvideCompletionItems(TextPosition)`；触发字符 `.`；`CompletionItem.Icon` 用 VS `KnownMonikers`（库对象→Class、方法→Method、属性→Property、事件→Event）；`Description` 取自 library-docs.json |
| `IAsyncQuickInfoSource` | `SBQuickInfoSource` | `ProvideHover(TextPosition)` → `ContainerElement`；诊断处优先显示错误 |
| `ITagger<IErrorTag>` + Error List | `SBErrorTagger` | `compilation.Diagnostics`（`TextRange` 0-based → `SnapshotSpan`）；同时经 `ITableDataSource`/Error List 呈现在错误列表窗口 |
| Signature Help（二期） | `ISignatureHelpSource` | `Libraries.Generated.cs` 元数据 + XML 参数描述 |

**坐标换算**：VS `SnapshotPoint` → 行列 0-based（`ITextSnapshotLine`），与 `TextPosition(int Line, int Column)` 天然同基。

### 3.4 编译服务缓存

`SBCompilationService`：以 `(ITextBuffer, ITextVersion)` 为键缓存 `SmallBasicCompilation`，后台线程构建，供分类器/补全/QuickInfo/ErrorTagger 共享——**同一份编译结果服务四个功能**，是 VS 侧性能核心（预算见 07）。

## 4. 新建文件

- **项模板**：`Templates/SmallBasicFile.zip`（含 `.vstemplate` + 模板 `.sb`），经 VSIX `<Asset Type="Microsoft.VisualStudio.ItemTemplate">` 注册 → “添加新项”对话框出现 “Small Basic File”。
- **命令**：`NewSBFileCommand` 加入“文件”菜单与解决方案资源管理器右键；杂项文件/打开文件夹场景下直接落地 `.sb` 并打开编辑器。
- SB 无项目系统：MVP 不提供 `.sbproj`；“打开文件夹”即获得全部编辑/运行/调试能力。

## 5. 编译运行（非调试）

`RunSBFileCommand`（Ctrl+F5 及工具栏按钮），按"工具 → 选项 → Small Basic → 执行后端"分流（ADR-5，`dotnet` 为默认）：

**backend = dotnet（默认）**：

1. 保存文本 → `new SmallBasicCompilation(text)`；有诊断 → 激活错误列表并终止。
2. 启动 `SB.RunHost.exe`（net8.0 控制台进程，随 VSIX 部署于扩展目录）：
   ```
   SB.RunHost.exe run --file "<path>.sb"
   ```
3. `SB.RunHost` 内部：`SmallBasicCompilation` → `SmallBasicEngine(compilation, new ConsoleLibraries())`，`ConsoleLibraries` 实现 `IEngineLibraries`（MVP 聚焦 `ITextWindowLibrary`：WriteLine→`Console.Out`、`Read/ReadNumber`→`Console.In` 行读 + `engine.InputReceived()` 解锁）。
4. 输出窗口“Small Basic”通道回显进程输出；退出码回报。

**backend = node（JS 引擎，可选）**：

1. VSIX 捆绑 `sb-run.js`（`sb-lang-core` + Node CLI 宿主的 esbuild 单文件，与 VS Code 侧同一构建产物）；运行时查找系统 Node 20+（`PATH`/`node.exe`），未检测到则引导安装。
2. 以 `node sb-run.js run --file "<path>.sb"` 启动，终端 I/O 走 conhost 控制台——与 dotnet 后端同窗口形态。
3. 该通道的主要价值是双引擎交叉验证；语言智能不此后端影响（仍用进程内 .NET 编译器）。

## 6. 调试接入

- VSIX 内注册 **Debug Adapter Host** 启动配置：`Debugger/launch.json` 模板 + `SBDebugAdapterLauncher`，声明 adapter 可执行文件 `SB.DebugAdapter.exe` 与调试器 id `smallbasic`。
- F5 → VS 启动 `SB.DebugAdapter.exe` → DAP 会话（setBreakpoints/launch/stackTrace/variables/continue/next/pause）→ 适配器驱动 `SmallBasicEngine`（`Mode=NextLine`，断点命中判定见 05）。
- **backend = node（可选）**：Debug Adapter Host 改为启动 `node sb-debug.js`（捆绑的 TS DAP 适配器，与 VS Code 侧同一产物）。launch 模板暴露 `"backend": "dotnet" | "node"` 字段，缺省跟随选项页设置；两适配器 DAP 语义字段级对齐，VS 调试 UI 无差异。
- 编辑器当前行高亮、断点 glyph、局部变量/调用栈窗口全部来自 VS 标准调试 UI，零自研 UI。

## 7. 兼容性与打包

- `source.extension.vsixmanifest`：`InstallationTarget` 覆盖 `[17.0, 19.0)`（VS 2022 + VS 2026），`Prerequisites` 仅核心编辑器；amd64。
- 依赖打包：`SmallBasic.Compiler.dll`、`SmallBasic.Utilities.dll`、`SB.RunHost.exe`（含 .NET 8 自包含发布或要求运行时，决策见下）、`SB.DebugAdapter.exe`、library-docs.json。
- **运行时决策**：`SB.RunHost`/`SB.DebugAdapter` 采用 **net8.0 自包含单文件发布**（`PublishSingleFile + SelfContained`，每个约 15-30MB），避免要求用户预装 .NET 运行时；VSIX 总体积预算 < 80MB。若体积敏感可降级为 framework-dependent + 安装检测引导。
- VSIX 内嵌 MEF 目录自动发现；CI 用 `VSIXPublisher` 或手动 Marketplace 上传。

## 8. 与 VS Code 侧的差异与一致性

| 关注点 | VS Code | VS 2026 |
|---|---|---|
| 着色 | TextMate + 语义令牌 | MEF IClassifier |
| 补全触发 | `.` | `.`（同语义） |
| 诊断呈现 | Problems 面板 + 波浪线 | Error List + 波浪线 |
| 调试 | DAP（TS 适配器） | DAP（.NET 适配器）经 Debug Adapter Host |
| 运行宿主 | Node 子进程 + 集成终端 | SB.RunHost 控制台进程 |

两端**共享**：`.sb` 语言 ID、断点/单步语义、库文档数据源、一致性测试集——确保用户在两 IDE 获得一致体验。
