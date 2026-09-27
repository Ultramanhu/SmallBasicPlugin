# Blazor WebAssembly 后端与 RunHost

> **2026-09-28 校准**：本文与当前实现一致。补充说明：
> - `run` 支持可选 `--no-open`（不自动打开浏览器，仅打印会话 URL）。
> - VS Code 桌面与 Visual Studio 都随扩展分发 `runhost/blazor` 载荷，并以 `dotnet ...SmallBasic.Blazor.RunHost.dll run|debug` 调用；VS Code Web 无法启动本机进程，因此仍只有 JavaScript 后端。
> - 项目位于 `visual_studio_plugin/src/SmallBasic.Blazor.{Shared,Client,RunHost}`，由 Vsix 项目发布到 `runhost/blazor`。

## 目标

Blazor 后端沿用 Small Basic 官方 Web 编辑器的关键边界：扫描、语法分析、绑定、指令发射、解释执行和运行时库都在浏览器中的 .NET WebAssembly 进程完成；`GraphicsWindow` 不创建操作系统窗口，而是把绘图命令写入场景模型，再由 Blazor 组件生成 SVG。

为了适配 VS/VS Code，本仓库在浏览器外增加 `SmallBasic.Blazor.RunHost`。它既是命令行宿主，也是调试适配器和本机静态站点服务器。

## 按需浏览器行为

RunHost 先用 `SmallBasicCompilation.Analysis.UsesGraphicsWindow` 分析程序：

```text
                     ┌─ 否 ─> RunHost 内 SmallBasicEngine ─> 当前终端
.sb -> 编译与分析 ───┤
                     └─ 是 ─> localhost 会话 ─> Blazor WASM ─> SVG GraphicsWindow
```

- 只使用 `TextWindow` 的程序在当前终端执行，不启动浏览器。
- 使用 `GraphicsWindow`、`Shapes` 或 `Turtle` 的程序才启动随机 localhost 端口并打开浏览器。
- `run --file program.sb` 和 DAP `debug` 模式使用同一条判定规则。

## 项目组成

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

## GraphicsWindow 实现

浏览器运行时实现编译器定义的 `IGraphicsWindowLibrary`、`IShapesLibrary` 与 `ITurtleLibrary`：

- `DrawLine`、矩形、椭圆、三角形、文本和像素被追加为 `GraphicElement`。
- `DrawImage`/`DrawResizedImage` 生成 SVG `<image>`，可直接使用 URL。
- `Shapes` 维护命名对象字典，移动、旋转、缩放、透明度和显隐修改同一场景对象。
- `Turtle` 维护坐标、角度、速度与画笔状态；移动生成线段并异步等待对应动画时长。
- 键盘和鼠标事件从 SVG DOM 回传运行时库，再由 `SmallBasicEngine` 的事件队列调用 Small Basic 子过程。

场景按固定层级渲染：普通绘图、Shapes、Turtle 轨迹、Turtle。本项目因此能正确运行教程的 `level1.sb`：背景图片位于底层，海龟和轨迹始终位于其上。

## 调试桥

文本程序直接由 RunHost 内的解释器调试。图形程序的解释器在 WASM 中，RunHost 在两种协议之间桥接：

```text
VS / VS Code <-- DAP stdin/stdout --> Blazor RunHost <-- WebSocket --> WASM engine
```

RunHost 负责 DAP 生命周期、断点吸附和 IDE 消息；WASM 负责真正的继续、单步、输入阻塞和程序执行，并在暂停时返回行号、调用栈及递归变量快照。这样运行与调试不会使用不同的图形实现。

## 安全与生命周期

- Kestrel 只监听 `127.0.0.1` 的随机端口。
- 会话使用随机 128 位标识，源码只由对应会话 API 返回。
- RunHost 在浏览器报告程序终止后退出；事件监听型程序则保持会话，直到调试器停止或浏览器关闭。
- VS Code Web 不能创建本机 RunHost 进程，因此仍只提供 JavaScript 后端；桌面 VS Code 与 Visual Studio 均提供 Blazor 运行和调试入口。
