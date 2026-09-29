# SmallBasicPlugin

Microsoft Small Basic 语言支持插件，适用于 **Visual Studio 2022/2026** 与 **Visual Studio Code**。

| 宿主 | DisplayName | identify | 
|---|---|---|
| Visual Studio 2022/2026 | SmallBasic for Visual Studio | smallbasic-tools-vs |
| Visual Studio Code | SmallBasic for Visual Studio Code | smallbasic-tools-vsc |

origin repository: https://github.com/sb

## 功能总览

| 功能 | VS Code | Visual Studio |
|---|---|---|
| `.sb` 文件关联与语法着色 | 有(TextMate + 语义令牌双层着色) | 有(MEF 分类器着色) |
| IntelliSense 补全 | 有 | 有 |
| 悬停 Quick Info | 有 | 有 |
| 实时诊断 | 波浪线 + 问题 | 波浪线 |
| 代码片段 + 新建文件 | 有 | 仅代码片段 |
| 文档大纲 + 导航栏 | 有 | 仅支持导航栏 |
| 运行程序 | 三后端（JS / C# / Blazor） | C#，其他后端有问题 |
| 图形程序（GraphicsWindow/Shapes/Turtle） | C#（Windows）或跨平台 Blazor | C# 桌面窗口或 Blazor 浏览器窗口 |
| 调试（断点/单步/变量/调用栈） | 三后端；Blazor 支持跨平台图形调试 | 三后端；Blazor 支持图形调试 |
| 多语言 | 支持 | 支持 |

各后端共享相同的 Small Basic 调试语义（断点吸附、单步、变量展开）；Blazor 图形调试由 RunHost 把 IDE 的 DAP 与浏览器内 WASM 解释器桥接起来。

## VS Code 扩展

要求 VS Code **1.96+**。使用 Blazor 后端还需要 .NET 8 与 ASP.NET Core 8 Runtime（安装 .NET 8 SDK 已包含构建所需组件）。

### 安装

```powershell
code --install-extension build\SmallBasic.VSCode-0.1.3.vsix
```

或在扩展面板 `…` 菜单中选择「从 VSIX 安装…」。

### 使用

- **新建文件**：命令面板执行 `SmallBasic: New File`，或在资源管理器右键文件夹选择新建，自动写入 Hello World 模板。
- **语法着色 / 补全 / 悬停 / 诊断**：打开任意 `.sb` 文件自动生效，无需配置。
- **运行**（编辑器标题栏播放按钮或命令面板）：
  - `SmallBasic: Run with JavaScript Backend` — 内置 JS 引擎，跨平台（含 VS Code for the Web），支持 `TextWindow` 文本交互；
  - `SmallBasic: Run with C# Backend` — 使用内置 .NET 运行宿主：Windows 下为图形宿主（net8.0-windows，支持 `GraphicsWindow`/`Shapes` 等图形程序），Linux/macOS 下为便携命令行宿主（net8.0）；
  - `SmallBasic: Run with Blazor Backend` — 跨平台混合 RunHost：普通 `TextWindow` 程序直接留在终端运行；仅当编译分析发现 `GraphicsWindow`、`Shapes` 或 `Turtle` 时，才启动本机 Blazor WebAssembly 页面并在 SVG 中渲染图形。
- **调试**：`.sb` 文件中打断点后按 F5。Windows 桌面版在未显式指定后端时默认使用随扩展分发的 C# 图形宿主，可直接调试 `GraphicsWindow` / `Shapes` / `Turtle`；其他平台默认使用 JS。也可以在 `launch.json` 中显式选择：

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Debug current file with JavaScript backend",
  "program": "${file}", "backend": "javascript", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Debug current file with C# backend",
  "program": "${file}", "backend": "csharp", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Debug current file with Blazor backend",
  "program": "${file}", "backend": "blazor", "stopOnEntry": false }
