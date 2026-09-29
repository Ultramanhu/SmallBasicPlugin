# 11 VisualStudio.Extensibility 迁移设计

落地目录：`visual_studio_plugin/src/SmallBasic.Ext/`。目标：在保留 Small Basic 现有语言能力、运行与调试体验的前提下，新增一个基于 **VisualStudio.Extensibility** 的替代实现工程，产出独立 VSIX 包 `SmallBasic.Ext.<version>.vsix`。

> **命名说明**
>
> - 本文档与实现统一使用 `SmallBasic.Ext`。
> - 需求文字中的 `SmallBasic.Exr.<version>.vsix` 视为笔误，不单独引入 `Exr` 命名分支。

## 1. 迁移动机

当前 `SmallBasic.Vsix` 已经基于经典 **VSSDK + MEF + AsyncPackage + VSCT** 落地了完整的语言、运行与调试体验；但微软官方已经提供了新的 **VisualStudio.Extensibility** 模型，适合把以下“入口层能力”迁移到更现代的声明式 API：

- 顶层菜单与命令注册；
- 工具窗口；
- 命令显示/启用规则；
- 未来的 LSP / Language Configuration 演进路径。

本轮实现不再停留在“预留接口”，而是把 `SmallBasic.Ext` 的一部分语言能力真正迁到 **LSP**：

- 补全（Completion）
- 悬停（Hover）
- 实时诊断（publishDiagnostics）
- 文档符号 / 大纲数据（DocumentSymbol）

同时，官方文档也明确指出：**当前新框架仍存在能力缺口**，遇到差距时应使用 **in-proc + VSSDK compatibility** 的混合模式承接旧能力。因此本方案不追求“一步到位全量纯新框架”，而是采用 **新入口层 + 旧编辑器深能力兼容层** 的稳妥迁移策略。

在此基础上，本轮还完成了一次**去重复**：把两条 Visual Studio 路线共用的实现抽成两个普通类库（见第 6 节）。此前 `SmallBasic.Ext` 用 `<Compile Include="..\SmallBasic.Vsix\...">` 链接编译经典工程的源码，属于“文件级共享”，既让两个工程的编译耦合，也让 `SmallBasic.Ext.Tests` 不得不再编译一遍被测源码；现在改为**程序集级共享**。

## 2. 官方能力边界（结合本仓库需求）

### 2.1 VisualStudio.Extensibility 已适合承担的能力

- `Extension`：扩展入口；
- `Command` / `MenuConfiguration` / `CommandGroupConfiguration`：菜单、命令、快捷键与可见性；
- `ToolWindow` + `Remote UI`：工具窗口；
- `LanguageServerProvider`：接入 LSP，承载 IntelliSense / diagnostics / hover 等语言服务；
- `DocumentTypeConfiguration`：声明自定义文档类型。

### 2.2 仍应保留 VSSDK / MEF 兼容层的能力

- `ProvideLanguageService` / `ProvideLanguageExtension` 注册链；
- 原生导航栏（`IVsDropdownBarClient`）；
- Open Folder 调试目标提供器（`ILaunchDebugTargetProvider4`）；
- F5 / Ctrl+F5 / F10 / F11 文档命令过滤器；
- 基于 `Microsoft.VisualStudio.Workspace` 的 `launch.vs.json` 路由；
- 调试内联值（inline values adornment）与分类着色、折叠等 editor MEF 扩展。

> 其中 `completion / hover / squiggles` 已不再作为 `SmallBasic.Ext` 的首选语言实现路径，而是改由内置的 Small Basic LSP server 提供。

### 2.3 结论

**SmallBasic.Ext 采用 VisualStudio.Extensibility in-proc 模式**：

- 工程级：`VssdkCompatibleExtension=true`；
- 扩展入口：`ExtensionConfiguration.RequiresInProcessHosting = true`；
- 包级清单：`source.extension.vsixmanifest` 使用 `ExtensionType="VSSDK+VisualStudio.Extensibility"`；
- 编辑器与调试深能力复用 `SmallBasic.VsCommon`（与经典包逐字共享的程序集）。

## 3. 新旧框架功能映射

