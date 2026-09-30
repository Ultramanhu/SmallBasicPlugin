# SmallBasicPlugin

Microsoft Small Basic 语言支持插件，适用于 **Visual Studio 2022/2026** 与 **Visual Studio Code**。

| 宿主 | DisplayName | identify | 
|---|---|---|
| Visual Studio 2022/2026 | SmallBasic for Visual Studio | smallbasic-tools-vs |
| Visual Studio Code | SmallBasic for Visual Studio Code | smallbasic-tools-vsc |

origin repository: https://github.com/sb

## 功能总览

| 功能 | VS Code | VS Code for the Web | Visual Studio |
|---|---|---|---|
| `.sb` 文件关联与语法着色 | 有(TextMate + 语义令牌双层着色) | 有(同VSCode，运行于 Web Worker) | 有(MEF 分类器着色) |
| IntelliSense 补全 | 有 | 有 | 有(LSP) |
| 悬停 Quick Info | 有 | 有 | 有(LSP) |
| 实时诊断 | 波浪线 | 波浪线 | 波浪线(LSP) |
| 代码片段 + 新建文件 | 有 | 有 | 仅代码片段 |
| 文档大纲 + 导航栏 | 有 | 有 | 有(LSP 文档符号 + 大纲工具窗 + 原生导航栏) |
| 运行程序 | CLI 三后端(JS / C# / Blazor)+ Web 双后端(JS / Blazor) | Web 双后端(JS / Blazor) | CLI 三后端(JS / C# / Blazor) |
| 图形程序(GraphicsWindow/Shapes/Turtle) | C#(Windows)或跨平台 Blazor | Blazor WASM 在 Webview 内渲染 SVG | C# 桌面窗口或 Blazor 浏览器窗口 |
| 调试(断点/单步/变量/调用栈) | 三后端；Blazor 支持跨平台图形调试 | 仅 JavaScript 后端(F5)；Blazor 调试需本机 RunHost，暂未支持 | 三后端；C#/Blazor 支持图形调试 |
| 多语言 | 支持 | 支持 | 支持 |

各后端共享相同的 Small Basic 调试语义(断点吸附、单步、变量展开)；Blazor 图形调试由 RunHost 把 IDE 的 DAP 与浏览器内 WASM 解释器桥接起来。

三个方案共用同一套语言与运行基线，差异只在宿主与接入方式：

- **VS Code / VS Code for the Web**：同一个扩展，靠 `mode`(`cli` / `web`)选择运行面；Web 面没有本机进程，因此语言核心跑在 Web Worker 里，C# 后端不可用。
- **Visual Studio**：`SmallBasic.Vsix` 包。菜单 / 命令 / 大纲工具窗走新版扩展 SDK，补全 / 悬停 / 诊断 / 文档符号由**进程内 LSP server** 提供；分类着色、折叠、原生导航栏、调试内联值、F5 过滤器、Open Folder 调试目标由包内兼容层(MEF / DTE)承担。语言层位于独立程序集 `SmallBasic.LanguageServices`(`SmallBasic.LanguageServices.Tests` 直接引用同一程序集)。详见 [docs/design/11-VisualStudio.Extensibility迁移设计.md](docs/design/11-VisualStudio.Extensibility迁移设计.md)。

VS Code 的 `launch.json` 使用 `mode` 选择运行面：`"cli"`(默认)走本机命令行/调试宿主，`"web"` 走浏览器 Webview。Web 模式支持 JavaScript 与 Blazor；C# 需要本机进程，只支持 CLI。VS Code for the Web 没有本机进程，会把启动配置强制按 Web 模式处理。

## VS Code 扩展

要求 VS Code **1.96+**。使用 Blazor 后端还需要 .NET 8 与 ASP.NET Core 8 Runtime(安装 .NET 8 SDK 已包含构建所需组件)。

### 安装

```powershell
code --install-extension build\SmallBasic.VSCode-0.1.5.vsix
```

或在扩展面板 `…` 菜单中选择「从 VSIX 安装…」。

### 使用

- **新建文件**：命令面板执行 `SmallBasic: New File`，或在资源管理器右键文件夹选择新建，自动写入 Hello World 模板。
- **语法着色 / 补全 / 悬停 / 诊断**：打开任意 `.sb` 文件自动生效，无需配置。
- **运行**(编辑器标题栏播放按钮或命令面板)：
  - `SmallBasic: Run with JavaScript Backend` — CLI 模式使用内置 JS 引擎和终端；VS Code for the Web 在 Webview 内运行，支持 `TextWindow` 文本交互；
  - `SmallBasic: Run with C# Backend` — 使用内置 .NET 运行宿主：Windows 下为图形宿主(net8.0-windows，支持 `GraphicsWindow`/`Shapes` 等图形程序)，Linux/macOS 下为便携命令行宿主(net8.0)；
  - `SmallBasic: Run with Blazor Backend` — CLI 模式使用跨平台混合 RunHost；Web 模式在浏览器 Webview 内运行 Blazor WASM，支持 `GraphicsWindow`、`Shapes`、`Turtle` 和 `TextWindow`。
- **调试**：`.sb` 文件中打断点后按 F5。Windows 桌面版在未显式指定后端时默认使用随扩展分发的 C# 图形宿主，可直接调试 `GraphicsWindow` / `Shapes` / `Turtle`；其他平台默认使用 JS。也可以在 `launch.json` 中显式选择：

CLI 配置(默认，C#、JavaScript、Blazor 均可)：

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with JavaScript backend",
  "program": "${file}", "backend": "javascript", "mode": "cli", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with C# backend",
  "program": "${file}", "backend": "csharp", "mode": "cli", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with Blazor backend",
  "program": "${file}", "backend": "blazor", "mode": "cli", "stopOnEntry": false }
```

Web 配置(JavaScript、Blazor)：

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [Web]: Run current file with JavaScript backend",
  "program": "${file}", "backend": "javascript", "mode": "web", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [Web]: Run current file with Blazor backend",
  "program": "${file}", "backend": "blazor", "mode": "web", "stopOnEntry": false }
```

  支持断点(自动吸附到最近可执行行)、逐语句/逐过程/跳出、暂停/继续、变量(含 SB 数组递归展开)、调用栈。

### 设置

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `smallbasic.diagnostics.debounceMs` | `150` | 编辑后重新计算诊断的延迟 |
| `smallbasic.csharp.runHostPath` | `""` | 指定 `SmallBasic.RunHost.exe`/`.dll` 路径；为空时使用扩展内置宿主 |
| `smallbasic.blazor.runHostPath` | `""` | 指定 `SmallBasic.Blazor.RunHost.dll`/可执行文件路径；为空时使用扩展内置宿主 |

### VS Code for the Web(vscode.dev)

浏览器里没有本机进程，因此：调试模式仅支持 Web (包括 JavaScript 和 Blazor 后端)。

## Visual Studio 扩展

要求 VS 2022(17.14+，amd64 / arm64) 或 VS 2026。默认的 C# 运行与调试路径不需要 Node.js；仅 JavaScript 路径要求系统安装 **Node.js 20+**。VSIX 只携带 JS 单文件 bundle，不内置 Node.js。

### 安装

双击 `visual_studio_plugin\build\SmallBasic.Vsix.0.1.5.vsix`，按 VSIX Installer 提示完成安装；已安装的旧版本会被自动升级替换。

### 使用

打开任意 `.sb` 文件(无需项目系统，可直接「打开文件夹」)，即可获得语法着色、补全、悬停、错误列表、代码折叠与编辑器顶部抬头(面包屑)。F5/Ctrl+F5 默认使用纯 C# 路径：

| 按键 | 行为 |
|---|---|
| `Ctrl+F5` | 使用内置 net48 C# 运行宿主运行当前 `.sb`；支持图形程序 |
| `F5` | 使用纯 C# DAP 调试当前 `.sb`；支持断点、单步、变量、调用栈和图形窗口 |
| `F10` / `F11`(设计时) | 以「入口即断」方式启动调试 |
| 调试会话中 `F5`/`F10`/`F11`/`Shift+F5` | 继续 / 单步 / 步入 / 停止，直接转发给调试器 |

在「打开文件夹」模式中，Visual Studio 的「显示或隐藏调试目标」会按所选菜单项使用 C#、JavaScript 或 Blazor 的 Debug Adapter Host 启动描述。Blazor 目标指向 `dotnet SmallBasic.Blazor.RunHost.dll debug`；文本程序在宿主内调试，图形程序则通过 WebSocket 连接浏览器内的 WASM 解释器。

可以手动添加 `launch.vs.json` 文件来配置调试选项。

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with JavaScript backend",
  "program": "${file}", "backend": "javascript", "mode": "cli", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with C# backend",
  "program": "${file}", "backend": "csharp", "mode": "cli", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with Blazor backend",
  "program": "${file}", "backend": "blazor", "mode": "cli", "stopOnEntry": false }
