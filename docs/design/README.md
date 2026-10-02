# Small Basic IDE 插件技术方案文档集

> 目标：基于 `official_repo` 中现有的 Small Basic 编译器/运行时源码，为 **Visual Studio 2026** 与 **Visual Studio Code** 设计并实现插件，提供：
>
> - 创建 Small Basic 文件（`*.sb`）
> - 语法着色
> - IntelliSense（补全 / 悬停 / 诊断）
> - 编译运行
> - 代码调试（断点 / 单步 / 变量 / 调用栈）

> **2026-09-28 现状校准**
>
> 本文档集最初按“双宿主各用原生后端”的设想编写，落地过程中已经演进为**三后端**（JavaScript / C# / Blazor）与“拷贝到 `vendor/` 再包一层”的源码消费方式。阅读时请注意：
>
> - 源码不是拷进 `packages/sb-lang-core`、`src/SB.Compiler*`，而是拷贝到 `visual_studio_code_plugin/vendor/SmallBasicOnline` 与 `visual_studio_plugin/vendor/SmallBasicEditor`（各含 `UPSTREAM.md`）；TS 侧再经 npm 包 `smallbasic-lang-core` 统一再导出。
> - 运行/调试现有三个后端：JS、C#（Windows 桌面图形宿主 / 跨平台便携宿主）、Blazor（WASM + SVG 图形宿主，见 [09](./09-Blazor与Web运行宿主.md)）。
> - 调试适配器不是两个独立包（`sb-debug` / `SB.DebugAdapter`），而是内嵌在扩展与 RunHost 中（见 [05](./05-调试架构设计.md)）。
> - 设计文档中提及的 `conformance/` 目录与若干“二期”功能部分尚未落地，各文档已在对应位置标注真实状态。
>
> **2026-09-30 补充（Visual Studio 侧收敛为单包）**
>
> - Visual Studio 侧已收敛为**唯一包** `SmallBasic.Vsix`，详见 [04](./04-VisualStudio插件设计.md) 第 9 节：命令/工具窗走新版扩展 SDK，补全/悬停/诊断/文档符号走**内置 LSP server**，调试与编辑器深能力走包内 MEF 兼容层。
> - 过渡期的双包结构（`SmallBasic.Vsix` 经典包 + `SmallBasic.Ext` 新框架包 + `SmallBasic.VsCommon` 共享库）已取消，实现全部合并回 `SmallBasic.Vsix`；保留的公共库只有 `SmallBasic.LanguageServices`（netstandard2.0，LSP/大纲语言层，与测试工程共享同一程序集）。
> - 因此“不用 LSP 通吃两端”这一结论仍然成立，但要补一句：LSP 只在**同进程内**服务于 VS 包，VS Code 侧继续使用扩展进程内的原生 Provider API。
>
> **2026-09-30 补充（Web 模式调试落地）**
>
> - VS Code 的 `mode: "web"` 已支持 `javascript` 与 `blazor` 的 F5 调试：**两个后端都在 Webview 内运行**（JavaScript 引擎在页面里，Blazor 是页面的 WASM），共用同一份 Inline DAP 适配器，F5 都会弹出页面并由 VS Code 原生调试 UI 驱动；`csharp` 仍只支持 `mode: "cli"`。详见 [09](./09-Blazor与Web运行宿主.md)。
> - Web 调试协议集中在 `src/web/debug-protocol.ts`（`protocolVersion` = 1），C# 侧在 `SmallBasic.Blazor.Shared/Protocol.cs` 镜像；断点吸附、条件断点、单步与终止语义集中在宿主无关的 `src/debug/engine-driver.ts`（CLI JavaScript DAP 与页面内 JavaScript 运行时共用），Blazor 侧复用 `BrowserEngineSession`。CLI 各后端体验不变。

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-源码现状分析.md](./01-源码现状分析.md) | 对 SmallBasicEditor(.NET)、SmallBasicOnline(TS)、SmallBasicHomeSite 三个子模块的可复用资产调查结论 |
| [02-技术选型与总体架构.md](./02-技术选型与总体架构.md) | dotnet / JS 运行时选型对比、总体架构、关键决策（ADR） |
| [03-VSCode插件设计.md](./03-VSCode插件设计.md) | VS Code 扩展的详细设计：monorepo 结构、语法着色、语言特性、三后端运行、打包发布 |
| [04-VisualStudio插件设计.md](./04-VisualStudio插件设计.md) | VS 2022/2026 VSIX 扩展的详细设计：VisualStudio.Extensibility + VSSDK 混合托管、LSP 语言能力、MEF 编辑器兼容层及三后端运行与调试 |
| [05-调试架构设计.md](./05-调试架构设计.md) | 基于 DAP 的调试适配器设计、断点吸附实现、三后端在两端 IDE 的接入方式 |
| [06-运行时库与宿主集成.md](./06-运行时库与宿主集成.md) | TextWindow / GraphicsWindow 等标准库在 JS / C# / Blazor 三个宿主上的落地方式与分期 |
| [07-测试与性能方案.md](./07-测试与性能方案.md) | 测试现状（vendor 既有测试 + 扩展测试）、性能预算与优化手段 |
| [08-实施路线图.md](./08-实施路线图.md) | 里程碑划分、验收标准与当前完成度 |
| [09-Blazor与Web运行宿主.md](./09-Blazor与Web运行宿主.md) | Blazor / CLI RunHost、静态 Web RunHost，以及 VS Code Web 模式的运行与调试链路 |
| [10-Playground与Tauri本地应用.md](./10-Playground与Tauri本地应用.md) | Monaco Playground 的入口、共享语言 Worker、构建分发、页内调试、实测状态，以及 Tauri 本地应用、C# CLI 后端（2026-10-03 收敛）和 `runhost/playground/` 统一产物布局 |
| [11-SmallBasic语言扩展.md](./11-SmallBasic语言扩展.md) | Function/EndFunction、参数、Dim 作用域和 Return 返回值的双编译器、三后端、调试与编辑器详细实施方案 |