| 功能点 | `SmallBasic.Vsix`（经典） | `SmallBasic.Ext`（迁移） | 备注 |
|---|---|---|---|
| VSIX 入口 | `AsyncPackage` + `.vsixmanifest` + `VSCT` | `Extension` + `.vsixmanifest`（VSSDK+Ext）+ 最小兼容 `AsyncPackage` | 新入口负责命令与工具窗；兼容包只做注册/服务兜底 |
| Tools 菜单命令 | `Menus.vsct` + `OleMenuCommandService` | `MenuConfiguration` + `CommandGroupConfiguration` + `Command` | 保留 `Tools > Small Basic` 子菜单结构 |
| Run/Debug 行为 | `SmallBasicCommandService` / `SmallBasicDebugLauncher`（`SmallBasic.VsCommon`） | **直接复用同一程序集** | 运行与 DAP 接线逻辑不重写，避免行为漂移 |
| 文档大纲命令 | VSCT 规划，代码中未完整落地 | `Command` + `ToolWindow` + `Remote UI` | 新工程补齐缺口，提供可导航的大纲视图 |
| 语言服务注册 | `ProvideLanguageService` / `ProvideLanguageExtension` | 最小兼容 `AsyncPackage` 继续提供 | 注册链保留，语言能力已迁出 |
| 分类/着色 | `IClassifier`（`SmallBasic.VsCommon`） | **复用同一程序集** | 仍是 MEF 分类器实现 |
| 补全 / Hover / 实时诊断 | 经典 MEF / Async Completion / ErrorTagger | **LSP provider + 内置 Small Basic language server** | `SmallBasic.Ext` 已切到这一路径 |
| 文档符号 | 编译器 `GetOutlineItems()` + 导航栏/折叠 | **LSP DocumentSymbol** + 工具窗复用同一份编译语义 | 为未来统一大纲/面包屑留接口 |
| 导航栏 / 折叠 / 调试内联值 | 经典 VS editor API（`SmallBasic.VsCommon`） | **复用同一程序集** | 单一实现，两个包行为一致 |
| Open Folder 调试 | `ILaunchDebugTargetProvider4`（`SmallBasic.VsCommon`） | **复用同一程序集** | `launch.vs.json` / `${file}` 解析逻辑不变 |
| 运行快捷键 | `IOleCommandTarget` 过滤器（`SmallBasic.VsCommon`） | **复用同一程序集** | 保持 F5 / Ctrl+F5 / F10 / F11 体验 |
| 长期语言演进 | 经典语言服务 + MEF | `LanguageServerProvider` + Language Configuration | 路线与 VS Code 更对齐 |

## 4. 与 VS Code 方案的对齐策略

`SmallBasic.Ext` 不重复发明运行与调试逻辑，而是继续与 VS Code / 经典 VSIX 共享以下行为基线：

1. **运行后端保持三选一**：`csharp` / `javascript` / `blazor`；
2. **调试仍走同一套 DAP 宿主**：C# / JS / Blazor 三后端复用现有适配器；
3. **语言语义仍由 vendor 编译器提供**：补全、悬停、诊断、大纲都继续基于 `SmallBasicCompilation`；
4. **Open Folder 调试规则保持一致**：`launch.vs.json` 和 `launch.json` 的 `backend` 语义不偏离；
5. **文档大纲的数据模型与 VSCode 一致**：LSP `DocumentSymbol` 与大纲工具窗都基于 `GetOutlineItems()`，只在 UI 呈现层有差异。

## 5. 工程结构

