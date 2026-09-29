# Web RunHost（浏览器内静态站点）

> **2026-09-29 新增**：本文描述 `runhost/web` 静态站点 —— 一个不需要任何服务端进程、完全在本机浏览器内执行 `.sb` 程序的 RunHost，支持 JavaScript 与 Blazor WASM 两个后端。

## 目标

| 需求 | 落地方式 |
|---|---|
| 本地执行，不连接服务器 | 纯静态站点：程序源码、编译器、解释器、图形渲染全部在浏览器内；页面不发起任何网络请求（只有加载自身资源的同源请求） |
| JS / Blazor 两个后端 | 后端下拉框切换：`smallbasic-js.js`（TS 编译器 + 解释器）或按需加载的 Blazor WebAssembly 运行时 |
| 输入输出到页面与网页控制台 | 页面内有输出面板与输入行；所有文本输出同时写入浏览器控制台（`console.log`） |
| Blazor 后端支持 graphics | 复用既有 Blazor WASM 客户端：`GraphicsWindow`/`Shapes`/`Turtle` 绘制到 SVG 场景 |
| 复用并抽象 Blazor RunHost 界面 | 抽象出宿主通道接口，Blazor 组件同时服务于 CLI 会话（WebSocket）与 Web 站点（JS 互操作），页面外壳与 CLI 页面共用同一个 `index.html` |

## 分发构成

`runhost/web` 是 `runhost/Build-RunHost.ps1` 组装出来的目录，全部为可静态托管的文件：

```
runhost/web/
├── index.html                  # 外壳页面（也是 CLI 宿主的页面）
├── app.css                     # 外壳 + Runner 组件样式
├── shell.js                    # 外壳逻辑：程序列表、后端切换、控制台/输入、JS 互操作钩子
├── serve.mjs                   # 零依赖静态服务器（含浏览器自动打开，可选用任意静态服务器替代）
├── run.bat                     # Windows 双击入口：检查 Node 后启动 serve.mjs
├── run.ps1                     # PowerShell 入口（Windows / Linux / macOS 的 pwsh 均可）
├── samples/                    # 由仓库 test/ 复制的示例程序 + index.json 清单
├── smallbasic-js.js            # JavaScript 后端（tsup 打包的 IIFE，定义 window.SmallBasicWeb）
└── _framework/                 # Blazor WebAssembly 客户端发布产物（含 .br 预压缩文件）
```

来源：

| 文件 | 来源 |
|---|---|
| `index.html`、`app.css`、`shell.js`、`serve.mjs`、`run.bat`、`run.ps1` | `visual_studio_plugin/src/SmallBasic.Blazor.Client/wwwroot`（手写源码，仓库跟踪） |
| `_framework/**` | `dotnet publish` Blazor 宿主的 `wwwroot`（把 `SmallBasic.Blazor.Client` 的静态资源合并进来） |
| `smallbasic-js.js` | `visual_studio_code_plugin/packages/smallbasic-vscode/dist/web-runhost.js`（`npm run build` 由 `src/runhost/web.ts` 生成） |
| `samples/**` | `runhost/Build-RunHost.ps1` 复制仓库 `test/**/*.sb` 并生成 `samples/index.json` |

> `wwwroot` 在 `.gitignore` 里被整体忽略（生成站点约定），因此 `.gitignore` 对 `SmallBasic.Blazor.Client/wwwroot` 做了白名单，否则外壳页面不会进入仓库 —— 这也正是此前 `runhost/blazor` 缺失 `index.html` 的原因。

## 架构

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

页面外壳负责“谁来跑、跑什么、状态如何”，Blazor 侧只负责“怎么跑”。二者之间只有三个稳定的接口：

| 方向 | 接口 | 说明 |
|---|---|---|
| 外壳 → Blazor | `SmallBasicWebHost.isWebRunHost()` | 模式探测：返回 `false` 时 Runner 走 CLI 会话（HTTP + WebSocket）路径 |
| 外壳 → Blazor | `DotNet.invokeMethodAsync(..., 'SetSession', json)` / `'Stop'` | 推送一次运行请求 / 请求终止当前运行 |
| Blazor → 外壳 | `SmallBasicWebHost.write(text)` / `.notify(json)` | 文本镜像到浏览器控制台；`ready`/`terminated`/`stopped` 更新状态与按钮 |