```

  支持断点（自动吸附到最近可执行行）、逐语句/逐过程/跳出、暂停/继续、变量（含 SB 数组递归展开）、调用栈。

### 设置

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `smallbasic.diagnostics.debounceMs` | `150` | 编辑后重新计算诊断的延迟 |
| `smallbasic.csharp.runHostPath` | `""` | 指定 `SmallBasic.RunHost.exe`/`.dll` 路径；为空时使用扩展内置宿主 |
| `smallbasic.blazor.runHostPath` | `""` | 指定 `SmallBasic.Blazor.RunHost.dll`/可执行文件路径；为空时使用扩展内置宿主 |

## Visual Studio 扩展

要求 VS 2022（17.0+，amd64；17.4+，arm64）或 VS 2026。默认的 C# 运行与调试路径不需要 Node.js；仅 JavaScript 路径要求系统安装 **Node.js 20+**。VSIX 只携带 JS 单文件 bundle，不内置 Node.js。

### 安装

双击 `build\SmallBasic.Vsix.0.1.3.vsix`，按 VSIX Installer 提示完成安装。

### 使用

打开任意 `.sb` 文件（无需项目系统，可直接「打开文件夹」），即可获得语法着色、补全、悬停、错误列表、代码折叠与编辑器顶部抬头（面包屑）。F5/Ctrl+F5 默认使用纯 C# 路径：

| 按键 | 行为 |
|---|---|
| `Ctrl+F5` | 使用内置 net48 C# 运行宿主运行当前 `.sb`；支持图形程序 |
| `F5` | 使用纯 C# DAP 调试当前 `.sb`；支持断点、单步、变量、调用栈和图形窗口 |
| `F10` / `F11`（设计时） | 以「入口即断」方式启动调试 |
| 调试会话中 `F5`/`F10`/`F11`/`Shift+F5` | 继续 / 单步 / 步入 / 停止，直接转发给调试器 |

`工具 (Tools) > Small Basic` 子菜单还提供七个显式入口，可随时选择后端或打开大纲：

- `Run with C# Backend`
- `Debug with C# Backend`
- `Run with JavaScript Backend`
- `Debug with JavaScript Backend`
- `Run with Blazor Backend`
- `Debug with Blazor Backend`
- `Show Document Outline` — 打开「Small Basic 大纲」工具窗口，列出当前文件的所有过程（`Sub`）及其内部首次使用的变量，双击条目可跳转

> Visual Studio 自带的「文档大纲」窗口只服务于设计器视图（XAML/WinForms）与 HTML，不会连通任何文本编辑器扩展。编辑器顶部的**原生导航栏**（C#/TypeScript 使用的那一条）只能由传统语言服务提供 `IVsCodeWindow` 后挂接，因此本插件注册了一个不含着色器、不含编辑器工厂的极简语言服务，只用来拿到代码窗口，再把大纲作为 `IVsDropdownBarClient` 挂上去：左侧下拉 = `<主程序>` + 所有过程，右侧下拉 = 该作用域中首次使用的变量，光标移动时自动同步选中项。此外「工具 > Small Basic > Show Document Outline」还提供一个独立的大纲工具窗口。过程名（`Sub` 声明与调用）使用与方法名一致的着色，与 VS Code 端的 `function` 语义令牌对应。

在「打开文件夹」模式中，Visual Studio 的「显示或隐藏调试目标」会按所选菜单项使用 C#、JavaScript 或 Blazor 的 Debug Adapter Host 启动描述。Blazor 目标指向 `dotnet SmallBasic.Blazor.RunHost.dll debug`；文本程序在宿主内调试，图形程序则通过 WebSocket 连接浏览器内的 WASM 解释器。

JavaScript 运行与调试使用外部 Node.js 20+，不支持 `GraphicsWindow`、`Shapes`、`Turtle` 等图形库；选择 JS 路径运行图形程序时，插件会在启动前给出提示并停止。

## 示例程序

`test/` 目录提供样例：

- `test/hello/` — 最小文本程序
- `test/tutorial/` — 官方样例教程（Windows C# 图形后端或跨平台 Blazor 后端）
- `test/tetris/` — 图形程序（Windows C# 图形后端或跨平台 Blazor 后端）

## 从源码构建

依赖：Node.js 20+ 与 npm、.NET SDK、.NET Framework 4.8 开发工具包（VSIX 项目 net48）。