```text
visual_studio_plugin/
├── src/
│   ├── SmallBasic.LanguageServices/      # 公共库（netstandard2.0）：语言能力层
│   │   ├── Lsp/
│   │   │   ├── SmallBasicLspModels.cs            # 传输无关的 LSP 模型
│   │   │   ├── SmallBasicLspAnalysisService.cs   # SmallBasicCompilation → LSP 模型映射
│   │   │   ├── SmallBasicLspStream.cs            # Content-Length 帧读写
│   │   │   └── SmallBasicLanguageServer.cs       # 内置 LSP server（JSON-RPC 分发）
│   │   └── Outline/
│   │       └── SmallBasicOutlineBuilder.cs       # 编译器大纲 → 工具窗树形数据
│   ├── SmallBasic.VsCommon/              # 公共库（net48）：VS 集成层
│   │   ├── Commands/                     # SmallBasicBackend / CommandService / DebugLauncher / RunCommandFilter
│   │   ├── Services/                     # SmallBasicCompilationService / SmallBasicDiagnostics
│   │   ├── Workspace/                    # SmallBasicLaunchDebugTargetProvider
│   │   ├── Editor/
│   │   │   ├── ContentType.cs
│   │   │   ├── Classification/            # MEF 分类器
│   │   │   ├── Outlining/                 # MEF 折叠
│   │   │   ├── Debugging/                 # 调试内联值
│   │   │   └── NavigationBar/             # 原生导航栏（不含 SmallBasicLanguageService）
│   │   ├── Properties/AssemblyInfo.cs     # InternalsVisibleTo(SmallBasic.Vsix / SmallBasic.Ext)
│   │   └── VersionInfo.g.cs               # 由 version.json 生成
│   ├── SmallBasic.Vsix/                   # 经典实现（net48）
│   │   ├── SmallBasicPackage.cs
│   │   ├── Menus.vsct
│   │   └── Editor/{Completion,QuickInfo,Squiggles}/
│   │       └── NavigationBar/SmallBasicLanguageService.cs   # 必须留在包程序集，见 6.3
│   └── SmallBasic.Ext/                    # VisualStudio.Extensibility 实现（net48）
│       ├── SmallBasicExtension.cs         # Extension 入口 + DI
│       ├── SmallBasicExtPackage.cs        # 最小兼容 AsyncPackage
│       ├── Commands/                      # 菜单配置 + 六个运行/调试命令 + 大纲命令
│       ├── LanguageServer/                # SmallBasicLanguageServerProvider（LSP 客户端接线）
│       └── ToolWindows/Outline/           # 远程 UI 大纲工具窗
├── tests/
│   ├── SmallBasic.Compiler.Tests/
│   └── SmallBasic.Ext.Tests/              # 直接引用 SmallBasic.LanguageServices
└── build/
    ├── Package-Vsix.ps1                   # 经典 VSIX
    └── Package-Ext-Vsix.ps1               # 打包 SmallBasic.Ext
```

## 6. 公共库分层（去重复）

### 6.1 分层原则

| 层 | 工程 | TFM | 内容 | 消费方 |
|---|---|---|---|---|
| 语言能力层 | `SmallBasic.LanguageServices` | netstandard2.0 | LSP 模型、编译语义映射、大纲构建、LSP 帧与内置 server | `SmallBasic.Ext`、`SmallBasic.Ext.Tests` |
| VS 集成层 | `SmallBasic.VsCommon` | net48 | 命令/调试启动/运行过滤器、Services、Open Folder 调试目标、分类/折叠/导航栏/内联值等 MEF 部件 | `SmallBasic.Vsix`、`SmallBasic.Ext` |
| 宿主层 | `SmallBasic.Vsix` / `SmallBasic.Ext` | net48 | 包注册、VSCT 或 Extensibility 入口、各自独有的 editor 扩展与工具窗 | 相互独立 |

`SmallBasic.LanguageServices` 之所以是 `netstandard2.0`，是为了让 `net8.0` 的测试工程能**直接引用同一个程序集**（net48 的 `SmallBasic.VsCommon` 反而做不到）。这样测试不再把被测源码链接编译第二遍，语言层的任何改动都会同时进入扩展与测试。

### 6.2 命名与可见性

- `SmallBasic.VsCommon` 的**命名空间保持 `SmallBasic.Vsix.*` 不变**：这些类型原本就在该命名空间下，保持不动可让两个消费方零改动接入，程序集名只表达“两条 VS 路线共享的那部分”。
- 共享类型对消费方是**内部实现**，通过 `Properties/AssemblyInfo.cs` 里的 `InternalsVisibleTo("SmallBasic.Vsix")` / `InternalsVisibleTo("SmallBasic.Ext")` 暴露，而不扩大公共 API 面。
- `SmallBasicVersion`（`VersionInfo.g.cs`）改为 `public`，因为两个包都要在 `InstalledProductRegistration` 与 `serverInfo.version` 中读取它；该文件现在生成到 `SmallBasic.VsCommon`，由 `tools/sync-version.mjs` 负责同步。

### 6.3 必须留在包程序集里的唯一例外

`SmallBasic.Vsix/Editor/NavigationBar/SmallBasicLanguageService.cs` **不进入公共库**：

- 它通过 `ProvideObject(..., RegisterUsing = RegistrationMethod.CodeBase)` 注册；
- VSSDK 生成的 pkgdef 使用“**包程序集**”作为 `CodeBase`（实测为 `$PackageFolder$\SmallBasic.Vsix.dll` / `$PackageFolder$\SmallBasic.Ext.dll`），并不会指向类型所在的程序集；
- 因此这个 `ComVisible` 类型必须位于包程序集内，否则 COM 激活会失败，原生导航栏随之失效。

`SmallBasic.Ext` 因此只保留**一处**链接编译（该文件），它调用的 `SmallBasicCodeWindowManager`、导航栏客户端与 MEF 挂接器全部来自 `SmallBasic.VsCommon`。