## Blazor 侧的复用与重构

原有实现把“引擎 ↔ 宿主”写死成 WebSocket（`BrowserBridge`）。本次把这条通道抽象成接口，让同一条运行链路服务于两种宿主：

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

## JavaScript 后端

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

## 页面行为

- 页面没有编辑器：工具栏只有程序列表、`选择 .sb 文件…`、后端下拉框、Run/Stop 与状态；输出面板占满其余空间。
- 程序列表来自 `samples/index.json`（构建时由仓库 `test/**/*.sb` 生成），默认选中 `test/hello/hello.sb`；清单里 `graphics: true` 的程序（构建时按 `GraphicsWindow`/`Shapes`/`Turtle` 的出现判断）会自动把后端切到 Blazor。
- 用户选择的本地文件（或拖入页面的文件）会成为列表里的“本地文件：xxx.sb”项，可直接运行。
- `samples/index.json` 不可用时（例如 CLI 宿主不分发示例）回退到内置的 Hello World 程序，页面仍然可用。
- 探测 `smallbasic-js.js` 是否存在（CLI 宿主不分发它）：缺失时移除 JS 选项并给出提示，仅保留 Blazor 后端。
- 图形程序误选 JS 后端：诊断区给出“请切换到 Blazor WASM”的提示并以退出码 3 结束。
- Blazor 后端第一次运行才注入 `_framework/blazor.webassembly.js`（`autostart="false"` + 显式 `await Blazor.start()`），因此不跑图形程序时不会下载 WASM；此后同一页面可反复运行（每次 `SetSession` 会终止并重建会话）。
- Stop：先请求终止并等待运行报告，再释放会话；外壳与 Blazor 工具条都会显示 `Stopped`。若 30 秒内没有任何生命周期消息（WASM 启动失败），状态栏会给出提示而不是一直卡在“Run 中”。
- 页面底部提供 Blazor 标准 `#blazor-error-ui`，组件异常时可见。
- 直接以 `file://` 打开时页面不尝试启动 Blazor，而是提示改用 `run.bat` / `run.ps1` / `serve.mjs`。

## 构建与运行

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
  "default": "test/hello/hello.sb",
  "items": [
    { "name": "test/hello/hello.sb", "path": "samples/hello/hello.sb", "graphics": false },
    { "name": "test/tetris/tetris.sb", "path": "samples/tetris/tetris.sb", "graphics": true }
  ]
}
```

注意：

- 浏览器不允许从 `file://` 加载 WebAssembly，因此必须经 HTTP 访问；`serve.mjs` 会按 `Accept-Encoding` 协商下发 `_framework` 的 `.br` 预压缩文件，任何静态服务器都可以替代它（此时自行用浏览器打开 `index.html`）。
- `run.bat` 面向 Windows 双击，`run.ps1` 面向 PowerShell 7（含 macOS/Linux，`#!/usr/bin/env pwsh` 便于 `chmod +x` 后直接执行）；两者都只是 `serve.mjs` 的入口，Node 缺失时会给出各平台的安装提示。
- `runhost/web` 的组装是“先删除再复制”。若此时仍有进程把该目录当作工作目录（例如正在运行的 `node serve.mjs`），Windows 会让复制落入已删除的旧目录，导致目录为空；`Build-RunHost.ps1` 会在组装后校验关键文件（含 `run.bat`/`run.ps1`/`samples\index.json`）并给出明确错误，重建前请先停止服务进程。

## CLI 宿主复用

`SmallBasic.Blazor.RunHost` 打开的 `?session=<id>` 页面与 Web 站点是同一个 `index.html`：`shell.js` 检测到 `session` 查询参数后进入 CLI 模式（隐藏工具栏与输出标题、直接启动 Blazor 运行时），`SmallBasicWebHost.isWebRunHost()` 返回 `false`，Runner 于是走原有的 HTTP 会话 API + WebSocket 桥。

