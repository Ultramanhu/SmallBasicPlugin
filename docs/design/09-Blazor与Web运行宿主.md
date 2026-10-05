# 09 Blazor 与 Web 运行宿主

> **文档拆分（2026-10-02）**
>
> 本文保留 Blazor / CLI RunHost、静态 Web RunHost 与 VS Code Web 调试设计。Monaco Playground 的页面、语言 Worker、构建分发、页内调试，以及 Tauri 本地应用方案已独立到 [10-Playground与Tauri本地应用.md](./10-Playground与Tauri本地应用.md)。
>
> 当前入口分工：`runhost.html` 服务 CLI 会话与纯运行场景；`playground.html` 提供 Monaco、共享语言 Worker、JavaScript / Blazor 双后端运行和页内调试；`index.html` 是静态站点默认入口。VS Code `mode: "web"` 继续在 Webview 内运行 JavaScript / Blazor，并使用 VS Code 原生调试 UI。

## 第一部分：Blazor WASM 与 CLI RunHost

> **当前状态**
>
> Blazor 后端由 `SmallBasic.Blazor.Shared`、`SmallBasic.Blazor.Client` 与 `SmallBasic.Blazor.RunHost` 组成。CLI 先分析 `UsesGraphicsWindow`：纯文本程序直接在终端运行，图形程序才启动本机 Kestrel 与浏览器；`--no-open` 可禁止自动打开浏览器。浏览器页面与静态站点的最终入口和资源拆分见 [10-Playground与Tauri本地应用.md](./10-Playground与Tauri本地应用.md)。

### 目标

Blazor 后端沿用 Small Basic 官方 Web 编辑器的关键边界：扫描、语法分析、绑定、指令发射、解释执行和运行时库都在浏览器中的 .NET WebAssembly 进程完成；`GraphicsWindow` 不创建操作系统窗口，而是把绘图命令写入场景模型，再由 Blazor 组件生成 SVG。

为了适配 VS/VS Code，本仓库在浏览器外增加 `SmallBasic.Blazor.RunHost`。它既是命令行宿主，也是调试适配器和本机静态站点服务器。

### 按需浏览器行为

RunHost 先用 `SmallBasicCompilation.Analysis.UsesGraphicsWindow` 分析程序：

```text
                     ┌─ 否 ─> RunHost 内 SmallBasicEngine ─> 当前终端
.sb -> 编译与分析 ───┤
                     └─ 是 ─> localhost 会话 ─> Blazor WASM ─> SVG GraphicsWindow
```

- 只使用 `TextWindow` 的程序在当前终端执行，不启动浏览器。
- 使用 `GraphicsWindow`、`Shapes` 或 `Turtle` 的程序才启动随机 localhost 端口并打开浏览器。
- `run --file program.sb` 和 DAP `debug` 模式使用同一条判定规则。

### 项目组成

| 项目 | 职责 |
|---|---|
| `SmallBasic.Blazor.Shared` | RunHost 与 WASM 共用的会话、控制命令和调试快照 DTO |
| `SmallBasic.Blazor.Client` | 浏览器内编译/解释器、运行时库、SVG 场景和运行界面 |
| `SmallBasic.Blazor.RunHost` | CLI 执行、ASP.NET Core 静态站点、会话 API、WebSocket 桥和 DAP |

发布目录是 `runhost/blazor`，入口为：

```powershell
dotnet SmallBasic.Blazor.RunHost.dll run --file program.sb [--no-open] [--pause]
dotnet SmallBasic.Blazor.RunHost.dll debug [--no-open]
```

### GraphicsWindow 实现

浏览器运行时实现编译器定义的 `IGraphicsWindowLibrary`、`IShapesLibrary` 与 `ITurtleLibrary`：

- `DrawLine`、矩形、椭圆、三角形、文本和像素被追加为 `GraphicElement`。
- `DrawImage`/`DrawResizedImage` 生成 SVG `<image>`，可直接使用 URL。
- `Shapes` 维护命名对象字典，移动、旋转、缩放、透明度和显隐修改同一场景对象。
- `Turtle` 维护坐标、角度、速度与画笔状态；移动生成线段并异步等待对应动画时长。
- 键盘和鼠标事件从 SVG DOM 回传运行时库，再由 `SmallBasicEngine` 的事件队列调用 Small Basic 子过程。

场景按固定层级渲染：普通绘图、Shapes、Turtle 轨迹、Turtle。本项目因此能正确运行教程的 `level1.sb`：背景图片位于底层，海龟和轨迹始终位于其上。

### 调试桥

文本程序直接由 RunHost 内的解释器调试。图形程序的解释器在 WASM 中，RunHost 在两种协议之间桥接：

```text
VS / VS Code <-- DAP stdin/stdout --> Blazor RunHost <-- WebSocket --> WASM engine
```

RunHost 负责 DAP 生命周期、断点吸附和 IDE 消息；WASM 负责真正的继续、单步、输入阻塞和程序执行，并在暂停时返回行号、调用栈及递归变量快照。这样运行与调试不会使用不同的图形实现。

### 安全与生命周期

- Kestrel 只监听 `127.0.0.1` 的随机端口。
- 会话使用随机 128 位标识，源码只由对应会话 API 返回。
- RunHost 在浏览器报告程序终止后退出；事件监听型程序则保持会话，直到调试器停止或浏览器关闭。
- VS Code Web 不能创建本机 RunHost 进程，因此不提供 CLI C# / CLI Blazor；它已在 Webview 内提供 JavaScript 与 Blazor WASM 的运行和调试入口。桌面 VS Code 与 Visual Studio 还可使用三种 CLI 后端。



## 第二部分：静态 Web RunHost 与 VS Code Web 模式

> **适用范围**
>
> 本部分记录静态 Web RunHost 和 VS Code `mode: "web"` 调试链的基础实现。其 `index.html` / `shell.js` 文件布局及“独立站点仅 Run / Stop”的表述属于 Playground 拆分前的实施基线；当前入口、资源归属和页内调试能力以 [10-Playground与Tauri本地应用.md](./10-Playground与Tauri本地应用.md) 为准。VS Code Webview 调试架构与协议结论仍然有效。