### 6.4 MEF 发现

分类器、折叠、导航栏挂接器、调试内联值与 Open Folder 调试目标都是 MEF 导出，现在位于 `SmallBasic.VsCommon.dll`。两个包的 `source.extension.vsixmanifest` 都显式声明了第二个 MEF 组件：

```xml
<Asset Type="Microsoft.VisualStudio.MefComponent"
       d:Source="Project"
       d:ProjectName="SmallBasic.VsCommon"
       Path="|SmallBasic.VsCommon;BuiltProjectOutputGroup|" />
```

两个打包脚本都会校验 `extension.vsixmanifest` 中确实存在该 `MefComponent` 资产，避免共享部件静默失效。

### 6.5 VSSDK BuildTools 版本

`Microsoft.VisualStudio.Extensibility.Sdk` 默认引入的 **17.14 BuildTools 无法解析 `source.extension.vsixmanifest` 中指向项目引用的资产**（报 `VSSDK1044`）。因此 `SmallBasic.Ext` 显式引用与经典包相同的 `Microsoft.VSSDK.BuildTools 18.9.820`：既解决该问题，也让两个包生成同构的 VSIX v3 元数据。

## 7. LSP 语言能力方案

`SmallBasic.Ext` 当前把以下语言能力切到 LSP：

- `textDocument/completion`
- `textDocument/hover`
- `textDocument/documentSymbol`
- `textDocument/publishDiagnostics`

### 7.1 服务形态

- 使用 `VisualStudio.Extensibility.LanguageServerProvider`；
- Provider 在 `CreateServerConnectionAsync()` 中创建内存双工流（`Nerdbank.Streams`）；
- 扩展内启动 `SmallBasic.LanguageServices` 里的轻量 LSP server，同进程读写 JSON-RPC/LSP 报文；
- 不引入额外外部进程，调试时仍跟随实验实例一起启动。

### 7.2 语义来源

- Completion：`SmallBasicCompilation.ProvideCompletionItems()`
- Hover：`SmallBasicCompilation.ProvideHover()`
- Diagnostics：`SmallBasicCompilation.Diagnostics`
- DocumentSymbol：`SmallBasicCompilation.GetOutlineItems()`

### 7.3 当前边界

- 已迁：补全、悬停、诊断、文档符号；
- 仍走兼容层：分类着色、导航栏、折叠、调试内联值、F5/打开文件夹调试接线；
- `Language Configuration` 仍可作为下一步补充本地同步编辑行为（注释、括号、自动缩进等）。

## 8. 文档大纲工具窗口方案

经典工程中 `Editor/Outline/` 目录为空，设计文档提及的“Show Document Outline”此前未真正落地。`SmallBasic.Ext` 把它作为新框架示范功能补齐。

### 8.1 数据来源

- 读取当前活动 `.sb` 文档（优先活动文档，其次最近聚焦的 `.sb`，再退回“唯一打开的 `.sb`”）；
- `SmallBasic.LanguageServices.Outline.SmallBasicOutlineBuilder` 调用 `SmallBasicCompilation.GetOutlineItems()` 生成层次数据；
- 顶层变量归入“`<主程序>`”节点；
- 过程节点下展示其首次使用变量。

### 8.2 UI 形态

- `ToolWindow` 使用 `Remote UI`；
- 采用树状呈现；
- 每个节点提供“跳转”命令；
- 窗口顶部提供“刷新”命令与状态文本。

### 8.3 导航方式

- 跳转操作通过 DTE 打开文档并移动到 `SelectionRange.Start`；
- 编译器为 0-based 坐标，落地时统一转换为 VS 1-based 光标定位。

## 9. 打包与构件命名

### 9.1 产物

- 经典包保持：`SmallBasic.Vsix.<version>.vsix`
- 新增包产物：`SmallBasic.Ext.<version>.vsix`

### 9.2 共享载荷

`SmallBasic.Ext` 与 `SmallBasic.Vsix` 一样，继续携带：

- `debugadapter/adapter.js`
- `runhost/csharp/**`
- `runhost/blazor/**`
- `runhost/javascript/smallbasic-runhost.js`
- vendor 编译器与工具库程序集
- `SmallBasic.VsCommon.dll`（两个包都带）
- `SmallBasic.LanguageServices.dll`（仅 `SmallBasic.Ext`）

### 9.3 安装约束

为避免两个扩展同时安装时出现重复菜单和重复 editor provider，本包定位为**替代实现**而非推荐并装方案；VSIX 标识将与经典包区分，但文档中注明不建议共装。

## 10. 测试策略