## vscode.dev（VS Code for the Web）集成

### 结论与做法

VS Code for the Web 的扩展宿主是浏览器 Web Worker，不能启动本机进程，但**可以开 Webview**。因此把「独立 Web RunHost」的这一套搬到 Webview 里，就得到浏览器内的 Blazor 图形后端：

```text
Web Worker（web extension host）
  smallbasic.runBlazor → 取 activeTextEditor 文本 → postMessage({type:"run",name,source})
        │  postMessage                              ▲ { type:"ready" | "output" | "notify" | "failed" }
        ▼                                           │
WebviewPanel（扩展生成的 HTML，载荷来自扩展目录 runhost/blazor/wwwroot）
  Blazor.start({ loadBootResource }) → Runner 组件 → GraphicsWindow(SVG) / TextWindow 控制台
```

- **复用现有载荷**：`runhost/blazor/wwwroot`（含 `_framework`）本来就在 VSIX 里（`files: ["runhost/**"]`，`stage-runhost.mjs` 暂存），Webview 直接经 `webview.asWebviewUri()` 指向它；`vscode-webview.js` 也放在同一个 wwwroot 里随载荷分发，不额外增加打包步骤。
- **复用现有契约**：`SetSession` / `Stop`（`[JSInvokable]`）与 `SmallBasicWebHost.write/notify`（`isWebRunHost()` 返回 true 即"由外壳驱动"模式），与独立站点的 `shell.js` 完全一致，只是外壳从 `shell.js` 换成了扩展。
- Webview 侧代码：`src/web/webview-html.ts`（文档 + CSP 生成，纯函数、可单测）、`src/web/blazor-webview.ts`（panel 生命周期、载荷定位、消息协议、OutputChannel 镜像）；页面侧胶水 `SmallBasic.Blazor.Client/wwwroot/vscode-webview.js`。

### 实测踩过的三个坑（都已修复）

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动即抛 `The URI 'https://…/index.html' is not contained by the base URI 'https://…cdn/…/wwwroot/'` | Webview 文档在 `vscode-webview://<id>`，把 `<base href>` 指向扩展资源域后 `document.baseURI` 与当前地址不同源；Router（以及 `NavigationManager.ToBaseRelativePath`）在启动时校验"当前地址必须被 base 包含" | Webview 文档**不放 `<base>`**：三个入口（`app.css`、`_framework/blazor.webassembly.js`、`vscode-webview.js`）都用绝对 URL；`document.baseURI` 于是等于文档地址，校验通过，Router 仍能匹配 `/` |
| 取 `blazor.boot.json` 报 `Access-Control-Allow-Origin` 为 `*` 时不允许带凭据 | `dotnet.js` 对 boot 配置文件的 fetch 硬编码 `credentials:"include"`，浏览器要求资源域回显 webview 源并允许凭据 | 胶水用 `Blazor.start({ loadBootResource })` 接管该资源：`type === "manifest"` 时返回自己 `credentials:"omit"` 的 fetch（其余资源返回 `defaultUri`，走默认的免凭据路径）→ 只要资源域支持普通 CORS 即可 |
| 修改后仍不启动、无任何报错 | `loadBootResource` 的 `"dotnetjs"` 类型同时覆盖 `dotnet.js`、`dotnet.native.js`、`dotnet.runtime.js`，若统一重定向会把三个模块指向同一文件 | 只在 `type === "dotnetjs" && name === "dotnet.js"` 时重定向到 `<payload>/_framework/dotnet.js`，其余保持默认（相对 `dotnet.js` 模块 URL 解析） |

CSP 要求（`webview-html.ts` 中集中定义）：