扩展版本号统一由仓库根目录的 `version.json` 提供，Visual Studio 与 VS Code 两个插件共用同一个版本。构建入口会自动执行 `node tools/sync-version.mjs`，把该版本写入扩展清单、生成的 C# 常量（`VersionInfo.g.cs`）与本文档；修改版本时只需编辑 `version.json` 后重新构建（或手动执行该同步脚本）。

一键构建全部发布产物：

```powershell
.\Build-All.ps1                          # Release 全量构建
.\Build-All.ps1 -Configuration Debug     # Debug 构建
.\Build-All.ps1 -SkipVsix                # 仅构建 RunHost 分发
.\Build-All.ps1 -SkipJavaScript          # 跳过 JS 运行宿主打包
```

`-Configuration` 会透传到全部子构建：`runhost\Build-RunHost.ps1`（各平台 `dotnet publish`）、VS Code 打包脚本（连同它暂存的 RunHost 载荷）、`SmallBasic.Vsix` 项目以及 `visual_studio_plugin\build\Package-Vsix.ps1`，保证所有产物来自同一配置。

构建产物：

| 产物 | 路径 |
|---|---|
| RunHost 运行时分发 | `runhost\net48`、`runhost\net8.0`、`runhost\net8.0-windows`、`runhost\javascript`、`runhost\blazor` |
| VS Code 扩展包 | `visual_studio_code_plugin\build\SmallBasic.VSCode-0.1.3.vsix` |
| Visual Studio 扩展包 | `visual_studio_plugin\build\SmallBasic.Vsix.0.1.3.vsix` |

单独构建：

```powershell
# VS Code 扩展（构建 + 打包）
cd visual_studio_code_plugin
npm install
npm run build              # 构建
npm test                   # vitest 测试
npm run package:vsix       # 打包 VSIX（默认暂存 Release 的 RunHost）
# 指定配置（等价于 npm run package:vsix）：
.\build\Package-Vsix.ps1 -Configuration Debug

# Visual Studio 扩展
dotnet build visual_studio_plugin\src\SmallBasic.Vsix\SmallBasic.Vsix.csproj -c Release
.\visual_studio_plugin\build\Package-Vsix.ps1 -Configuration Release
```

Visual Studio 包由 `Microsoft.VSSDK.BuildTools` 原生生成完整 VSIX v3 声明（包括
`manifest.json`、`catalog.json` 和 `extensionDir`）；打包脚本只负责校验并复制生成物，
不会手工改写安装清单。

## 仓库结构

```
SmallBasicPlugin/
├── Build-All.ps1                  # 一键构建入口
├── runhost/                       # RunHost 多平台分发（Build-RunHost.ps1）
├── visual_studio_code_plugin/        # VS Code 扩展（npm monorepo）
│   └── packages/
│       ├── smallbasic-lang-core/  # 语言核心（TS 编译器 + 执行引擎）
│       └── smallbasic-vscode/     # 扩展本体（含 DAP 调试适配器）
├── visual_studio_plugin/            # VS 扩展（经典 VSIX + MEF，net48）
│   ├── src/SmallBasic.Vsix/       # 编辑器集成（着色/补全/悬停/诊断/调试启动）
│   ├── src/SmallBasic.runhost/    # 运行宿主（net48/net8.0/net8.0-windows，含 DAP 调试）
│   ├── src/SmallBasic.Blazor.*/   # WASM 客户端、共享协议与 Blazor RunHost
│   └── vendor/SmallBasicEditor/   # 拷贝升级的 Small Basic 编译器（C#）
├── test/                          # 示例程序
├── official_repo/                 # 官方源码子模块（editor / homesite / online）
└── docs/design/                   # 设计文档（01-08）
```

## 已知限制

- JS 后端暂不支持 `GraphicsWindow`/`Shapes`/`Turtle` 等图形库，图形程序请使用 Windows C# 后端或跨平台 Blazor 后端。
- VS 扩展的 C# 路径不依赖 Node.js；仅 JS 运行/调试路径依赖外部 Node.js 20+。