### 10.1 保持已有回归面

- `visual_studio_plugin/tests/SmallBasic.Compiler.Tests`
- `dotnet build visual_studio_plugin/src/SmallBasic.Vsix/SmallBasic.Vsix.csproj`
- `visual_studio_code_plugin` 的 vitest / Playwright 用例

### 10.2 `SmallBasic.Ext.Tests` 覆盖

测试工程直接引用 `SmallBasic.LanguageServices`（不再链接编译源码），覆盖：

- `SmallBasicLspAnalysisService` 的协议映射：
  - Completion item kind / snippet 格式映射；
  - Hover 内容与标识符范围映射；
  - 诊断范围从编译器 inclusive end 到 LSP exclusive end 的换算；
  - DocumentSymbol 层级与 kind 映射。
- `SmallBasicLspStream` 的帧读写：`Content-Length` 头、UTF-8 正文、连续报文的顺序、空流返回 `null`。
- `SmallBasicLanguageServer` 的**端到端 JSON-RPC**（两个内存流对喂真实报文）：
  - `initialize` 能力声明与 `serverInfo.version`；
  - `didOpen` 发布诊断、`didChange` 重新发布、`didClose` 清空；
  - `completion` / `hover` / `documentSymbol` 的响应结构；
  - 未知方法返回 `-32601`；
  - 未打开文档返回空结果；
  - 输入结束即退出。
- `SmallBasicOutlineBuilder` 的树形转换：
  - 主程序变量归组；过程与子变量嵌套；文档顺序保持；行列映射正确。

### 10.3 打包脚本校验

- 产物文件名正确；
- VSIX v3 关键条目存在；
- 新扩展主程序集、公共库程序集与运行时载荷齐全；
- `extension.vsixmanifest` 声明的 MEF 组件包含 `SmallBasic.VsCommon.dll`；
- Release 包不含 PDB、不夹带 Node.js 运行时。

## 11. 实施顺序

1. 新建设计文档并登记索引；
2. 创建 `SmallBasic.Ext` 工程与 manifest；
3. 接入 `VisualStudio.Extensibility` 入口与最小兼容 `AsyncPackage`；
4. 用 `Command` / `MenuConfiguration` 重写 Tools 菜单；
5. 复用运行/调试/Workspace/Editor 代码；
6. 接入 `LanguageServerProvider` 与 Small Basic 内置 LSP server；
7. 实现文档大纲工具窗口；
8. **抽取 `SmallBasic.LanguageServices` 与 `SmallBasic.VsCommon` 公共库，替换原有的链接编译**；
9. **补齐 LSP 协议端到端测试并让测试工程改为引用公共库**；
10. 扩展版本同步、解决方案、Build-All 与打包脚本；
11. 编译、测试、打包并校验两个 VSIX。

## 12. 非目标（本次不做）

- 立即把分类着色 / 导航栏 / 折叠 / 调试内联值也全部改写为纯 LSP / Language Configuration；
- 立即把所有 legacy editor provider 从 `SmallBasic.Ext` 里清零；
- 让 `SmallBasic.Vsix` 与 `SmallBasic.Ext` 在同一实例中长期共装并零冲突运行。

## 13. 验收标准

- 存在新工程：`visual_studio_plugin/src/SmallBasic.Ext/SmallBasic.Ext.csproj`；
- 两个公共库存在且被正确引用：
  - `src/SmallBasic.VsCommon/SmallBasic.VsCommon.csproj`（`SmallBasic.Vsix` 与 `SmallBasic.Ext` 都引用）；
  - `src/SmallBasic.LanguageServices/SmallBasic.LanguageServices.csproj`（`SmallBasic.Ext` 与测试都引用）；
- `SmallBasic.Ext` 中**不再有指向 `SmallBasic.Vsix` 源码的批量 `<Compile Include>`**（只保留 `SmallBasicLanguageService.cs` 一处，原因见 6.3）；
- 能生成 `SmallBasic.Ext.<version>.vsix`，且两个包都包含并声明 `SmallBasic.VsCommon.dll` 为 MEF 组件；
- 新包具备 Tools 菜单的三后端运行/调试命令；
- 新包具备 `LanguageServerProvider`，并通过 LSP 提供补全 / 悬停 / 诊断 / 文档符号；
- 新包具备“Show Document Outline”工具窗口；
- `dotnet test visual_studio_plugin/tests/SmallBasic.Ext.Tests` 全绿；
- 现有语言服务、运行与调试行为不退化；
- 构建脚本与版本同步脚本已纳入新工程。
