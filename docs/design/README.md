# Small Basic IDE 插件技术方案文档集

> 目标：基于 `official_repo` 中现有的 Small Basic 编译器/运行时源码，为 **Visual Studio 2026** 与 **Visual Studio Code** 设计并实现插件，提供：
>
> - 创建 Small Basic 文件（`*.sb`）
> - 语法着色
> - IntelliSense（补全 / 悬停 / 诊断）
> - 编译运行
> - 代码调试（断点 / 单步 / 变量 / 调用栈）

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-源码现状分析.md](./01-源码现状分析.md) | 对 SmallBasicEditor(.NET)、SmallBasicOnline(TS)、SmallBasicHomeSite 三个子模块的可复用资产调查结论 |
| [02-技术选型与总体架构.md](./02-技术选型与总体架构.md) | dotnet / JS 运行时选型对比、总体架构、关键决策（ADR） |
| [03-VSCode插件设计.md](./03-VSCode插件设计.md) | VS Code 扩展的详细设计：工程结构、语法着色、语言特性、运行、打包发布 |
| [04-VisualStudio插件设计.md](./04-VisualStudio插件设计.md) | VS 2026 VSIX 扩展的详细设计：MEF 编辑器扩展、分类器、补全、错误列表、新建文件 |
| [05-调试架构设计.md](./05-调试架构设计.md) | 基于 DAP 的调试适配器设计、断点实现方案、双 IDE 接入方式 |
| [06-运行时库与宿主集成.md](./06-运行时库与宿主集成.md) | TextWindow / GraphicsWindow 等标准库在两个宿主上的落地方式与分期 |
| [07-测试与性能方案.md](./07-测试与性能方案.md) | 测试金字塔、双引擎一致性测试、性能预算与优化手段 |
| [08-实施路线图.md](./08-实施路线图.md) | 里程碑划分与验收标准 |

## 方案摘要（TL;DR）

**核心结论：双宿主各用其原生运行时，不跨语言桥接。**

| | VS Code 插件 | Visual Studio 2026 插件 |
|---|---|---|
| 语言核心 | **拷贝并升级** SmallBasicOnline 的 TypeScript 编译器为独立 npm 包 `sb-lang-core`（TS 2.5→5.x），在扩展进程内直接调用 | **拷贝并升级** SmallBasicEditor 的 `SmallBasic.Compiler` 为现代 SDK 风格项目（netstandard2.0 目标 + 最新 C# 工具链），在 VS 进程内直接引用 |
| 语法着色 | TextMate 语法（新建）+ 语义令牌（基于 compiler tokens） | MEF `IClassifier`（基于 compiler Scanner 的 tokens） |
| IntelliSense | `CompletionService` / `HoverService` / `Compilation.diagnostics` 直接映射到 VS Code API | `CompletionItemProvider` / `HoverProvider` / `Diagnostics` 映射到 VS Async Completion / Error List |
| 运行 | JS 与 C# 双后端 | C# 与 JS 双后端；F5/Ctrl+F5 默认 C# |
| 调试 | TS 与 C# 两套 DAP 调试适配器；Windows F5 自动默认 C# 图形宿主 | 同一组 TS/C# DAP 适配器，经 VS **Debug Adapter Host** 接入 |
| 文档数据源 | HomeSite 的 `SmallBasicLibrary.xml`（21 语言本地化）用于补全/悬停文案 | 同左 |

**为什么不用一套 LSP 服务通吃两端**：现状两套编译器都已功能完整且带测试，分别在目标宿主的母语运行时下；引入 LSP/IPC 会增加进程管理、序列化与部署成本，却无法消除 VS 侧仍需要的 MEF 分类器等原生代码。双引擎行为发散风险用**共享一致性测试集**（同一批 `.sb` 程序 + 期望输出，双引擎对跑）对冲。

**源码消费方式**：子模块代码**全部拷贝出**到两个插件目录内（`visual_studio_code_plugin/packages/sb-lang-core` 与 `visual_studio_plugin/src/SB.Compiler*`），脱离上游独立维护，并升级适配最新工具链与运行时（TypeScript 5.x + Node 20 LTS + vitest；.NET 8 SDK + 最新 C# LangVersion + xunit 新版）。上游仓库已多年停更，拷贝无同步负担；拷贝时记录来源提交哈希以便追溯。详见 [02-技术选型与总体架构.md](./02-技术选型与总体架构.md) ADR-4。