```

JavaScript 运行与调试使用外部 Node.js 20+，不支持 `GraphicsWindow`、`Shapes`、`Turtle` 等图形库；选择 JS 路径运行图形程序时，插件会在启动前给出提示并停止。

## RunHost

### RunHostCLI

`runhost\` 下按平台分发五套 CLI 运行宿主，统一用法：`run --file <program.sb>` 运行程序，`debug` 进入 DAP 调试适配器(stdin/stdout 承载协议)。各后端的平台与能力差异如下：

| 目录 | 入口 | 平台 | 图形支持 | 限制 |
|---|---|---|---|---|
| `net48\` | `SmallBasic.RunHost.exe` | Windows | 有(WPF 桌面窗口) | 仅 Windows；需 .NET Framework 4.8 |
| `net8.0-windows\` | `SmallBasic.RunHost.exe` | Windows | 有(WPF 桌面窗口) | 仅 Windows；需 .NET 8 桌面运行时 |
| `net8.0\` | `SmallBasic.RunHost.dll` | Windows / Linux / macOS | 无 | 纯文本；图形库未编译进宿主 |
| `javascript\` | `smallbasic-runhost.js` | 任意(Node.js 20+) | 无 | 纯文本；调用图形库以退出码 3 终止；`Program.Delay` 有已知缺陷 |
| `blazor\` | `SmallBasic.Blazor.RunHost.dll` | Windows / Linux / macOS | 有(浏览器 SVG) | 图形程序需打开浏览器；需 .NET 8 运行时 |

**C# 宿主**(`net48` / `net8.0-windows` / `net8.0`，共享同一 `SmallBasic.RunHost`)：

```powershell
# 运行(--pause 在程序结束后等待按键再退出)
.\runhost\net48\SmallBasic.RunHost.exe run --file test\hello\hello.sb
.\runhost\net8.0-windows\SmallBasic.RunHost.exe run --file test\tetris\tetris.sb
dotnet .\runhost\net8.0\SmallBasic.RunHost.dll run --file test\hello\hello.sb