| 指令 | 为什么需要 |
|---|---|
| `default-src 'none'` | VS Code 推荐的基线，其余能力显式开放 |
| `script-src ${cspSource} 'wasm-unsafe-eval' 'unsafe-eval'` | 加载脚本 + 实例化 WASM；`'unsafe-eval'` 是 Safari 等不支持 `wasm-unsafe-eval` 的兜底 |
| `connect-src ${cspSource}` | `dotnet.js` 用 `fetch` 取 boot 配置、`*.wasm`、`*.dll`、`icu*.dat` |
| `style-src ${cspSource} 'unsafe-inline'` | Runner 的 SVG 用 `style` 属性做显隐/变换，Blazor 也会输出动态内联样式；**`script-src` 仍不含 `'unsafe-inline'`** |
| `img-src ${cspSource} data: https:` | `GraphicsWindow.DrawImage` 可加载网络图片 |
| `worker-src ${cspSource} blob:` | 为将来可能的多线程运行时留出空间 |

### 运行与调试的路由（`src/web/run-routing.ts`）

Web 端只有 JavaScript 后端能逐行调试，但 Blazor 后端可以在 Webview 里**运行**。`smallbasic.blazor` 的调试请求因此按「跑」还是「调」分流，判定表如下（`Ctrl+F5` = 运行但不调试，VS Code 会在配置上置 `noDebug: true`）：

| 请求的后端 | `noDebug`（Ctrl+F5） | 程序使用 GraphicsWindow/Shapes/Turtle | 结果 |
|---|---|---|---|
| `javascript` / 未指定 | 任意 | 否 | JavaScript 调试适配器（F5 逐行调试，Ctrl+F5 直接运行） |
| `blazor` | 是 | 任意 | 在 Webview 内运行，不创建调试会话 |
| `blazor` | 否（F5） | 否 | 拒绝并提示改用 Ctrl+F5 或 `SmallBasic: Run with Blazor Backend` |
| 未指定 | 是 | 是 | 自动视为 Blazor：在 Webview 内运行 |
| 未指定 / `javascript` | 否（F5） | 是 | 拒绝并提示图形程序无法逐行调试 |
| `javascript` | 是 | 是 | 改为在 Webview 内运行，并在状态栏说明替换原因 |
| `csharp` | 任意 | 任意 | 拒绝（Web 无法启动本机宿主） |

要点：**不能只看 `backend` 就拒绝**。`noDebug` 为真的请求语义是「运行」，而运行在 Webview 里是支持的——早期实现无条件拒绝 `backend: "blazor"`，导致 Ctrl+F5 也被拦下并提示「Blazor 不支持 Web」。判定逻辑集中在无 `vscode` 依赖的纯函数里，`tests/web-routing.spec.ts` 覆盖上表 7 组用例。

真正的 Blazor **逐行调试**仍未支持。要把调试搬到 Web，需要新增两块：C# 侧一个 `postMessage` 版 `IRunHostTransport`（替换 `BrowserBridge` 的 WebSocket），以及扩展宿主里一个把 DAP ↔ `HostMessage`/`BrowserMessage` 互相翻译的代理适配器（把 `SmallBasic.Blazor.RunHost/Hosting/BlazorHostSession.cs` 的语义移植到 TS，可复用 `DebugAdapterInlineImplementation`，与 Web 端 JS 调试同一条路）。

### 本地安装与调试

| 方式 | 命令 / 配置 | 说明 |
|---|---|---|
| VS Code 桌面 + Web 扩展宿主（推荐） | `.vscode/launch.json` 里的 `SmallBasic Web Extension (VS Code Web host)`（`pwa-extensionHost` + `debugWebWorkerHost` + `--extensionDevelopmentKind=web`） | 最接近 vscode.dev 的本地回路：扩展跑在 Web Worker 里，Webview 的 CSP/资源域限制与线上一致；`npm run build` 默认带 sourcemap，断点直接落在 `src/**/*.ts`。**必须用 F5（启动调试）**：`debugWebWorkerHost` 让 Worker 宿主停在第一行等调试器，用 Ctrl+F5 / 运行（不调试）启动时没人去继续它，10 秒后会提示「扩展主机在 10 秒内没有启动…需要调试器继续」；只想跑起来请用同名的 `…, no worker debugging` 配置 |
| Playwright 页面级用例（推荐，可断点） | `cd visual_studio_code_plugin; npm run test:web`（`-- --headed --debug` 逐步调试；`SB_WEB_BROWSER=msedge` 复用系统浏览器） | `tests/webview/webview-document.spec.ts` 用真实浏览器加载 **真实 `buildWebviewHtml()` 生成的文档** 与暂存的 Blazor 载荷，且页面与载荷刻意分处两个源，覆盖 CSP、`connect-src`、`loadBootResource` 引导、SVG 渲染、输出镜像与 Stop；截图落在 `tests/webview/artifacts/` |
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