## 方案摘要（TL;DR）

**核心结论：双宿主各用其原生运行时，不跨语言桥接。**

| | VS Code 插件 | Visual Studio 2026 插件 |
|---|---|---|
| 语言核心 | SmallBasicOnline 的 TypeScript 编译器**拷贝**到 `visual_studio_code_plugin/vendor/SmallBasicOnline`（TS 2.5→5.x），由 npm 包 `smallbasic-lang-core` 再导出后在扩展进程内直接调用 | SmallBasicEditor 的 `SmallBasic.Compiler`**拷贝**到 `visual_studio_plugin/vendor/SmallBasicEditor/Source`，作为 SDK 风格 `netstandard2.0` 项目在 VS 进程内直接引用 |
| 语法着色 | TextMate 语法（新建）+ 语义令牌（基于 compiler tokens） | MEF `IClassifier`（基于 compiler Scanner 的 tokens） |
| IntelliSense | `CompletionService` / `HoverService` / `Compilation.diagnostics` 直接映射到 VS Code API | `CompletionItemProvider` / `HoverProvider` / `Diagnostics` 映射到 VS Async Completion / Error List |
| 运行 | JS、C# 与 Blazor 三后端 | C#、JS 与 Blazor 三后端；F5/Ctrl+F5 默认 C# |
| 调试 | TS、C# 与 Blazor DAP；Blazor 文本程序走 CLI，图形程序按需打开 WASM 页面 | 同一组 DAP 适配器，经 VS **Debug Adapter Host** 接入 |
| 文档数据源 | HomeSite 的 `SmallBasicLibrary.xml`（21 语言本地化）用于补全/悬停文案 | 同左 |

**为什么不用一套 LSP 服务通吃两端**：现状两套编译器都已功能完整且带测试，分别在目标宿主的母语运行时下；引入 LSP/IPC 会增加进程管理、序列化与部署成本，却无法消除 VS 侧仍需要的 MEF 分类器等原生代码。双引擎行为发散风险用**共享一致性测试集**（同一批 `.sb` 程序 + 期望输出，双引擎对跑）对冲。

**源码消费方式**：子模块代码**全部拷贝出**到两个插件的 `vendor/` 目录（`visual_studio_code_plugin/vendor/SmallBasicOnline` 与 `visual_studio_plugin/vendor/SmallBasicEditor`），脱离上游独立维护，并升级适配最新工具链与运行时（TypeScript 5.x + Node 20 LTS + vitest；.NET 8 SDK + 最新 C# LangVersion + xunit 新版）。TS 侧由 npm 包 `smallbasic-lang-core` 再导出语言核心；.NET 侧以 `netstandard2.0` 项目被 VSIX 与各 RunHost 引用。上游仓库已多年停更，拷贝无同步负担；各 vendor 目录内含 `UPSTREAM.md` 记录来源路径与拷贝日期以便追溯。详见 [02-技术选型与总体架构.md](./02-技术选型与总体架构.md) ADR-4。