# 调试(DAP 适配器)
.\runhost\net48\SmallBasic.RunHost.exe debug
dotnet .\runhost\net8.0\SmallBasic.RunHost.dll debug
```

Windows 图形宿主(`net48` / `net8.0-windows`)直接在桌面 WPF 窗口内渲染 `GraphicsWindow`/`Shapes`/`Turtle`；便携文本宿主(`net8.0`)在编译时排除了图形库，仅支持 `TextWindow`。退出码：0 成功、1 用法/编译错误、3 不支持的库、4 运行时异常。

**JavaScript 宿主**(`javascript\`)：

```powershell
node .\runhost\javascript\smallbasic-runhost.js run --file test\hello\hello.sb
```

仅支持 `TextWindow`(终端着色)；调用 `GraphicsWindow`/`Shapes` 会以退出码 3 终止。`Program.Delay` 沿用共享 TS 运行时的缺陷(以 `Evaluation stack empty` 终止程序)，含延时的程序建议改用 C# 或 Blazor 后端。

**Blazor 宿主**(`blazor\`)：

```powershell
# 纯文本程序在当前终端执行，不启动浏览器
dotnet .\runhost\blazor\SmallBasic.Blazor.RunHost.dll run --file test\hello\hello.sb

# 图形程序启动随机 localhost 端口并打开浏览器(SVG 渲染)；--no-open 仅打印会话 URL 不自动打开
dotnet .\runhost\blazor\SmallBasic.Blazor.RunHost.dll run --file test\tetris\tetris.sb --no-open