## 验证

已在 Chromium 中实测以下路径（本地 `serve.mjs` 与 `SmallBasic.Blazor.RunHost` 两种服务方式）：

| 场景 | 结果 |
|---|---|
| 首屏：程序列表 | 列出 `test/` 下 5 个示例并默认选中 `test/hello/hello.sb`，状态显示 `Loaded test/hello/hello.sb`，后端为 JavaScript |
| 程序列表：`Run`（hello.sb） | 输出 `Hello, World! / 1 / 3 / Hello`，状态 `Completed` |
| 程序列表：选择 `tetris.sb` | 后端自动切到 Blazor；运行后出现 231 个 SVG 元素（棋盘/方块/文本），Stop 后状态 `Stopped` |
| 程序列表：选择 `tutorial/level1.sb` | Blazor 渲染背景图 + 海龟轨迹，状态 `Completed` |
| 本地文件：`选择 .sb 文件…` | 列表新增“本地文件：xxx.sb”并运行成功（JS 与 Blazor 后端输出一致） |
| JS 后端：`WriteLine` / `Read` / `ReadNumber` | 页面输出与浏览器控制台逐行一致；输入回显正确 |
| JS 后端：图形程序 | 诊断区提示切换 Blazor 后端，退出码 3 |
| JS 后端：Stop（等待输入时） | 状态变 `Stopped`，输入行收起，Run 恢复可用 |
| JS 后端：`Program.Delay` 循环 | `1 2 3 99` 全部输出，控制台无噪声 |
| Blazor 后端：文本 + 图形混合、连续运行两次 | 每次运行都会清空上一轮文本与场景，页面只有一个 Runner |
| Blazor 后端：编译错误 | 页面显示错误卡片与 `Exited with code 2`，Run 恢复可用 |
| 启动脚本 | `run.ps1 -NoOpen -Port 8455`、`run.bat --no-open --port 8457` 均在指定端口返回 `index.html` 与 `samples/index.json`（`run.ps1` 的 comment-based help 生效） |
| CLI 模式：`dotnet ... run --file test/tutorial/level1.sb` | 会话页面只显示图形（工具栏隐藏）；程序结束后宿主退出 |
| Webview 文档（跨域载荷，资源域只回 `Access-Control-Allow-Origin: *`，同页跑一次同源对照） | `ready` → `notify:ready` → `output` → `notify:terminated` 全部到达，`#app` 渲染出 1 个 SVG / 3 个图形元素，文本输出镜像到扩展侧，**0 条 CSP 或控制台错误**（Chromium） |
| Webview 文档 + 页面胶水的单元测试 | `tests/webview-html.spec.ts` 断言 CSP（wasm / connect / style-inline / 禁止 inline script）、绝对 URL、无 `<base>`、payload 尾斜杠容错 |
| Playwright 页面级用例（`npm run test:web`） | 2 passed / 5.4s：图形程序跑到 `terminated`、`#app` 有 SVG 与矩形/直线、`output` 收到 `12345`、零控制台错误；Stop 后输出停止增长 |
| Playwright 工作台级用例（`SB_WEB_WORKBENCH=1`） | 默认 skip。本机 VS Code 1.139 的 Web 工作台处于受限模式且装有抢焦点的聊天扩展，命令面板/安装位置流程无法稳定自动化；已保留用例并记录前置条件 |
| Web 运行/调试分流 | `tests/web-routing.spec.ts` 7/7：Ctrl+F5 的 Blazor 请求走 Webview 运行，F5 的 Blazor 请求与图形调试请求给出明确提示，`javascript` 文本程序保持原路径，`csharp` 与未知后端不被误判 |
