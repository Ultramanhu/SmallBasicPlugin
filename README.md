# SmallBasicPlugin

Microsoft Small Basic 语言支持插件，适用于 **Visual Studio 2022/2026** 与 **Visual Studio Code**。

| 宿主 | DisplayName | identify | 
|---|---|---|
| Visual Studio 2022/2026 | SmallBasic for Visual Studio (Classic) | smallbasic-tools-vs |
| Visual Studio 2022/2026(Extensibility) | SmallBasic for Visual Studio (Extensibility) | smallbasic-tools-vsext |
| Visual Studio Code | SmallBasic for Visual Studio Code | smallbasic-tools-vsc |

origin repository: https://github.com/sb

## 功能总览

| 功能 | VS Code | VS Code for the Web | Visual Studio(Classic) | Visual Studio(Ext / LSP) |
|---|---|---|---|---|
| `.sb` 文件关联与语法着色 | 有(TextMate + 语义令牌双层着色) | 有(同VSCode，运行于 Web Worker) | 有(MEF 分类器着色) | 有(()兼容层 MEF 分类器着色) |
| IntelliSense 补全 | 有 | 有 | 有 | 有 |
| 悬停 Quick Info | 有 | 有 | 有 | 有 |
| 实时诊断 | 波浪线 | 波浪线 | 波浪线 | 波浪线 |
| 代码片段 + 新建文件 | 有 | 有 | 仅代码片段 | 仅代码片段 |
| 文档大纲 + 导航栏 | 有 | 有 | 仅支持导航栏 | 有(LSP 文档符号 + 新框架大纲工具窗 + 兼容导航栏) |
| 运行程序 | CLI 三后端(JS / C# / Blazor)+ Web 双后端(JS / Blazor) | Web 双后端(JS / Blazor) | CLI 三后端(JS / C# / Blazor) | CLI 三后端(JS / C# / Blazor) |
| 图形程序(GraphicsWindow/Shapes/Turtle) | C#(Windows)或跨平台 Blazor | Blazor WASM 在 Webview 内渲染 SVG | C# 桌面窗口或 Blazor 浏览器窗口 | C# 桌面窗口或 Blazor 浏览器窗口 |
| 调试(断点/单步/变量/调用栈) | 三后端；Blazor 支持跨平台图形调试 | 仅 JavaScript 后端(F5)；Blazor 调试需本机 RunHost，暂未支持 | 三后端；C#/Blazor 支持图形调试 | 三后端；C#/Blazor 支持图形调试 |
| 多语言 | 支持 | 支持 | 支持 | 支持 |

各后端共享相同的 Small Basic 调试语义(断点吸附、单步、变量展开)；Blazor 图形调试由 RunHost 把 IDE 的 DAP 与浏览器内 WASM 解释器桥接起来。

四个方案共用同一套语言与运行基线，差异只在宿主与接入方式：

- **VS Code / VS Code for the Web**：同一个扩展，靠 `mode`(`cli` / `web`)选择运行面；Web 面没有本机进程，因此语言核心跑在 Web Worker 里，C# 后端不可用。
- **Visual Studio(Classic)**：`SmallBasic.Vsix`，功能最完整的传统集成，编辑器深能力(分类器、补全、悬停、诊断、折叠、原生导航栏、F5 过滤器)全部走经典 VSSDK/MEF。
- **Visual Studio(Ext / LSP)**：`SmallBasic.Ext`，把命令与工具窗迁到 VisualStudio.Extensibility，并把补全 / 悬停 / 诊断 / 文档符号改由**进程内 LSP server** 提供，用来验证新框架迁移路径；其余编辑器深能力复用经典实现。
- 两条 Visual Studio 路线共用同一份实现，而不是各写一份：命令与调试启动、Open Folder 调试目标、分类器、折叠、原生导航栏、调试内联值位于公共库 `SmallBasic.VsCommon`；新框架路线的 LSP 模型、编译语义映射、大纲构建与内置 language server 位于公共库 `SmallBasic.LanguageServices`(`SmallBasic.Ext.Tests` 也直接引用后者)。详见 [docs/design/11-VisualStudio.Extensibility迁移设计.md](docs/design/11-VisualStudio.Extensibility迁移设计.md)。
- **注意：两个Visual Studio插件不要同时安装，会冲突，选择一个即可。**

VS Code 的 `launch.json` 使用 `mode` 选择运行面：`"cli"`(默认)走本机命令行/调试宿主，`"web"` 走浏览器 Webview。Web 模式支持 JavaScript 与 Blazor；C# 需要本机进程，只支持 CLI。VS Code for the Web 没有本机进程，会把启动配置强制按 Web 模式处理。

## VS Code 扩展

要求 VS Code **1.96+**。使用 Blazor 后端还需要 .NET 8 与 ASP.NET Core 8 Runtime(安装 .NET 8 SDK 已包含构建所需组件)。

### 安装

```powershell
code --install-extension build\SmallBasic.VSCode-0.1.4.vsix
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

Web 配置(桌面 VS Code 按 Ctrl+F5 运行；JavaScript 仍可按 F5 逐行调试)：

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

浏览器里没有本机进程，因此：

| 能力 | vscode.dev |
|---|---|
| 语法着色 / 补全 / 悬停 / 诊断 / 大纲 | 支持(在 Web Worker 扩展宿主内运行语言核心) |
| Run with JavaScript Backend | 支持(Webview 内的 `TextWindow` 文本交互) |
| **Run with Blazor Backend** | **支持**：Blazor WebAssembly 客户端在同页面 Webview 中运行，`GraphicsWindow`/`Shapes`/`Turtle` 绘制为 SVG，`TextWindow` 输出镜像到「输出」面板(渠道 `SmallBasic (Web)`) |
| Debug(F5) | 仅 JavaScript 后端；Blazor 调试需要本机 RunHost，暂未支持 |

Webview 使用随扩展分发的 `runhost/blazor/wwwroot` 和 `dist/web-runhost.js`，因此不需要额外的服务端或本机运行时。

### 本地调试 Web 端功能

```powershell
.\runhost\Build-RunHost.ps1                    # 产出 runhost/blazor(含 wwwroot/_framework)
cd visual_studio_code_plugin
npm install
npm run build                                  # dist/web/extension.js(浏览器单文件 bundle)
npm run stage:blazor -w smallbasic-tools-vsc    # 只把 runhost/blazor 暂存进扩展目录(Web 端所需的最小载荷)
```

然后在 VS Code 里按 `F5` 选择 **“SmallBasic Web Extension (VS Code Web host)”**(已写入本仓库 `.vscode/launch.json`：`pwa-extensionHost` + `debugWebWorkerHost` + `--extensionDevelopmentKind=web`)：扩展会跑在 Web Worker 宿主里，Webview 的 CSP 与资源域限制和 vscode.dev 一致，可直接在扩展代码里下断点(`npm run build` 默认带 sourcemap，断点落在 `src/**/*.ts`)。打开 `test/` 下任意 `.sb`(如 `test/tutorial/level1.sb`)后执行 JavaScript 或 Blazor 运行命令；两个命令都会在 Webview 中运行。

> **该配置必须用 `F5`(启动调试)启动。** `debugWebWorkerHost` 会让 Web Worker 扩展宿主停在第一行等调试器；若用 `Ctrl+F5` / 「运行(不调试)」启动，没有调试器去继续它，10 秒后会提示「扩展主机在 10 秒内没有启动…需要调试器继续」。只想跑起来看效果就用 **“SmallBasic Web Extension (VS Code Web host, no worker debugging)”**(同一份参数、不调试 Worker 宿主，F5 / Ctrl+F5 都能启动)。

`.vscode/launch.json` 还提供 **“SmallBasic Extension (VS Code desktop host, non-Web)”**：同样走 `pwa-extensionHost` 但不加 `--extensionDevelopmentKind=web`，扩展按 `main` 入口加载进普通 Node 扩展宿主，用来调试语言服务、DAP 适配器与三个 RunHost 的启动流程。

进入 Web 宿主**之后**，运行/调试 Small Basic 程序(`.sb`)会强制使用 `mode: "web"`：`Ctrl+F5`(运行但不调试)会把 JavaScript 或 Blazor 请求送进 Webview 执行；`F5` 的逐行调试只支持 JavaScript 后端，显式 `backend: "blazor"` 会给出提示(改用 `Ctrl+F5` 或上面的运行命令)。判定表在 `packages/smallbasic-vscode/src/web/run-routing.ts`，由 `tests/web-routing.spec.ts` 覆盖。

### 用 Playwright 调试 Webview 页面

Webview 里真正难调的是「CSP + 跨域载荷 + WebAssembly 启动」这一小段，`tests/webview` 里的 Playwright 用例把它变成可重复、可断点的本地测试(用真实浏览器、真实 `buildWebviewHtml()` 生成的文档、真实暂存的 Blazor 载荷，页面与载荷刻意分处两个源)：

```powershell
cd visual_studio_code_plugin
npm run test:web                                    # 页面级用例(CSP/CORS/WASM/图形/Stop)
npm run test:web -- --headed --debug                # 打开浏览器逐步调试
$env:SB_WEB_BROWSER="msedge"; npm run test:web      # 复用已安装的 Edge，免下载 Chromium
$env:SB_WEB_WORKBENCH="1"; npm run test:web -- --grep workbench   # 可选：真实 VS Code Web 工作台
```

- `tests/webview/webview-document.spec.ts`：断言 `ready → notify:ready → output → notify:terminated` 全部到达、SVG 图形渲染、输出镜像到宿主、**零 CSP/控制台错误**，并把截图写入 `tests/webview/artifacts/`。
- `tests/webview/vscode-web.spec.ts`(默认跳过)：用本机 VS Code 的 `code serve-web` 起一个真实 Web 工作台，从位置安装扩展后运行图形程序。它依赖一个干净的工作台环境(工作区信任、没有抢焦点的聊天/Agent 扩展)，因此默认不参与 `npm run test:web`。
- 首次运行需要 Chromium：`npx playwright install chromium`(国内网络较慢时可用上面的 `SB_WEB_BROWSER` 复用系统浏览器)。

### 其他方式

- **真机 vscode.dev**：用 `mkcert` 生成证书，`npx serve --cors --ssl-cert <cert> --ssl-key <key> .` 提供本地扩展目录，在 vscode.dev 执行 `Developer: Install Extension From Location…`。
- **独立站点**：`runhost\web` 里的 `run.bat` / `run.ps1` 起本地静态服务器并自动打开浏览器，页面本身就是同一套 WASM 引擎，改 `shell.js` 即可快速验证(实现说明与验证记录见 [docs/design/10-WebRunHost.md](docs/design/10-WebRunHost.md))。

## Visual Studio 扩展

要求 VS 2022(17.0+，amd64；17.4+，arm64)或 VS 2026。默认的 C# 运行与调试路径不需要 Node.js；仅 JavaScript 路径要求系统安装 **Node.js 20+**。VSIX 只携带 JS 单文件 bundle，不内置 Node.js。

### 安装

Classic：双击 `build\SmallBasic.Vsix.0.1.4.vsix`，按 VSIX Installer 提示完成安装。
Extensibility：双击 `build\SmallBasic.Ext.0.1.4.vsix`，按 VSIX Installer 提示完成安装。

> `Extensibility` 基于 **VisualStudio.Extensibility in-proc + VSSDK 兼容层**，用于验证新框架迁移路径；它和 `Classic` 共享同一份运行/调试后端，但语言能力中的**补全 / 悬停 / 诊断 / 文档符号**已改由内置 LSP server 提供，**不建议与经典包长期共装**。

### 使用

打开任意 `.sb` 文件(无需项目系统，可直接「打开文件夹」)，即可获得语法着色、补全、悬停、错误列表、代码折叠与编辑器顶部抬头(面包屑)。F5/Ctrl+F5 默认使用纯 C# 路径：

| 按键 | 行为 |
|---|---|
| `Ctrl+F5` | 使用内置 net48 C# 运行宿主运行当前 `.sb`；支持图形程序 |
| `F5` | 使用纯 C# DAP 调试当前 `.sb`；支持断点、单步、变量、调用栈和图形窗口 |
| `F10` / `F11`(设计时) | 以「入口即断」方式启动调试 |
| 调试会话中 `F5`/`F10`/`F11`/`Shift+F5` | 继续 / 单步 / 步入 / 停止，直接转发给调试器 |

`工具 (Tools) > Small Basic` 子菜单还提供七个显式入口，可随时选择后端或打开大纲：

- `Run with C# Backend`
- `Debug with C# Backend`
- `Run with JavaScript Backend`
- `Debug with JavaScript Backend`
- `Run with Blazor Backend`
- `Debug with Blazor Backend`
- `Show Document Outline` — 打开「Small Basic 大纲」工具窗口，列出当前文件的所有过程(`Sub`)及其内部首次使用的变量，双击条目可跳转

> Visual Studio 自带的「文档大纲」窗口只服务于设计器视图(XAML/WinForms)与 HTML，不会连通任何文本编辑器扩展。编辑器顶部的**原生导航栏**(C#/TypeScript 使用的那一条)只能由传统语言服务提供 `IVsCodeWindow` 后挂接，因此本插件注册了一个不含着色器、不含编辑器工厂的极简语言服务，只用来拿到代码窗口，再把大纲作为 `IVsDropdownBarClient` 挂上去：左侧下拉 = `<主程序>` + 所有过程，右侧下拉 = 该作用域中首次使用的变量，光标移动时自动同步选中项。此外「工具 > Small Basic > Show Document Outline」还提供一个独立的大纲工具窗口。过程名(`Sub` 声明与调用)使用与方法名一致的着色，与 VS Code 端的 `function` 语义令牌对应。

在「打开文件夹」模式中，Visual Studio 的「显示或隐藏调试目标」会按所选菜单项使用 C#、JavaScript 或 Blazor 的 Debug Adapter Host 启动描述。Blazor 目标指向 `dotnet SmallBasic.Blazor.RunHost.dll debug`；文本程序在宿主内调试，图形程序则通过 WebSocket 连接浏览器内的 WASM 解释器。

JavaScript 运行与调试使用外部 Node.js 20+，不支持 `GraphicsWindow`、`Shapes`、`Turtle` 等图形库；选择 JS 路径运行图形程序时，插件会在启动前给出提示并停止。

其中两条 Visual Studio 路线的分工如下：

- `SmallBasic.Vsix`：经典实现，语言能力由 **MEF / Async Completion / QuickInfo / ErrorTagger** 等原生编辑器扩展提供；
- `SmallBasic.Ext`：迁移实现，命令/工具窗走 **VisualStudio.Extensibility**，语言能力中的 **补全 / 悬停 / 实时诊断 / 文档符号** 已改由 **LSP provider + 内置 Small Basic language server** 提供；分类着色、导航栏、F5/打开文件夹调试等暂保留兼容层。

两者**不重复实现相同逻辑**，公共部分集中在两个普通类库(不是链接编译源码)：

| 公共库 | 目标框架 | 内容 | 谁在用 |
|---|---|---|---|
| `SmallBasic.VsCommon` | `net48` | 命令与调试启动/运行过滤器、编译缓存与输出窗口诊断、Open Folder 调试目标、分类器、折叠、原生导航栏、调试内联值、`VersionInfo` | `SmallBasic.Vsix` + `SmallBasic.Ext`(都声明为 MEF 组件) |
| `SmallBasic.LanguageServices` | `netstandard2.0` | LSP 模型、`SmallBasicCompilation` → LSP 语义映射、文档大纲构建、Content-Length 帧读写、内置 LSP server | `SmallBasic.Ext` + `SmallBasic.Ext.Tests` |

例外只有一处：`SmallBasicLanguageService.cs` 必须留在包程序集内(`ProvideObject` 的 `RegistrationMethod.CodeBase` 会把 CLSID 指向 `$PackageFolder$` 下的包程序集)，因此 `SmallBasic.Ext` 仍链接编译这一个文件，其余全部通过程序集引用。原因见 [docs/design/11-VisualStudio.Extensibility迁移设计.md](docs/design/11-VisualStudio.Extensibility迁移设计.md) 第 6 节。

## Web RunHost(浏览器内静态站点)

`runhost\web` 是随 RunHost 分发一起构建的**纯静态站点**：没有服务端进程、不连接任何服务器，打开页面即可在本机浏览器里运行 `.sb` 程序。页面没有编辑器，只有一个工具栏：

- **程序列表**：构建时把仓库 `test\` 下的 `.sb` 示例打包到 `samples\`(并生成 `samples/index.json`)，默认选中 `test/hello/hello.sb`；选择图形程序(`GraphicsWindow`/`Shapes`/`Turtle`)时后端会自动切到 Blazor。
- **选择/拖入本地文件**：`选择 .sb 文件…` 或直接把文件拖到页面上。
- **后端**：`JavaScript`(TextWindow)或 `Blazor WASM`(含图形)；Run / Stop 与状态栏。

输出同时写入页面与浏览器控制台(F12 → Console)；输入(`TextWindow.Read`/`ReadNumber`)在页面内输入框完成。

| 后端 | 执行位置 | 能力 |
|---|---|---|
| JavaScript | 浏览器内的 TS 编译器与解释器(`smallbasic-js.js`) | `TextWindow` 文本输入输出与前景/背景色 |
| Blazor WASM | 浏览器内的 .NET WebAssembly(按需加载 `_framework`) | `TextWindow`，以及 `GraphicsWindow`/`Shapes`/`Turtle` 的 SVG 图形 |

浏览器不允许从 `file://` 加载 WebAssembly，因此需要一个 HTTP 静态服务器(`runhost\web` 自带一个零依赖的，并会顺带打开默认浏览器)：

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

`-Configuration` 会透传到全部子构建：`runhost\Build-RunHost.ps1`(各平台 `dotnet publish`)、VS Code 打包脚本(连同它暂存的 RunHost 载荷)、`SmallBasic.Vsix` / `SmallBasic.Ext` 两个 Visual Studio 项目，以及各自的 VSIX 打包脚本，保证所有产物来自同一配置。

三个打包脚本(`visual_studio_code_plugin\build\Package-Vsix.ps1`、`visual_studio_plugin\build\Package-Vsix.ps1` 与 `visual_studio_plugin\build\Package-Ext-Vsix.ps1`)都依赖 RunHost 分发：单独执行时会先调用 `runhost\Build-RunHost.ps1`，而 `Build-All.ps1` 已经把它作为第一步，因此对这些脚本传入 `-SkipRunHost`，避免同一份载荷被重复构建。

构建产物：

| 产物 | 路径 |
|---|---|
| RunHost 运行时分发 | `runhost\net48`、`runhost\net8.0`、`runhost\net8.0-windows`、`runhost\javascript`、`runhost\blazor` |
| Web RunHost 静态站点 | `runhost\web`(浏览器内 JS / Blazor WASM 双后端，含 `samples\` 示例与 `run.cmd` 一键启动) |
| VS Code 扩展包 | `visual_studio_code_plugin\build\SmallBasic.VSCode-0.1.4.vsix` |
| Visual Studio 扩展包 | `visual_studio_plugin\build\SmallBasic.Vsix.0.1.4.vsix` |
| Visual Studio Extensibility 扩展包 | `visual_studio_plugin\build\SmallBasic.Ext.0.1.4.vsix` |

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

# Visual Studio Extensibility 扩展
.\visual_studio_plugin\build\Package-Ext-Vsix.ps1 -Configuration Release
.\visual_studio_plugin\build\Package-Ext-Vsix.ps1 -Configuration Release -SkipRunHost
dotnet build visual_studio_plugin\src\SmallBasic.Ext\SmallBasic.Ext.csproj -c Release

# 两个 VS 公共库(两个 VSIX 工程会作为项目引用自动带上它们，单独构建用于快速校验)
dotnet build visual_studio_plugin\src\SmallBasic.VsCommon\SmallBasic.VsCommon.csproj -c Release
dotnet build visual_studio_plugin\src\SmallBasic.LanguageServices\SmallBasic.LanguageServices.csproj -c Release

# Visual Studio 侧测试(LSP 语义映射、LSP 协议端到端、文档大纲)
dotnet test visual_studio_plugin\tests\SmallBasic.Ext.Tests\SmallBasic.Ext.Tests.csproj
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
├── visual_studio_plugin/          # VS 扩展(经典 VSIX + VisualStudio.Extensibility 两条路线)
│   ├── src/SmallBasic.VsCommon/   # 公共库(net48)：两条 VS 路线共享的命令/调试/MEF 编辑器深能力
│   ├── src/SmallBasic.LanguageServices/  # 公共库(netstandard2.0)：LSP 模型/语义映射/大纲/内置 server
│   ├── src/SmallBasic.Vsix/       # 经典路线：AsyncPackage + VSCT + MEF 补全/悬停/诊断
│   ├── src/SmallBasic.Ext/        # 新框架路线：Extensibility 命令/工具窗 + LSP provider
│   ├── src/SmallBasic.RunHost/    # 运行宿主(net48/net8.0/net8.0-windows，含 DAP 调试)
│   ├── src/SmallBasic.Blazor.*/   # WASM 客户端、共享协议与 Blazor RunHost
│   ├── tests/SmallBasic.Ext.Tests/  # LSP 语义映射、LSP 协议端到端与文档大纲测试(net8.0)
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