# DAP 调试(文本程序直接调试；图形程序经 WebSocket 桥接浏览器内 WASM 解释器)
dotnet .\runhost\blazor\SmallBasic.Blazor.RunHost.dll debug
```

Blazor 宿主先用 `UsesGraphicsWindow` 分析程序：纯文本程序在终端内执行，图形程序才启动浏览器会话。实现细节见 [docs/design/09-Blazor后端与RunHost.md](docs/design/09-Blazor后端与RunHost.md)。

### RunHostWeb

`runhost\web` 是随 RunHost 分发一起构建的**纯静态站点**：没有服务端进程、不连接任何服务器，打开页面 `index.html` 即可在本机浏览器里运行 `.sb` 程序。页面没有编辑器，只有一个工具栏：

```powershell
cd runhost\web
.\run.bat                 # Windows：双击即可，启动本地服务器并打开浏览器
.\run.ps1                 # PowerShell(Windows / Linux / macOS 的 pwsh 均可)
node serve.mjs            # 直接调用服务器(--no-open 只启动服务器，--port 指定端口)
```

`serve.mjs` 会按 `Accept-Encoding` 协商下发 `_framework` 的 `.br` 预压缩文件，其余与普通静态服务器一致；整个目录也可直接发布到 GitHub Pages / IIS / nginx 等任意静态托管。

同一个页面也被 CLI Blazor 宿主复用：`dotnet runhost\blazor\SmallBasic.Blazor.RunHost.dll run --file program.sb` 打开的 `?session=<id>` 页面会自动隐藏编辑器，只渲染该会话的图形窗口。实现说明见 [docs/design/10-WebRunHost.md](docs/design/10-WebRunHost.md)。

## 示例程序

`test/` 目录提供样例：

- `test/hello/` — 最小文本程序
- `test/tutorial/` — 官方样例教程(Windows C# 图形后端或跨平台 Blazor 后端)
- `test/tetris/` — 图形程序(Windows C# 图形后端或跨平台 Blazor 后端)

## 从源码构建

依赖：Node.js 20+ 与 npm、.NET SDK、.NET Framework 4.8 开发工具包(VSIX 项目 net48)。

扩展版本号统一由仓库根目录的 `version.json` 提供，Visual Studio 与 VS Code 两个插件共用同一个版本。构建入口会自动执行 `node tools/sync-version.mjs`，把该版本写入扩展清单、生成的 C# 常量(`VersionInfo.g.cs`)与本文档；修改版本时只需编辑 `version.json` 后重新构建(或手动执行该同步脚本)。

一键构建全部发布产物：

```powershell
.\Build-All.ps1                          # Release 全量构建
.\Build-All.ps1 -Configuration Debug     # Debug 构建
.\Build-All.ps1 -SkipVsix                # 仅构建 RunHost 分发
.\Build-All.ps1 -SkipJavaScript          # 跳过 JS 运行宿主打包
```

`-Configuration` 会透传到全部子构建：`runhost\Build-RunHost.ps1`(各平台 `dotnet publish`)、VS Code 打包脚本(连同它暂存的 RunHost 载荷)、Visual Studio 的 `SmallBasic.Vsix` 项目，以及各自的 VSIX 打包脚本，保证所有产物来自同一配置。

两个打包脚本(`visual_studio_code_plugin\build\Package-Vsix.ps1` 与 `visual_studio_plugin\build\Package-Vsix.ps1`)都依赖 RunHost 分发：单独执行时会先调用 `runhost\Build-RunHost.ps1`，而 `Build-All.ps1` 已经把它作为第一步，因此对这些脚本传入 `-SkipRunHost`，避免同一份载荷被重复构建。

构建产物：

| 产物 | 路径 |
|---|---|
| RunHost 运行时分发 | `runhost\net48`、`runhost\net8.0`、`runhost\net8.0-windows`、`runhost\javascript`、`runhost\blazor` |
| Web RunHost 静态站点 | `runhost\web`(浏览器内 JS / Blazor WASM 双后端，含 `samples\` 示例与 `run.cmd` 一键启动) |
| VS Code 扩展包 | `visual_studio_code_plugin\build\SmallBasic.VSCode-0.1.5.vsix` |
| Visual Studio 扩展包 | `visual_studio_plugin\build\SmallBasic.Vsix.0.1.5.vsix` |

单独构建：

```powershell
# VS Code 扩展(构建 + 打包)
cd visual_studio_code_plugin
npm install
npm run build              # 构建
npm test                   # vitest 测试
.\build\Package-Vsix.ps1 -Configuration Debug   # 先构建 RunHost 分发，再打包 VSIX
.\build\Package-Vsix.ps1 -SkipRunHost           # 复用已构建好的 RunHost 分发