> **2026-09-29 新增**：本文描述 `runhost/web` 静态站点 —— 一个不需要任何服务端进程、完全在本机浏览器内执行 `.sb` 程序的 RunHost，支持 JavaScript 与 Blazor WASM 两个后端。
>
> **2026-09-30 Web 模式调试规划**：独立静态站点 `runhost/web` 继续只提供 Run/Stop，不增加断点、单步、变量、调用栈等调试 UI。调试能力建设在 VS Code 插件的 `mode: "web"` 链路中，同时支持桌面 VS Code 与 VS Code for the Web，并覆盖 JavaScript、Blazor 两个后端；`csharp` 仍只支持 `mode: "cli"`。
>
> **2026-09-30 Web 模式调试实施结果**：规划已落地，并按"web 模式两个后端体验一致"收敛为**两个后端都在 Webview 内运行、共用一份 Inline DAP 适配器**（`src/web/webview-debug-adapter.ts` + `src/web/inline-factory.ts`）：JavaScript 引擎在页面内、Blazor 引擎是页面的 WASM，F5 都会弹出同一个页面并由 VS Code 原生调试 UI 驱动。`csharp` 与「显式 JavaScript + 图形程序」仍被拒绝。调试语义集中在宿主无关的 `src/debug/engine-driver.ts`，CLI 各后端保持既有体验不变。协议、Broker、断点（含条件断点）验证与页面胶水均已实现，并补齐单元测试与页面级 E2E。详见 [调试架构](#调试架构)、[实施结果](#实施结果与原当前实现差距的收敛情况) 与 [验收结果](#web-模式调试验收结果已实施)。

### 目标

| 需求 | 落地方式 |
|---|---|
| 本地执行，不连接服务器 | 纯静态站点：程序源码、编译器、解释器、图形渲染全部在浏览器内；页面不发起任何网络请求（只有加载自身资源的同源请求） |
| JS / Blazor 两个后端 | 后端下拉框切换：`smallbasic-js.js`（TS 编译器 + 解释器）或按需加载的 Blazor WebAssembly 运行时 |
| 输入输出到页面与网页控制台 | 页面内有输出面板与输入行；所有文本输出同时写入浏览器控制台（`console.log`） |
| Blazor 后端支持 graphics | 复用既有 Blazor WASM 客户端：`GraphicsWindow`/`Shapes`/`Turtle` 绘制到 SVG 场景 |
| 复用并抽象 Blazor RunHost 界面 | 抽象出宿主通道接口，Blazor 组件同时服务于 CLI 会话（WebSocket）与 Web 站点（JS 互操作），页面外壳与 CLI 页面共用同一个 `index.html` |
| VS Code Web 模式调试 | 不扩展独立站点 UI；由 VS Code 原生调试界面承载断点、单步、变量和调用栈，JavaScript 与 Blazor 共用浏览器兼容的内联 DAP 接入，桌面/Web 两种扩展宿主行为一致 |

### 分发构成

`runhost/web` 是 `runhost/Build-RunHost.ps1` 组装出来的目录，全部为可静态托管的文件：

```
runhost/web/
├── index.html                  # 外壳页面（也是 CLI 宿主的页面）
├── app.css                     # 外壳 + Runner 组件样式
├── shell.js                    # 外壳逻辑：程序列表、后端切换、控制台/输入、JS 互操作钩子
├── serve.mjs                   # 零依赖静态服务器（含浏览器自动打开，可选用任意静态服务器替代）
├── run.bat                     # Windows 双击入口：检查 Node 后启动 serve.mjs
├── run.ps1                     # PowerShell 入口（Windows / Linux / macOS 的 pwsh 均可）
├── samples/                    # 由仓库 sample/ 复制的示例程序 + index.json 清单
├── smallbasic-js.js            # JavaScript 后端（tsup 打包的 IIFE，定义 window.SmallBasicWeb）
└── _framework/                 # Blazor WebAssembly 客户端发布产物（含 .br 预压缩文件）
```

来源：

| 文件 | 来源 |
|---|---|
| `index.html`、`app.css`、`shell.js`、`serve.mjs`、`run.bat`、`run.ps1` | `visual_studio_plugin/src/SmallBasic.Blazor.Client/wwwroot`（手写源码，仓库跟踪） |
| `_framework/**` | `dotnet publish` Blazor 宿主的 `wwwroot`（把 `SmallBasic.Blazor.Client` 的静态资源合并进来） |
| `smallbasic-js.js` | `visual_studio_code_plugin/packages/smallbasic-vscode/dist/web-runhost.js`（`npm run build` 由 `src/runhost/web.ts` 生成） |
| `samples/**` | `runhost/Build-RunHost.ps1` 复制仓库 `sample/**/*.sb` 并生成 `samples/index.json` |

> `wwwroot` 在 `.gitignore` 里被整体忽略（生成站点约定），因此 `.gitignore` 对 `SmallBasic.Blazor.Client/wwwroot` 做了白名单，否则外壳页面不会进入仓库 —— 这也正是此前 `runhost/blazor` 缺失 `index.html` 的原因。

### 架构

```text
                     ┌─────────────────────────── index.html + shell.js ───────────────────────────┐
                     │  程序列表（samples/ 或本地文件）/ 后端选择 / Run / Stop / 输出面板 / 输入行   │
                     └───────────────┬───────────────────────────────────────┬──────────────────────┘
                                     │ JavaScript 后端                        │ Blazor 后端
                                     ▼                                       ▼
                 window.SmallBasicWeb.runJavaScript(source, bridge)   await Blazor.start()  （按需注入
                 ┌───────────────────────────────────────────┐        blazor.webassembly.js，autostart=false）
                 │ Compilation → ExecutionEngine（TS 运行时） │                 │
                 │ 插件：TextWindow（页面 I/O）                │                 ▼
                 │      GraphicsWindow/Shapes → 友好拒绝       │   DotNet.invokeMethodAsync('SmallBasic.Blazor.Client',
                 └───────────────────────────────────────────┘                       'SetSession', {name, source})
                                                                                 │
                                                                                 ▼
                                                                    Runner 组件（#app）→ BrowserEngineSession
                                                                    → SmallBasicEngine + SVG 场景 + 输入行
                                                                                 │ WebShellTransport
                                                                                 ▼
                                                    window.SmallBasicWebHost.write/notify → 浏览器控制台 + 状态
```

页面外壳负责"谁来跑、跑什么、状态如何"，Blazor 侧只负责"怎么跑"。二者之间只有三个稳定的接口：

| 方向 | 接口 | 说明 |
|---|---|---|
| 外壳 → Blazor | `SmallBasicWebHost.isWebRunHost()` | 模式探测：返回 `false` 时 Runner 走 CLI 会话（HTTP + WebSocket）路径 |
| 外壳 → Blazor | `DotNet.invokeMethodAsync(..., 'SetSession', json)` / `'Stop'` | 推送一次运行请求 / 请求终止当前运行 |
| Blazor → 外壳 | `SmallBasicWebHost.write(text)` / `.notify(json)` | 文本镜像到浏览器控制台；`ready`/`terminated`/`stopped` 更新状态与按钮 |

### Blazor 侧的复用与重构

原有实现把"引擎 ↔ 宿主"写死成 WebSocket（`BrowserBridge`）。本次把这条通道抽象成接口，让同一条运行链路服务于两种宿主：

| 文件 | 变化 |
|---|---|
| `Runtime/IRunHostTransport.cs` | **新增**：`ReadAsync`/`TryRead`/`EnqueueLocal`/`SendAsync` |
| `Runtime/BrowserBridge.cs` | 实现该接口（行为不变，仍是 CLI 宿主的 WebSocket 桥） |
| `Runtime/WebShellTransport.cs` | **新增**：用 JS 互操作把 `output` 镜像到浏览器控制台，把生命周期消息交给外壳；文本输出按 50ms 合批，避免逐字符跨互操作边界 |
| `Runtime/WebRunHost.cs` | **新增**：`[JSInvokable]` 静态入口 `SetSession`/`Stop`、运行请求通道、模式探测 |
| `Runtime/BrowserEngineSession.cs` | 通道类型改为接口；新增 `UsesGraphics`（由 WASM 内编译结果判断是否需要图形面板）与 `Terminate()` |
| `Runtime/RuntimeViewModel.cs` | 新增 `Reset()`：清空文本、场景与挂起的输入，使同一页面可以连续运行多次 |
| `Pages/Runner.razor` | 双模式：探测到 Web 外壳时循环消费运行请求（可反复运行），否则沿用 `?session=` + WebSocket；新增 `@page "/{*path}"` 让静态托管的 `index.html` 子路径也能命中 |

输入仍然由 Runner 自带的输入行采集（与 CLI 宿主一致），因此 Blazor 后端不需要把 `Read`/`ReadNumber` 反向桥接到外壳。

### JavaScript 后端

`src/runhost/web.ts`（tsup `format: "iife"` → `smallbasic-js.js`，约 1.5 MB）暴露：

```ts
window.SmallBasicWeb = {
  runJavaScript(source: string, bridge: IWebRunHostBridge): Promise<number>,  // 返回退出码
  stopJavaScript(): void
};

interface IWebRunHostBridge {
  writeText(text, appendNewLine, foreground, background): void;  // TextWindow 输出（带颜色）
  readInput(kind: "string" | "number"): Promise<string>;         // TextWindow.Read/ReadNumber
  writeError(text): void;                                       // 编译诊断与运行时错误
}
```

实现要点：

- 与 Node 版宿主（`src/runhost/main.ts`）同构：同样的 `Compilation`/`ExecutionEngine` 驱动循环、同样的退出码（0 成功、1 编译错误、3 不支持库、4 运行时错误）、同样的 `TextWindow` 插件契约。
- `GraphicsWindow`/`Shapes` 插件在调用时抛出可识别的错误；此外在编译阶段用 `compilation.kind.drawsShapes()` 提前拒绝图形程序，提示切换到 Blazor 后端（退出码 3）。
- 停止：置位停止标志并 `terminate()`；若程序正阻塞在 `Read`，由外壳结束该次输入（空串）让引擎解开阻塞。
- `Program.Delay` 沿用了共享 TS 运行时的缺陷（`MethodInvocationInstruction` 在阻塞时不推进指令指针，恢复后重新执行会消费空栈）。Node 宿主会因此崩溃，浏览器则只是产生一次被忽略的 promise 拒绝；本实现改为在阻塞期间等待状态自行恢复（避免每 10ms 复现一次），并由外壳忽略这一次无害拒绝。

### 页面行为

- 页面没有编辑器：工具栏只有程序列表、`选择 .sb 文件…`、后端下拉框、Run/Stop 与状态；输出面板占满其余空间。
- 程序列表来自 `samples/index.json`（构建时由仓库 `sample/**/*.sb` 生成），默认选中 `sample/hello/hello.sb`；清单里 `graphics: true` 的程序（构建时按 `GraphicsWindow`/`Shapes`/`Turtle` 的出现判断）会自动把后端切到 Blazor。
- 用户选择的本地文件（或拖入页面的文件）会成为列表里的"本地文件：xxx.sb"项，可直接运行。
- `samples/index.json` 不可用时（例如 CLI 宿主不分发示例）回退到内置的 Hello World 程序，页面仍然可用。
- 探测 `smallbasic-js.js` 是否存在（CLI 宿主不分发它）：缺失时移除 JS 选项并给出提示，仅保留 Blazor 后端。
- 图形程序误选 JS 后端：诊断区给出"请切换到 Blazor WASM"的提示并以退出码 3 结束。
- Blazor 后端第一次运行才注入 `_framework/blazor.webassembly.js`（`autostart="false"` + 显式 `await Blazor.start()`），因此不跑图形程序时不会下载 WASM；此后同一页面可反复运行（每次 `SetSession` 会终止并重建会话）。
- Stop：先请求终止并等待运行报告，再释放会话；外壳与 Blazor 工具条都会显示 `Stopped`。若 30 秒内没有任何生命周期消息（WASM 启动失败），状态栏会给出提示而不是一直卡在"Run 中"。
- 页面底部提供 Blazor 标准 `#blazor-error-ui`，组件异常时可见。
- 直接以 `file://` 打开时页面不尝试启动 Blazor，而是提示改用 `run.bat` / `run.ps1` / `serve.mjs`。

### 构建与运行

```powershell
# 构建（web 分发随 RunHost 一起产出；-SkipWeb 可跳过）
.\runhost\Build-RunHost.ps1 -Configuration Release
.\runhost\Build-RunHost.ps1 -DotNetPlatforms net8.0 -SkipJavaScript -SkipWeb

# 本地运行（默认 http://127.0.0.1:8321/，并自动打开默认浏览器）
cd runhost\web
.\run.bat                      # Windows：双击即可（检查 Node 后启动 serve.mjs）
.\run.ps1                      # PowerShell 7（Windows / Linux / macOS），支持 -NoOpen / -Port
node serve.mjs                 # 等价直接调用：--no-open / --port 9000 / PORT / HOST
```

示例清单格式（`samples/index.json`）：

```json
{
  "default": "sample/hello/hello.sb",
  "items": [
    { "name": "sample/hello/hello.sb", "path": "samples/hello/hello.sb", "graphics": false },
    { "name": "sample/tetris/tetris.sb", "path": "samples/tetris/tetris.sb", "graphics": true }
  ]
}
```

注意：

- 浏览器不允许从 `file://` 加载 WebAssembly，因此必须经 HTTP 访问；`serve.mjs` 会按 `Accept-Encoding` 协商下发 `_framework` 的 `.br` 预压缩文件，任何静态服务器都可以替代它（此时自行用浏览器打开 `index.html`）。
- `run.bat` 面向 Windows 双击，`run.ps1` 面向 PowerShell 7（含 macOS/Linux，`#!/usr/bin/env pwsh` 便于 `chmod +x` 后直接执行）；两者都只是 `serve.mjs` 的入口，Node 缺失时会给出各平台的安装提示。
- `runhost/web` 的组装是"先删除再复制"。若此时仍有进程把该目录当作工作目录（例如正在运行的 `node serve.mjs`），Windows 会让复制落入已删除的旧目录，导致目录为空；`Build-RunHost.ps1` 会在组装后校验关键文件（含 `run.bat`/`run.ps1`/`samples\index.json`）并给出明确错误，重建前请先停止服务进程。

### CLI 宿主复用

`SmallBasic.Blazor.RunHost` 打开的 `?session=<id>` 页面与 Web 站点是同一个 `index.html`：`shell.js` 检测到 `session` 查询参数后进入 CLI 模式（隐藏工具栏与输出标题、直接启动 Blazor 运行时），`SmallBasicWebHost.isWebRunHost()` 返回 `false`，Runner 于是走原有的 HTTP 会话 API + WebSocket 桥。

### VS Code Web 模式集成（桌面 / VS Code for the Web）

#### 结论与做法

VS Code for the Web 的扩展宿主是浏览器 Web Worker，不能启动本机进程，但**可以开 Webview**。桌面 VS Code 选择 `mode: "web"` 时也必须进入同一条浏览器兼容链路，不能因为桌面扩展宿主能够启动进程就回退到 CLI RunHost。由此形成两条正交维度：

- `mode: "cli"`：仅桌面 VS Code 可用，JavaScript/C#/Blazor 使用现有本机 RunHost 或外部调试适配器；
- `mode: "web"`：桌面 VS Code 与 VS Code for the Web 均可用，不启动 Small Basic 本机子进程；JavaScript 在扩展宿主内运行，Blazor 在 Webview 的 WASM 中运行。

运行链路如下：

```text
扩展宿主（桌面 Node extension host / 浏览器 Web Worker）
  run / Ctrl+F5 → 取程序文本 → postMessage({type:"run",backend,name,source})
        │  postMessage                              ▲ { type:"ready" | "output" | "notify" | "failed" }
        ▼                                           │
WebviewPanel（扩展生成的 HTML，载荷来自扩展目录 runhost/blazor/wwwroot）
  javascript → dist/web-runhost.js → TextWindow 控制台
  blazor     → Blazor.start({ loadBootResource }) → resource-request/response → workspace.fs
                                             └→ Runner → GraphicsWindow(SVG) / TextWindow
```

- **复用现有载荷**：JavaScript 直接加载随扩展构建的 `dist/web-runhost.js`；Blazor 使用 `runhost/blazor/wwwroot`（含 `_framework`）。两者都经 `webview.asWebviewUri()` 映射，不启动本机服务器。
- **复用现有契约**：`SetSession` / `Stop`（`[JSInvokable]`）与 `SmallBasicWebHost.write/notify`（`isWebRunHost()` 返回 true 即"由外壳驱动"模式），与独立站点的 `shell.js` 完全一致，只是外壳从 `shell.js` 换成了扩展。
- Webview 侧代码：`src/web/webview-html.ts`（文档 + CSP 生成，纯函数、可单测）、`src/web/blazor-webview.ts`（panel 生命周期、载荷定位、消息协议、OutputChannel 镜像）；页面侧胶水 `SmallBasic.Blazor.Client/wwwroot/vscode-webview.js`。

这里的"复用独立 Web RunHost"指复用运行时、Blazor 组件和宿主协议，**不代表要在 `runhost/web/index.html` 中实现调试器 UI**。独立站点仍只有程序选择、后端选择、Run/Stop、输出与输入；断点编辑、当前行高亮、Variables、Call Stack、Debug Console 全部由 VS Code 原生界面提供。

#### 实测踩过的资源加载问题（都已修复）

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动即抛 `The URI 'https://…/index.html' is not contained by the base URI 'https://…cdn/…/wwwroot/'` | Webview 文档在 `vscode-webview://<id>`，把 `<base href>` 指向扩展资源域后 `document.baseURI` 与当前地址不同源；Router（以及 `NavigationManager.ToBaseRelativePath`）在启动时校验"当前地址必须被 base 包含" | Webview 文档**不放 `<base>`**：三个入口（`app.css`、`_framework/blazor.webassembly.js`、`vscode-webview.js`）都用绝对 URL；`document.baseURI` 于是等于文档地址，校验通过，Router 仍能匹配 `/` |
| 真实 vscode.dev 中 `icudt_CJK.dat` 报 `No 'Access-Control-Allow-Origin' header`，随后 `Failed to start platform` | 市场扩展载荷位于 `*.vscode-unpkg.net`，Webview 位于隔离的 `*.vscode-cdn.net` 源；脚本标签可以执行扩展脚本，但 `dotnet.js` 对 boot 配置、ICU、WASM 和程序集的 `fetch` 受 CORS 限制。只改 `blazor.boot.json` 的凭据模式仍会在下一个二进制资源处失败 | `loadBootResource` 对全部非 JS boot 资源发 `resource-request`；扩展宿主用 `workspace.fs.readFile` 从扩展 URI 读取，校验路径必须留在 `wwwroot` 内，再把 `ArrayBuffer` 通过 `postMessage` 回传为合成 `Response`。资源加载不再依赖 Marketplace CDN 的 CORS 响应头 |
| 修改后仍不启动、无任何报错 | `loadBootResource` 的 `"dotnetjs"` 类型同时覆盖 `dotnet.js`、`dotnet.native.js`、`dotnet.runtime.js`，若统一重定向会把三个模块指向同一文件 | 只在 `type === "dotnetjs" && name === "dotnet.js"` 时重定向到 `<payload>/_framework/dotnet.js`，其余保持默认（相对 `dotnet.js` 模块 URL 解析） |

CSP 要求（`webview-html.ts` 中集中定义）：

| 指令 | 为什么需要 |
|---|---|
| `default-src 'none'` | VS Code 推荐的基线，其余能力显式开放 |
| `script-src ${cspSource} 'wasm-unsafe-eval' 'unsafe-eval'` | 加载脚本 + 实例化 WASM；`'unsafe-eval'` 是 Safari 等不支持 `wasm-unsafe-eval` 的兜底 |
| `connect-src ${cspSource}` | 保留给运行时/未来资源连接；当前 boot 配置、`*.wasm`、程序集和 `icu*.dat` 经扩展宿主消息桥读取，不再跨源 `fetch` |
| `style-src ${cspSource} 'unsafe-inline'` | Runner 的 SVG 用 `style` 属性做显隐/变换，Blazor 也会输出动态内联样式；**`script-src` 仍不含 `'unsafe-inline'`** |
| `img-src ${cspSource} data: https:` | `GraphicsWindow.DrawImage` 可加载网络图片 |
| `worker-src ${cspSource} blob:` | 为将来可能的多线程运行时留出空间 |

#### Web 模式调试范围与能力矩阵

`mode: "web"` 的调试目标是"不依赖 Small Basic 本机进程"。**两个后端都在 Webview 内运行**（JavaScript 引擎在页面里，Blazor 在页面的 WASM 运行时里），因此"程序可见的执行面"和调试体验对两者一致：F5 会弹出同一个页面，断点、单步、变量、调用栈、Debug Console 输入都由 VS Code 原生调试 UI 承载。两者都通过 `DebugAdapterInlineImplementation` 接入 DAP。

| VS Code 宿主 | `mode` | JavaScript | Blazor | C# |
|---|---|---|---|---|
| 桌面 VS Code | `cli` | 现有外部 Node DAP（Debug Console） | 现有本机 Blazor RunHost DAP（浏览器页面） | 现有本机 C# RunHost DAP（宿主窗口） |
| 桌面 VS Code | `web` | Webview Inline DAP，引擎在页面内 | Webview Inline DAP，引擎在页面的 WASM 内 | 拒绝，提示改用 `mode: "cli"` 或换后端 |
| VS Code for the Web | 强制 `web` | 与桌面 `mode: "web"` 相同 | 与桌面 `mode: "web"` 相同 | 拒绝，本机进程不可用 |
| 独立 `runhost/web` | 不适用 | 仅运行，不提供调试 UI | 仅运行，不提供调试 UI | 不提供 |

功能目标为：断点及断点吸附、Continue、Pause、Step In、Step Over、Step Out、当前执行行、调用栈、全局变量/数组、程序输出、`TextWindow.Read/ReadNumber` 输入以及终止会话。JavaScript 保留条件断点（协议通过 `conditions` 透传，由页面内驱动编译求值）；Blazor 第一阶段与现有 `SmallBasic.Blazor.RunHost` 对齐，不把条件断点列为阻塞项。

#### 调试架构

```text
VS Code 原生调试 UI（桌面 / Web）
        │ DAP
        ▼
DebugAdapterInlineImplementation（扩展宿主，Node 或 Web Worker）
        │  WebviewDebugSession（同一份适配器，两个后端）
        ▼
WebDebugSessionBroker ── debug-launch / debug-command / debug-event ──▶ Webview
        （扩展宿主）                                                     │
   ┌─────────────────────────────────────────────────────────────────────┘
   │ vscode-webview.js 按 backend 分发
   ├─ javascript ─▶ window.SmallBasicWeb.debugStart/debugCommand/debugStop
   │                     ▼
   │                 BrowserDebugSession（页面内 TS 运行时）
   │                     ▼
   │                 DebugEngineDriver  ◀── 与 CLI JavaScript 适配器共用同一个驱动
   │
   └─ blazor ─────▶ DotNet.invokeMethodAsync SetSession / DispatchDebugCommand
                         ▼
                     BrowserEngineSession（Blazor WASM：断点吸附、单步、快照、输入）
```

关键约束：

1. **DAP 只存在于扩展宿主**。页面内的两个引擎都不实现 DAP，只处理与运行时相关的强类型调试命令/事件；独立 `runhost/web` 因此不需要成为 DAP 客户端。
2. **调试语义只实现一次**。断点吸附、条件断点、单步、暂停/阻塞/终止状态机集中在宿主无关的 `src/debug/engine-driver.ts`：CLI 的 JavaScript DAP 适配器（`src/debug/session.ts`）与 Webview 内的 JavaScript 运行时（`src/runhost/web-debug.ts`）都只是它的薄翻译层（一个翻译成 DAP，一个翻译成 Web 调试协议）。Blazor 侧同理复用 `BrowserEngineSession`，不做第二套断点/单步实现。
3. **桌面/Web 共用同一份 Web 调试代码**。桌面入口与 Web 入口只负责取得 `TextDocument` 和创建会话；`mode: "web"` 的 backend 路由、Inline Adapter、协议类型与会话 Broker 都放在浏览器兼容的共享模块中，不引用 `node:fs`、`node:path`、`child_process` 或 `process.execPath`。
4. **CLI 调试不受影响**。`mode: "cli"` 继续使用现有外部 JS Adapter（Debug Console 输出）、`SmallBasic.RunHost debug` 与 `SmallBasic.Blazor.RunHost debug`，各后端保持各自既有体验。

#### Web 调试协议与会话模型

现有 `HostMessage` / `BrowserMessage` 已能表达 `start`、断点数组、控制命令、输出、暂停快照、输入和终止，但 Web 调试需要把它升级为可跨 `extension host ↔ webview ↔ WASM` 安全转发的正式协议：

- 每条消息携带 `protocolVersion` 与 `sessionId`，丢弃已结束会话的迟到消息；
- 需要应答的命令携带 `requestId`，至少覆盖 launch、setBreakpoints 和 terminate；
- 命令集合固定为 `launch/start`、`setBreakpoints`、`continue`、`pause`、`next`、`stepIn`、`stepOut`、`input`、`terminate`；
- 事件集合固定为 `ready`、`breakpointsValidated`、`output`、`stopped`、`inputRequested`、`exited`、`terminated`、`error`；
- 协议内部源码行统一使用 0-based，DAP 边界转换为 1-based；
- `setBreakpoints` 必须返回吸附后的实际可执行行，不能只把原始行号写入 HashSet；
- 会话状态明确为 `creating → configuring → running/paused/waitingInput → terminated/disposed`，关闭 Webview、切换程序或启动下一会话时必须先终止旧会话。

`WebShellTransport` 已经具有接收命令的 Channel、`TryRead` 和 `EnqueueLocal`，WASM → JavaScript 的 `write/notify` 路径也已存在，因此不新增第三种 `IRunHostTransport`。改造重点是：

- `WebRunRequest`/`SessionDescriptor` 传递 `Debug`、`StopOnEntry`、`sessionId`；
- `WebRunHost` 增加统一的 `[JSInvokable] DispatchDebugCommand(...)`，把来自 Webview 的命令投入当前 `WebShellTransport`；
- `vscode-webview.js` 增加 debug launch/command 分支，并把运行时事件原样回传扩展；
- 调试状态下的 Stop 必须向命令 Channel 写入 `terminate/stop`，使正在等待 `ReadAsync()` 或输入的会话被唤醒，不能只调用 `engine.Terminate()`；
- `BrowserEngineSession` 负责断点吸附、运行控制和快照；变量快照第一阶段沿用现有递归 DTO，后续如遇大数组性能问题再演进为变量句柄/按需展开。

建议把 C#/TypeScript 两侧协议定义集中到可核对的 schema/契约测试中，避免手写 DTO 随版本漂移。Webview 消息只接受已知 `sessionId`、已知消息类型和合法字段；Blazor 资源读取仍沿用现有目录边界校验，不因调试能力扩大 CSP 或文件访问范围。

**实现说明（`src/web/debug-protocol.ts`，`protocolVersion` = 1）**：

- 编码采用单通道 + 类型字段，而不是每种控制单独一种消息：`{"protocolVersion":1,"sessionId":"…","type":"control","control":"next","depth":2}`。因此上表的 `continue/pause/next/stepIn/stepOut` 落在 `type: "control"` 的 `control` 字段，`terminate` 沿用既有 `type: "stop"`（可带 `requestId` 请求应答）。
- `launch` 由扩展侧 Broker 发 `debug-launch`（携带 `backend`/`name`/`source`/`stopOnEntry`），页面按 `backend` 分发：`javascript` 调 `SmallBasicWeb.debugStart(json)`，`blazor` 调 `SetSession`（`WebRunRequest` 携带 `debug`/`stopOnEntry`/`sessionId`）。`start` 是随后投入命令 Channel 的正式 `HostMessage`。
- 事件沿用 `BrowserMessage` 的 `type` 命名：`ready`/`breakpointsValidated`/`output`/`stopped`/`input`（对应 `inputRequested`）/`terminated`/`error`；`exited` 语义由 `terminated` 的 `exitCode` 承载。两个后端都经页面的 `SmallBasicWebHost.write/notify` 回传，所以 Webview 侧只有一条事件通路。
- 行号：`HostMessage.Breakpoints` 与 `BrowserMessage.Breakpoints` 均为 0-based；`WebviewDebugSession` 在 DAP 边界做 ±1 转换。
- 条件断点：`setBreakpoints` 带可选 `conditions`（与 `breakpoints` 位置对齐，无条件的位为空串；全无条件时不发该字段）。JavaScript 运行时把它交给 `DebugEngineDriver` 编译求值；Blazor 运行时忽略未知字段，行为与 `SmallBasic.Blazor.RunHost` 一致。
- 契约测试 `tests/debug-protocol.spec.ts` 固定了上述 JSON 形状（camelCase 字段名与 C# 的 `JsonSerializerDefaults.Web` 对齐），任何一侧改动都会先让该测试失败。翻页要点：线协议里的 C# `HostMessage`/`BrowserMessage` 不认识 `conditions` 时会被 `System.Text.Json` 直接忽略，所以新增可选字段对老运行时是安全的。

#### 组件改造清单（已实施）

| 组件 | 改造结果 |
|---|---|
| `SmallBasic.Blazor.Shared/Protocol.cs` | 新增 `DebugProtocol.Version = 1`；`HostMessage`/`BrowserMessage` 增加 `ProtocolVersion`/`SessionId`/`RequestId`，`BrowserMessage` 增加 `Breakpoints`（已校验的行）与 `Message`（错误事件） |
| `SmallBasic.Blazor.Client/Runtime/WebRunHost.cs` | 新增 `[JSInvokable] DispatchDebugCommand(json)`：校验协议版本与 `sessionId` 后投入活动会话；`WebRunRequest` 增加 `Debug`/`StopOnEntry`/`SessionId` |
| `WebShellTransport.cs` | 未改动：已有命令 Channel、`TryRead`/`EnqueueLocal` 已满足入站调试命令与终止唤醒 |
| `BrowserEngineSession.cs` | 新增 `SessionId`/`EnqueueCommand`；队列命令统一走 `ApplyHostCommandAsync`（`setBreakpoints` 吸附并回 `breakpointsValidated`、`stop` 置终止）；发往宿主的消息统一加盖协议版本与会话标识；`stop` 早于 `start` 时也会补发 `terminated`，不再让适配器等待超时 |
| `Runner.razor` | Webview 调试启动时把 `request.SessionId`/`Debug`/`StopOnEntry` 写入 `SessionDescriptor`；独立站点普通运行路径不变 |
| `vscode-webview.js` | 新增 `debug-launch`/`debug-command` 入站分支与 `debug-event` 出站通道；`output` 带 `sessionId`；普通 Run/Stop 与 `notify` 通道保持兼容 |
| `SmallBasic.Blazor.Client/wwwroot/shell.js`、`runhost/web` | 未改动：仍然只有 Run/Stop，不引入调试 UI |
| 新增 `src/web/debug-protocol.ts` | 冻结协议：`DEBUG_PROTOCOL_VERSION`、命令/事件联合类型、`encodeHostCommand`/`decodeRuntimeEvent`（版本、会话、类型与字段全部校验；行号 0-based；条件断点经 `conditions` 透传） |
| 新增 `src/web/webview-panel.ts` | 抽出 `BlazorWebviewHost`（面板生命周期 + 资源桥 + ready 记账）与载荷定位；Run 与 Debug 共用，消除重复 |
| 新增 `src/web/debug-broker.ts` | `WebDebugSessionBroker`：会话标识、`backend` 透传、ready 门控、`requestId` 关联、超时、事件订阅、经命令通道终止；不依赖 `vscode` |
| 新增 `src/web/webview-debug-adapter.ts` | `WebviewDebugSession`：两个后端共用的单一 DAP 适配器（DAP ↔ 协议）；快照映射 stackTrace/scopes/variables；`evaluate` 兼作 TextWindow 输入；`disconnect` 终止并释放；JavaScript 声明条件断点能力 |
| 新增 `src/web/inline-factory.ts` | 桌面与 Web 共用的 Inline Adapter 工厂；**两个 web 后端都创建 Webview + Broker**；同时集中 `resolveDebugDocument`/`documentBaseName` |
| 新增 `src/debug/engine-driver.ts` | 宿主无关的调试引擎驱动：断点吸附、条件断点编译求值、stopOnEntry、单步、暂停/阻塞/终止状态机、快照与变量展开 |
| `src/debug/session.ts` | 由"自带引擎循环"改写为 `DebugEngineDriver` 的薄 DAP 包装；CLI JavaScript（外部 Node Adapter）与扩展宿主行为不变，11 个既有 DAP 用例原样通过 |
| 新增 `src/runhost/web-debug.ts` | 页面内 JavaScript 调试会话：复用 `DebugEngineDriver`，只做「Web 调试协议 ↔ 驱动」翻译；`ready`/`breakpointsValidated`/`stopped`/`input`/`terminated` 全部经 `SmallBasicWebHost.notify/write` 回传 |
| `src/runhost/web.ts` | `SmallBasicWeb` 增加 `debugStart`/`debugCommand`/`debugStop`；普通 `runJavaScript`/`stopJavaScript` 不变 |
| `src/web/blazor-webview.ts` | 保留 `runInWebview`/`stopBlazorWebview` 兼容 API，内部改为使用 `BlazorWebviewHost` |
| `src/web/debug-factory.ts` | 精简为对 `createWebInlineAdapter` 的薄封装 |
| `src/web/run-routing.ts` | 纯函数路由改为 `run-in-webview`/`inline-debug`/`reject` 三态；两个后端的 F5 都放开，`csharp` 与「显式 JavaScript + 图形程序」F5 继续拒绝 |
| `src/debug/factory.ts` | `mode === "web"` 时改走共享 Inline 工厂，不再落到外部 Node Adapter |

#### 目标运行与调试路由（`mode: "web"`）

`Ctrl+F5` 表示运行但不调试，仍进入现有 Webview 运行链路；F5 创建真正的 VS Code 调试会话（同样弹页面，但由调试会话驱动）：

| 请求的后端 | `noDebug`（Ctrl+F5） | 程序使用 GraphicsWindow/Shapes/Turtle | 目标结果 |
|---|---|---|---|
| `javascript` / 未指定 | 否（F5） | 否 | Webview Inline DAP 调试，JavaScript 引擎在页面内（可见 `#console`） |
| `javascript` / 未指定 | 是 | 否 | JavaScript 后端在 Webview 内运行，不创建调试会话 |
| `blazor` | 否（F5） | 任意 | Webview Inline DAP 调试，Blazor WASM 引擎在页面内（可见 SVG 场景） |
| `blazor` | 是 | 任意 | Blazor 在 Webview 内运行，不创建调试会话 |
| 未指定 | 否（F5） | 是 | 自动选择 Blazor 并调试 |
| 未指定 | 是 | 是 | 自动选择 Blazor 并运行 |
| 显式 `javascript` | 任意 | 是 | 拒绝并提示图形程序需要 Blazor；不在用户显式选择后端时静默替换 |
| `csharp` | 任意 | 任意 | 拒绝；桌面提示改用 `mode: "cli"`，VS Code Web 提示本机进程不可用 |

路由逻辑继续集中在不依赖 `vscode` 的纯函数中，并由桌面入口与 Web 入口共同调用。未指定 backend 时可以根据 `Compilation.kind.drawsShapes()` 自动选择 JavaScript 或 Blazor；显式选择 JavaScript 后发现图形能力不兼容时应给出错误，而不是在调试期间静默切换执行语义。

#### 实施结果与原「当前实现差距」的收敛情况

规划清单已落地，原先记录的三个差距全部消除；随后按"web 模式两个后端体验一致"的要求，将 JavaScript 调试也移入 Webview，并抽出共享驱动：

| 原差距 / 追加要求 | 现状 |
|---|---|
| JavaScript 已能在 VS Code for the Web 中通过 Inline DAP 调试 | 现在两个后端共用 `WebviewDebugSession` + `WebDebugSessionBroker`，F5 都会弹出页面 |
| Blazor Web 模式只支持运行，F5 被路由/工厂拒绝 | 已放开：Webview Inline DAP + 页面内 WASM 引擎 |
| 桌面 `mode: "web"` 的 JavaScript F5 可能落到外部 Node Adapter | 已修正：`src/debug/factory.ts` 对 `mode === "web"` 直接返回共享 Inline 工厂 |
| web/js 调试不弹页面（体验与 Blazor 不一致） | 已修正：JavaScript 引擎改为在页面内运行，页面 `#console` 与 Debug Console 同时可见 |
| CLI 各后端体验不能被 Web 改造带偏 | `DebugEngineDriver` 抽取后 CLI JavaScript 行为零变化（11 个 DAP 用例原样通过）；C#/Blazor RunHost 未改 |

为减少重复代码做的抽取（均在两处以上复用）：

| 抽取项 | 复用于 |
|---|---|
| `engine-driver.ts` 的 `DebugEngineDriver` | CLI/扩展宿主的 `SmallBasicDebugSession`（DAP）与页面内的 `BrowserDebugSession`（Web 调试协议）——断点/条件断点/单步只实现一次 |
| `webview-panel.ts` 的 `BlazorWebviewHost` | 普通运行 Webview 与调试 Webview（面板、CSP、资源桥、ready 只写一份） |
| `inline-factory.ts` 的 `createWebInlineAdapter` | 桌面入口 `src/extension.ts` 与 Web 入口 `src/web/extension.ts`，且对两个后端是同一段代码 |
| `inline-factory.ts` 的 `resolveDebugDocument` / `documentBaseName` | 两个入口与 Adapter 工厂 |
| `webview-debug-adapter.ts` 的 `WebviewDebugSession` | JavaScript 与 Blazor 两个 web 后端共用同一份 DAP 适配器 |
| `debug-protocol.ts` 的编解码/校验 | Broker（编码）、Adapter（解码）、单元测试与 C# 对端契约 |
| `tests/support/dap-client.ts` | JavaScript DAP 回归与 Web DAP 单测（同一 DAP 线上驱动） |
| `run-routing.ts` 的单一路由表 | 两个入口的 `resolveDebugConfigurationWithSubstitutedVariables` |

#### 会话与状态机（实现约定）

- 会话状态：`creating → configuring → running/paused/waitingInput → terminated/disposed`；任一侧结束后进入 `terminated`，Broker 在 `terminated`/Webview 关闭后拒绝或忽略后续命令，不会把新命令投给已结束的会话（页面侧 `BrowserDebugSession`/`BrowserEngineSession` 也各自丢弃已结束会话的命令）。
- 会话隔离在两处生效：`WebRunHost.DispatchDebugCommand`（Blazor）与 `BrowserDebugSession.dispatch`（JavaScript）都丢弃协议版本不符、`sessionId` 不符或字段非法的消息。
- `setBreakpoints` 由运行时吸附：只有运行时知道可执行行，响应 `breakpointsValidated` 携带被接受的实际行（0-based）；DAP 边界转换为 1-based。条件断点经 `conditions` 透传，JavaScript 运行时用 `DebugEngineDriver` 编译求值，Blazor 忽略该字段。
- Stop/终止走命令通道（`stop`），会唤醒阻塞在读取命令或输入等待上的会话；`stop` 早于 `start` 到达时也会补发 `terminated`（JavaScript 侧由驱动的 `finish()` 保证只报一次）。

#### VS Code `launch.json` 的运行模式

桌面扩展支持与 `backend` 正交的 `mode` 参数：`"cli"`（默认）使用原有本机命令行/调试宿主，`"web"` 使用浏览器兼容的运行/调试链路。Web 模式支持 `javascript` 与 `blazor` 的 F5/Ctrl+F5，不支持 `csharp`；VS Code for the Web 会忽略配置中的 `cli` 并强制使用 `web`。桌面 VS Code 显式配置 `mode: "web"` 时也必须使用共享 Inline Adapter，不得因为本机可执行文件存在而回退到 CLI。

```jsonc
{
  "type": "smallbasic",
  "request": "launch",
  "name": "SmallBasic: Web",
  "program": "${file}",
  "backend": "javascript", // 或 "blazor"
  "mode": "web",
  "stopOnEntry": true
}
```

#### 本地安装与调试

| 方式 | 命令 / 配置 | 说明 |
|---|---|---|
| VS Code 桌面 + Web 扩展宿主（推荐） | `.vscode/launch.json` 里的 `SmallBasic Web Extension (VS Code Web host)`（`pwa-extensionHost` + `debugWebWorkerHost` + `--extensionDevelopmentKind=web`） | 最接近 vscode.dev 的本地回路：扩展跑在 Web Worker 里，Webview 的 CSP/资源域限制与线上一致；`npm run build` 默认带 sourcemap，断点直接落在 `src/**/*.ts`。**必须用 F5（启动调试）**：`debugWebWorkerHost` 让 Worker 宿主停在第一行等调试器，用 Ctrl+F5 / 运行（不调试）启动时没人去继续它，10 秒后会提示「扩展主机在 10 秒内没有启动…需要调试器继续」；只想跑起来请用同名的 `…, no worker debugging` 配置 |
| Playwright 页面级用例（推荐，可断点） | `cd visual_studio_code_plugin; npm run test:web`（`-- --headed --debug` 逐步调试；`SB_WEB_BROWSER=msedge` 复用系统浏览器） | `tests/webview/webview-document.spec.ts` 用真实浏览器加载 **真实 `buildWebviewHtml()` 生成的文档** 与暂存的 Blazor 载荷，且页面与载荷刻意分处两个源；测试服务器只允许 JS/CSS 跨源，明确禁止 boot JSON、ICU、WASM 与程序集 CORS，从而覆盖真实 Marketplace 的宿主资源桥、SVG 渲染、输出镜像与 Stop；截图落在 `tests/webview/artifacts/` |
| Playwright 工作台级用例（默认跳过） | `SB_WEB_WORKBENCH=1 npm run test:web -- --grep workbench` | 用本机 `code serve-web` 起真实 Web 工作台并运行图形程序。**需要干净的工作台环境**：工作区信任（受限模式会让扩展不激活）且不能有抢焦点的聊天/Agent 扩展——本机 VS Code 1.139 的 Web 工作台同时满足这两点时才能自动化，因此默认不参与 `npm run test:web` |
| 真实 vscode.dev | `mkcert` 生成证书 → `npx serve --cors --ssl-cert …` → 浏览器打开 vscode.dev → `Developer: Install Extension From Location…` 指向本地打包目录 | 最终验收用；需要 HTTPS 服务扩展目录 |

各方式都需要先把载荷放进扩展目录：

```powershell
.\runhost\Build-RunHost.ps1                    # 产出 runhost/blazor（含 wwwroot）
cd visual_studio_code_plugin
npm install; npm run build                     # dist/web/extension.js
npm run stage:blazor -w smallbasic-tools-vsc   # 只暂存 runhost/blazor（Web 端所需的最小载荷）
```

`npm run stage:blazor` 是 `stage-runhost.mjs --blazor-only`：Web 扩展只需要 `runhost/blazor`（`wwwroot/_framework` 是 WASM 运行时本体），不必构建 net48 / net8.0-windows 宿主。

#### Web 模式调试验收结果（已实施）

| 层级 | 覆盖场景 | 结果 |
|---|---|---|
| 协议/状态机单测 | 协议版本与非法消息、`sessionId` 隔离、`requestId` 应答、配置完成前设置断点、条件断点编码、命令在 ready 前排队、Stop 唤醒、Webview 关闭与超时 | `tests/debug-protocol.spec.ts`(13) + `tests/debug-broker.spec.ts`(9) 全绿 |
| Web DAP 单测（两个后端） | stopOnEntry、断点吸附与不可校验行、条件断点透传与能力声明、stackTrace/scopes/variables、next/stepOut、Debug Console 输入、disconnect 终止 | `tests/webview-debug-adapter.spec.ts`(7) 全绿（真实 DAP 线上驱动 + 模拟运行时） |
| 页面内 JavaScript 调试（单测） | ready、编译错误、断点吸附、断点/单步/终止、输出镜像、输入桥接、等待输入时终止、会话与版本隔离 | `tests/browser-debug-session.spec.ts`(8) 全绿（直接驱动协议，无需浏览器） |
| JavaScript DAP 回归 | 原有 11 个场景（断点、条件断点、吸附、输入、stopOnEntry、配置先于 launch、图形拒绝） | `tests/debug-session.spec.ts`(11) 全绿，驱动抽取后行为零变化 |
| 路由单测 | `run-in-webview`/`inline-debug`/`reject` 三态与全部后端组合 | `tests/web-routing.spec.ts`(7) 全绿 |
| Webview 页面级 E2E（两个后端） | Blazor：`debug-launch → ready → setBreakpoints（含越界行） → start → stopped → control(next) → output → terminated` 与「迟到命令不复活会话」；JavaScript：同一序列并断言 `#console` 可见且输出同时进入页面与扩展镜像 | `tests/webview/webview-document.spec.ts` 两个新增用例通过（真实 Edge/Chromium 加载真实文档 + 暂存载荷 + 真实的 `dist/web-runhost.js`） |
| 非目标回归 | `runhost/web` 仍只有 Run/Stop；页面级图形运行、JS 文本运行、Stop 三个既有用例不变 | Playwright 全套 5 passed / 1 skipped（工作台用例保持 opt-in） |

尚未在本机自动化的两项，需按 [本地安装与调试](#本地安装与调试) 手动验收：

- **桌面 Web 扩展宿主 / 真实 vscode.dev 的 F5**：需要 `DebugAdapterInlineImplementation` 挂上真实的 VS Code 调试 UI（`pwa-extensionHost` 或 HTTPS 服务扩展目录），本仓库的自动化只到页面级协议与 DAP 单测这一层；两个后端走同一条代码路径，因此手工只需各验一次。
- **Blazor 图形程序调试**：`GraphicsWindow`/`Shapes`/`Turtle` 在 Webview 中运行并调试的链路与文本程序共用同一 `BrowserEngineSession`，逻辑上等价；页面级 E2E 目前用文本程序驱动协议，图形渲染本身由既有「图形程序运行」用例覆盖。

### 当前验证基线

以下结果记录本次调试改造前已在 Chromium 中实测的运行能力（本地 `serve.mjs` 与 `SmallBasic.Blazor.RunHost` 两种服务方式）：

| 场景 | 结果 |
|---|---|
| 首屏：程序列表 | 列出 `sample/` 下 5 个示例并默认选中 `sample/hello/hello.sb`，状态显示 `Loaded sample/hello/hello.sb`，后端为 JavaScript |
| 程序列表：`Run`（hello.sb） | 输出 `Hello, World! / 1 / 3 / Hello`，状态 `Completed` |
| 程序列表：选择 `tetris.sb` | 后端自动切到 Blazor；运行后出现 231 个 SVG 元素（棋盘/方块/文本），Stop 后状态 `Stopped` |
| 程序列表：选择 `tutorial/level1.sb` | Blazor 渲染背景图 + 海龟轨迹，状态 `Completed` |
| 本地文件：`选择 .sb 文件…` | 列表新增"本地文件：xxx.sb"并运行成功（JS 与 Blazor 后端输出一致） |
| JS 后端：`WriteLine` / `Read` / `ReadNumber` | 页面输出与浏览器控制台逐行一致；输入回显正确 |
| JS 后端：图形程序 | 诊断区提示切换 Blazor 后端，退出码 3 |
| JS 后端：Stop（等待输入时） | 状态变 `Stopped`，输入行收起，Run 恢复可用 |
| JS 后端：`Program.Delay` 循环 | `1 2 3 99` 全部输出，控制台无噪声 |
| Blazor 后端：文本 + 图形混合、连续运行两次 | 每次运行都会清空上一轮文本与场景，页面只有一个 Runner |
| Blazor 后端：编译错误 | 页面显示错误卡片与 `Exited with code 2`，Run 恢复可用 |
| 启动脚本 | `run.ps1 -NoOpen -Port 8455`、`run.bat --no-open --port 8457` 均在指定端口返回 `index.html` 与 `samples/index.json`（`run.ps1` 的 comment-based help 生效） |
| CLI 模式：`dotnet ... run --file sample/tutorial/level1.sb` | 会话页面只显示图形（工具栏隐藏）；程序结束后宿主退出 |
| Webview 文档（跨域载荷，资源域只回 `Access-Control-Allow-Origin: *`，同页跑一次同源对照） | `ready` → `notify:ready` → `output` → `notify:terminated` 全部到达，`#app` 渲染出 1 个 SVG / 3 个图形元素，文本输出镜像到扩展侧，**0 条 CSP 或控制台错误**（Chromium） |
| Webview 文档 + 页面胶水的单元测试 | `tests/webview-html.spec.ts` 断言 CSP（wasm / connect / style-inline / 禁止 inline script）、绝对 URL、无 `<base>`、payload 尾斜杠容错 |
| Playwright 页面级用例（`npm run test:web`） | 图形程序跑到 `terminated`、`#app` 有 SVG 与矩形/直线、`output` 收到 `12345`、零控制台错误；Stop 后输出停止增长 |
| Playwright 工作台级用例（`SB_WEB_WORKBENCH=1`） | 默认 skip。本机 VS Code 1.139 的 Web 工作台处于受限模式且装有抢焦点的聊天扩展，命令面板/安装位置流程无法稳定自动化；已保留用例并记录前置条件 |
| Web 运行/调试分流（改造前） | `tests/web-routing.spec.ts` 7/7：Ctrl+F5 的 Blazor 请求走 Webview 运行，F5 的 Blazor 请求与图形调试请求给出明确提示，`javascript` 文本程序保持原路径，`csharp` 与未知后端不被误判 |

### Web 模式调试实施验证基线（2026-09-30）

在本机（Windows + .NET SDK 10 构建 net8.0 载荷、Node 26、Edge 复用的 Chromium）实测：

| 场景 | 命令 | 结果 |
|---|---|---|
| 单元/回归测试全套 | `cd visual_studio_code_plugin; npx vitest run` | **552 passed / 17 files**（含 `debug-protocol`(13)、`debug-broker`(9)、`webview-debug-adapter`(7)、`browser-debug-session`(8)，以及驱动抽取后原样通过的 `debug-session`(11) 回归） |
| 类型检查 | `npm run typecheck` | 无错误 |
| 扩展与载荷构建 | `npm run build -w smallbasic-tools-vsc`、`runhost\Build-RunHost.ps1 -Configuration Release -DotNetPlatforms net8.0` | `dist/web/extension.js`、`dist/web-runhost.js`（含 `debugStart/debugCommand/debugStop`）与 `runhost/blazor`（含 `wwwroot/vscode-webview.js`）生成成功 |
| C# 编译 | `dotnet build src/SmallBasic.Blazor.Client`、`dotnet build src/SmallBasic.Blazor.RunHost` | 0 错误（共享 `Protocol.cs` 与 `BrowserEngineSession` 改动对 CLI Blazor 宿主无编译影响） |
| 页面级 E2E | `SB_WEB_BROWSER=msedge npx playwright test` | **5 passed / 1 skipped**：图形运行、JS 文本运行、运行中 Stop 三个既有用例 + 「Blazor Web 调试协议」+「JavaScript Web 调试协议」 |
| Blazor 页面级调试覆盖 | `npx playwright test --grep "Blazor debug session"` | 越界断点返回空列表 → 有效断点吸附为 `[1]` → `stopped(breakpoint)` 快照含局部变量 `i` → `next` 步进 → 第二步写出 `1` 并镜像到扩展 → `stop` 终止 → 迟到命令不复活会话；**0 条控制台/CSP 错误** |
| JavaScript 页面级调试覆盖 | `npx playwright test --grep "JavaScript debug session"` | 同一协议序列，且断言 `#console` 在页面内可见、输出同时进入页面与扩展镜像；**0 条控制台/CSP 错误** |

未自动化的部分（与上节一致）：桌面 Web 扩展宿主 / 真实 vscode.dev 的 F5 原生调试 UI，以及图形程序的调试链路；两者复用同一套协议与 Broker，只需在对应环境按下 F5 人工确认。
