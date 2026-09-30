# 11 VisualStudio.Extensibility 迁移设计（最终态：单包改造）

落地目录：`visual_studio_plugin/src/SmallBasic.Vsix/`。本文档描述**最终态**：Small Basic 的 Visual Studio 支持收敛为唯一的扩展包 `SmallBasic.Vsix.<version>.vsix`，技术栈为 VisualStudio.Extensibility 入口层 + in-proc VSSDK 兼容层。

> **历史说明**
>
> 本方案经历两轮演进：
>
> 1. 经典 `SmallBasic.Vsix`（纯 VSSDK + MEF + VSCT）→ 新增 `SmallBasic.Ext`（新框架路线），两者经 `SmallBasic.VsCommon` 共享实现；
> 2. 新框架路线验证可行后反向收敛：`SmallBasic.Ext` 吸收 `SmallBasic.VsCommon` 全部内容并**改回 `SmallBasic.Vsix` 之名**，旧经典工程与共享库删除，包 Id 恢复为 `smallbasic-tools-vs`（老用户直接升级替换，无共存冲突）。

## 1. 最终架构

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

## 2. 为什么共享层只保留 LanguageServices

过渡期曾把两条 VS 路线共用的实现抽成 `SmallBasic.VsCommon`。收敛为单包后共享前提消失：

- 只剩一个消费方，"程序集级共享"不再有收益；
- `InternalsVisibleTo` 跨程序集可见性徒增复杂度。

因此 VS 集成层全部回到包工程本体。真正仍然共享的只有 `SmallBasic.LanguageServices`（netstandard2.0）：它被扩展（net48）与测试（net8.0）同时引用同一程序集，且不含任何 VS 依赖。测试工程随之命名 `SmallBasic.LanguageServices.Tests`——它只测语言层，名实相符。

## 3. 能力实现路径（最终态）

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

## 4. 退役与删除清单

| 删除项 | 理由 |
|---|---|
| 旧经典 `SmallBasic.Vsix` 工程（VSCT、旧包入口） | 被新包取代 |
| 旧经典包独有的 `Editor/Completion`、`Editor/QuickInfo`、`Editor/Squiggles` | 由 LSP completion / hover / publishDiagnostics 取代 |
| `SmallBasicSnippet` + 其测试 | VS 的 LSP 客户端**不会**展开 snippet（`insertTextFormat: Snippet` 中的 `${1:x}` 占位符被原样插入编辑器），补全文本已在 `SmallBasicLspAnalysisService` 统一摊平为纯文本参数名，解析器无存在必要 |
| `SmallBasic.VsCommon` | 唯一消费方，迁回包工程 |
| `build/Package-Ext-Vsix.ps1` | 只剩一个包，合并为 `build/Package-Vsix.ps1` |

## 5. 身份标识与注册稳定性

- VSIX Id **恢复为 `smallbasic-tools-vs`**：与旧经典包同 Id，VSIX Installer 直接升级替换，无共存冲突；
- DisplayName 为 `SmallBasic for Visual Studio`（不带任何括号后缀）；
- 包 GUID `B2A8F1D6-...`、语言服务 GUID `8F2B7C41-...`、内容类型名 `smallbasic`、Open Folder provider GUID 全部不变；
- 用户只需安装 `SmallBasic.Vsix.<version>.vsix` 一个包。

## 6. 已修复的已知问题

1. **LSP server 生命周期**：`CreateServerConnectionAsync` 的 `cancellationToken` 只约束"创建连接"，不再传给 server 读循环；改为 `CancellationToken.None`，依赖管道关闭（`ReadMessageAsync` 返回 `null`）退出，异常仍经 `TraceSource` 上报。
2. **System.Text.Json 版本下探**：`SmallBasic.LanguageServices` 引用 **8.0.5**（所用 API 自 6.0 起稳定），覆盖 VS 17.14 随附的 8.0.x 与 VS 18 的 10.0.0.10（devenv 绑定重定向 `0.0.0.0–10.0.0.10` 已实测）。
3. **命令启用规则**：六个运行/调试命令增加 `EnabledWhen`（仅 `.sb` 活动文档时启用）。
4. 诊断每次击键全量重编译暂不去抖（Small Basic 程序规模小，编译亚毫秒级，记录在案）。

## 7. 测试策略

- `SmallBasic.LanguageServices.Tests`（net8.0 → LanguageServices netstandard2.0）：LSP 协议映射、帧读写、端到端 JSON-RPC、大纲构建；
- `SmallBasic.Compiler.Tests`：编译器与运行时回归（vendor 测试套）；
- 打包脚本校验：VSIX v3 条目、`SmallBasic.Vsix.dll/.pkgdef`、`SmallBasic.LanguageServices.dll`、RunHost 三后端载荷、`debugadapter/adapter.js`、MEF 资产声明、Release 无 PDB、不夹带 Node.js。

## 8. 验收标准（已达成）

- 单一 VS 扩展工程 `SmallBasic.Vsix`；旧经典工程与 `SmallBasic.VsCommon` 目录不存在；
- 解决方案、Build-All、版本同步脚本均指向现存工程；
- `dotnet build` 全量通过；两个测试工程全绿（23 + 577）；
- `build/Package-Vsix.ps1` 产出 `SmallBasic.Vsix.<version>.vsix` 且校验通过；
- 包能力对照第 3 节表格无退化（语言能力走 LSP，调试走 in-proc 兼容层）；
- README 与设计文档索引同步更新。