# Visual Studio 扩展
.\visual_studio_plugin\build\Package-Vsix.ps1 -Configuration Release   # 先构建 RunHost 分发，再打 VSIX
.\visual_studio_plugin\build\Package-Vsix.ps1 -Configuration Release -SkipRunHost
# 只构建 VSIX 工程(RunHost net48 / Blazor 载荷由工程自身的 MSBuild target 暂存)
dotnet build visual_studio_plugin\src\SmallBasic.Vsix\SmallBasic.Vsix.csproj -c Release

# 语言层公共库(VSIX 工程会作为项目引用自动带上它，单独构建用于快速校验)
dotnet build visual_studio_plugin\src\SmallBasic.LanguageServices\SmallBasic.LanguageServices.csproj -c Release

# Visual Studio 侧测试(LSP 语义映射、LSP 协议端到端、文档大纲)
dotnet test visual_studio_plugin\tests\SmallBasic.LanguageServices.Tests\SmallBasic.LanguageServices.Tests.csproj
# 或直接用解决方案构建全部工程
dotnet build visual_studio_plugin\SmallBasic.VisualStudio.slnx -c Release
```

Visual Studio 包由 `Microsoft.VSSDK.BuildTools` 原生生成完整 VSIX v3 声明(包括
`manifest.json`、`catalog.json` 和 `extensionDir`)；打包脚本只负责校验并复制生成物，
不会手工改写安装清单。

## 仓库结构

```
SmallBasicPlugin/
├── Build-All.ps1                  # 一键构建入口
├── runhost/                       # RunHost 多平台分发(Build-RunHost.ps1)
├── visual_studio_code_plugin/        # VS Code 扩展(npm monorepo)
│   └── packages/
│       ├── smallbasic-lang-core/  # 语言核心(TS 编译器 + 执行引擎)
│       └── smallbasic-vscode/     # 扩展本体(含 DAP 调试适配器)
├── visual_studio_plugin/          # VS 扩展(单一 VSIX 包)
│   ├── src/SmallBasic.LanguageServices/  # 公共库(netstandard2.0)：LSP 模型/语义映射/大纲/内置 server
│   ├── src/SmallBasic.Vsix/        # 唯一的 VS 包：菜单/命令/工具窗 + LSP 语言能力 + 包内兼容层(MEF/调试)
│   ├── src/SmallBasic.RunHost/    # 运行宿主(net48/net8.0/net8.0-windows，含 DAP 调试)
│   ├── src/SmallBasic.Blazor.*/   # WASM 客户端、共享协议与 Blazor RunHost
│   ├── tests/SmallBasic.LanguageServices.Tests/  # LSP 语义映射、LSP 协议端到端与文档大纲测试(net8.0)
│   └── vendor/SmallBasicEditor/   # 拷贝升级的 Small Basic 编译器(C#)
├── test/                          # 示例程序
├── official_repo/                 # 官方源码子模块(editor / homesite / online)
└── docs/design/                   # 设计文档(01-11)
```

`runhost\web` 由 `runhost\Build-RunHost.ps1` 组装：外壳页面(`index.html`/`app.css`/`shell.js`/`serve.mjs`)来自 `visual_studio_plugin\src\SmallBasic.Blazor.Client\wwwroot`，JavaScript 后端 `smallbasic-js.js` 来自 `visual_studio_code_plugin` 的 tsup 打包(`src\runhost\web.ts`)，其余为 Blazor 客户端的发布产物。重建该目录前请先停止正在服务的 `serve.mjs`，否则 Windows 会让复制落入已被删除的旧目录。

## 已知限制

- CLI 的 JS 后端暂不支持 `GraphicsWindow`/`Shapes`/`Turtle` 等图形库；桌面 Web 模式可用 Blazor Webview 运行图形程序。
- VS 扩展的 C# 路径不依赖 Node.js；仅 JS 运行/调试路径依赖外部 Node.js 20+。
- Web RunHost 的 JavaScript 后端与 Node 版 RunHost 同源，同样只支持 `TextWindow`；`Program.Delay` 沿用了共享 TS 运行时的缺陷(Node 宿主会以 `Evaluation stack empty` 终止程序)，Web 端通过放行一次无害的 promise 拒绝实现容错，含 `Program.Delay` 的程序建议改用 Blazor 后端。
