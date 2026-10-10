# 12 CSharp 编译器模式与可执行文件支持设计

> 状态：设计提案，仅落地文档，不包含实现。
>
> 范围：只讨论 **C# 后端** 的 compiler mode / 可执行文件输出 / 编译后调试。JavaScript 与 Blazor 现有运行调试链路保持不变。

## 1. 调查结论

### 1.1 `official_repo` 中没有现成的“发射 EXE”实现

直接阅读当前仓库纳入的上游 C# 代码后，可以得到以下结论：

- `official_repo/editor/Source/SmallBasic.Compiler/SmallBasic.Compiler.csproj` 是 `netstandard2.0` **类库**，不是可执行项目。
- `official_repo/editor/Source/SmallBasic.Compiler/SmallBasicCompilation.cs` 只负责扫描、解析、绑定，以及补全/悬停等语言服务入口。
- `official_repo/editor/Source/SmallBasic.Compiler/SmallBasicEngine.cs` 会把绑定结果交给 `ModuleEmitter` 生成 `RuntimeModule` 指令，再由 `Execute()` **解释执行**。
- `official_repo/` 根下只有 `editor/`、`online/`、`homesite/` 三个子树，没有 `RunHost`、`Debug Adapter` 或 `compiler` CLI 目录。

**结论**：当前纳入仓库的官方 C# 资产里，**没有**“Small Basic → EXE/MSIL/PE” 的现成发射器，也**没有**“编译后 EXE 调试”的现成工具链。

### 1.2 当前仓库已经补齐了运行宿主与调试能力，但仍然不是 compiler mode

本仓库在上游基础上已经新增了可复用的运行/调试资产：

- `visual_studio_plugin/vendor/SmallBasicEditor/Source/SmallBasic.Compiler/SmallBasicCompilation.cs`
  - 新增 `GetExecutableLines()`
  - 新增 `CompileExpression(string)`
- `visual_studio_plugin/vendor/SmallBasicEditor/Source/SmallBasic.Compiler/SmallBasicEngine.cs`
  - 新增 `LastError`
  - 新增 `EvaluateConditionAsync(...)`
  - 新增 `EvaluateExpressionAsync(...)`
- `visual_studio_plugin/src/SmallBasic.RunHost/Program.cs`
  - 目前只支持 `run --file <program.sb>`
  - `debug`
  - `--capabilities`
- `visual_studio_plugin/src/SmallBasic.RunHost/Debug/DebugAdapter.cs`
  - `launch` 时仍然是读取源码文件后 `new SmallBasicCompilation(File.ReadAllText(...))`
  - 说明当前 F5 本质上仍是“**启动时编译 + 解释执行**”

也就是说，当前仓库已经具备：

1. **运行时宿主**（RunHost）
2. **DAP 调试宿主**
3. **三套 .NET 运行时目标**

但还**不具备**：

1. `compile` 命令
2. 编译输出目录/工件布局
3. 编译产物的运行入口
4. 编译产物的调试入口
5. VS / VS Code 中对应的编译工作流与选项

### 1.3 三运行时基础已经存在

`visual_studio_plugin/src/SmallBasic.RunHost/SmallBasic.RunHost.csproj` 已经明确多目标：

- `net48`
- `net8.0`
- `net8.0-windows`

并且 `runhost/Build-RunHost.ps1` 已经把这三套 C# 宿主作为正式分发输出：

- `runhost/net48/`
- `runhost/net8.0/`
- `runhost/net8.0-windows/`

同时，VS Code 扩展的 `packages/smallbasic-vscode/scripts/stage-runhost.mjs` 已经把 C# 宿主区分为：

- `runhost/windows/`（来自 `net8.0-windows`）
- `runhost/portable/`（来自 `net8.0`）

而 Visual Studio VSIX 当前仍只把 `net48` 打进 `runhost/csharp/`。

**结论**：三运行时基础已经存在，但两端 IDE 目前对它们的暴露方式并不统一，也没有 compiler mode 的封装。

## 2. 本文对“compiler mode”的定义

为了与当前 Small Basic 引擎的真实形态保持一致，本文把 **compiler mode** 定义为：

1. 对 `.sb` 源码做语义校验和运行时适配校验；
2. 选择一套 C# 宿主运行时（`net48` / `net8.0` / `net8.0-windows`）；
3. 生成一个**可分发的宿主包**；
4. 该宿主包启动后运行同一套 `SmallBasicEngine`；
5. 该宿主包进入 `debug` 时继续复用现有 DAP 语义。

这**不是**：

- 把 Small Basic 翻译成 C# 源码；
- 把 Small Basic 直接发射成 MSIL/PE；
- 引入 Roslyn 或新的 JIT/AOT 编译链；
- 复刻传统 IDE 那种独立于运行宿主之外的调试引擎。

因此，后续文档里的“编译生成 EXE”，更准确地说是：

> **生成“带固定程序载荷的 C# 运行宿主”**。

## 3. 可行性判断

### 3.1 是否可行

**可行。**

原因不是上游已经有现成 EXE emitter，而是当前仓库已经具备以下必要条件：

1. `.sb` → `SmallBasicCompilation` → `SmallBasicEngine` 的稳定执行链
2. C# RunHost 的运行入口
3. C# RunHost 的调试入口
4. `GetExecutableLines()` / 条件断点表达式编译 / 求值能力
5. 三运行时宿主输出

因此，compiler mode 不需要再造一套执行器，只需要补：

- **打包工具**
- **编译产物约定**
- **IDE 工作流**

### 3.2 可行性的边界

需要明确以下事实：

- `net48` 与 `net8.0-windows` 可以自然输出 **Windows EXE**，并支持图形库。
- `net8.0` 当前是**便携文本宿主**；它在逻辑上适合做“可分发运行时包”，但不应在第一阶段承诺“所有平台都生成单文件 EXE”。
- 当前 `net8.0` 目标会在编译时排除 `GraphicsWindowLibrary.cs`、`ShapesLibrary.cs`、`TurtleLibrary.cs`，因此**不能**运行图形程序。

因此，若做 compiler mode，推荐把输出能力定义为：

| 运行时 | 图形能力 | 第一阶段建议输出形态 | 本地调试可行性 |
|---|---|---|---|
| `net48` | 有 | Windows 文件夹部署，入口 `*.exe` | 可行 |
| `net8.0-windows` | 有 | Windows 文件夹部署，入口 `*.exe` | 可行 |
| `net8.0` | 无 | 便携运行时包（入口优先 `*.dll`，若存在 apphost 则可附带 `*.exe`） | 可行，但仅文本 |

换言之：

- **“三运行时都支持”是可行的**
- 但**“三运行时都统一承诺单一 EXE 体验”并不严谨**

第一阶段应把 `net8.0` 在 UI 与文档中表述为：

> **.NET 8 便携运行时包**

而不是强行宣传成“跨平台 EXE”。

从实现风险与复用旧 Small Basic 行为的一致性看，**更保守的一期建议**是：

> **compiler mode 首期仅支持 `net48`。**

理由：

1. 已验证的旧版 Small Basic v1.2 编译链就是 **.NET Framework + Reflection.Emit Save** 路线；
2. 当前通过解包与反编译确认，其老实现直接使用 `AssemblyBuilderAccess.Save` / `AssemblyBuilder.Save(...)` 生成 `*.exe`；
3. 该路径天然输出 Windows EXE，与“老 Small Basic 编译成 exe”的用户心智最一致；
4. 当前 Visual Studio VSIX 本身也是 `net48`，首期把编译器模式收敛到 `net48`，对宿主分发、调试链路和兼容性判断都最直接。

因此可以把路线拆成两层：

- **阶段 A（推荐先做）**：仅 `net48` compiler mode，输出 Windows `*.exe + SmallBasicLibrary.dll (+ lib/*.dll)`；
- **阶段 B（后续再评估）**：若未来找到可靠的 .NET 8 持久化发射/替代打包方案，再扩展 `net8.0-windows` 或 `net8.0`。

## 4. 推荐方案

### 4.1 工具拆分

推荐引入两个概念层，而不是把所有逻辑都塞进现有 `Program.cs`：

### A. `SmallBasic.RunHost`

继续承担：

- 源码直跑：`run --file <program.sb>`
- 源码直调：`debug`
- capability 探测：`--capabilities`

并扩展承担：

- 编译产物运行：无参数或 `run`
- 编译产物调试：`debug`

### B. `SmallBasic.Compiler.Tool`

新增独立 CLI，只负责**打包/编译器模式**，例如：

```powershell
SmallBasic.Compiler.Tool list-runtimes
SmallBasic.Compiler.Tool compile --file hello.sb --runtime net48 --output .\bin\hello-net48
SmallBasic.Compiler.Tool inspect --artifact .\bin\hello-net48
```

推荐保持它与 `RunHost` 分离，原因是：

1. `RunHost` 当前是热路径（F5/Ctrl+F5/DAP），应保持启动简单；
2. 编译器模式需要处理输出目录、清理、重建策略、工件探测，这类逻辑不应污染运行热路径；
3. VS / VS Code 都更适合把“编译”视为显式工具，而不是隐式副作用。

> 可选兼容方案：后续若希望 CLI 体验统一，可再让 `SmallBasic.RunHost compile ...` 成为对 `SmallBasic.Compiler.Tool` 的薄包装；第一阶段不强制。

### 4.2 编译产物约定

第一阶段推荐使用**文件夹工件**，不做 PE 资源改写或单文件封装。

原因：

- 现有三运行时宿主都是“目录式”分发；
- 这样可以直接复用 `runhost/Build-RunHost.ps1` 的输出；
- 不需要引入二进制 patch、资源注入或额外 SDK 发布步骤；
- 调试时源码 sidecar 也更容易保留。

建议输出结构：

```text
<output>/
  app/
    <entry files>          # 复制并重命名后的运行宿主家族
    program.sb             # 当前程序源码副本
    smallbasic.program.json
```

> 实现说明：`SmallBasic.Compiler.Tool` 落地时不再使用 `app/` 子目录，而是把运行宿主家族
> 摊平成“入口 + 运行库子目录”，产物根目录只保留程序本体：

```text
<output>/
  <program>.exe                 # 由 SmallBasic.RunHost.exe 改名而来
  <program>.exe.config          # 复制模板配置并注入 <probing privatePath="lib" />
  <program>.smallbasic.json     # 清单(sidecar)
  <program>.smallbasic.source   # 源码副本(sidecar)
  lib/                          # 全部运行时支撑程序集
```

> 两个约束：`probing` 必须放在 `<assemblyBinding>`(namespace `urn:schemas-microsoft-com:asm.v1`)
> 内才会被程序集加载器采纳，直接写在 `<runtime>` 下会被解析但忽略；`lib` 中的程序集全部由
> `AppDomain` 的默认探测路径解析，因此入口与 `lib` 必须一起分发。

其中 `smallbasic.program.json` 建议最少包含：

```json
{
  "schemaVersion": 1,
  "runtime": "net48",
  "programFile": "program.sb",
  "sourceHash": "<sha256>",
  "usesGraphics": true,
  "debuggable": true,
  "capabilities": ["function-v1", "gosub-v1", "error-handling-v1"]
}
```

设计约束：

- **不记录**用户机器的绝对源码路径，避免把本地路径泄漏到分发工件中；
- IDE 若要做“源码是否已改动”的判断，应在本地缓存中保存“源文件 → 编译工件”的映射，而不是把绝对路径写入产物；
- 第一阶段使用 `program.sb` sidecar，后续若确有必要，再评估“嵌入资源 + 单文件”。

### 4.3 编译产物的运行/调试契约

编译产物建议遵循与当前 RunHost 尽量相近的行为：

| 启动方式 | 行为 |
|---|---|
| 直接启动（无参数） | 运行打包进来的 `program.sb` |
| `run` | 显式运行打包进来的 `program.sb` |
| `debug` | 启动内嵌 DAP 调试器 |
| `--capabilities` | 返回 capability JSON |

这样做的价值是：

1. VS Code `DebugAdapterExecutable` 无需理解新的调试协议；
2. Visual Studio `SmallBasicDebugLauncher` 也无需引入新的调试宿主类型；
3. 编译前 F5 和编译后 F5 的断点、单步、变量、条件断点语义可以保持一致。

## 5. VS Code 扩展设计

### 5.1 新命令

建议新增三类命令：

1. `SmallBasic: Compile current file with C# backend`
2. `SmallBasic: Run compiled current file`
3. `SmallBasic: Debug compiled current file`

建议行为：

- `Compile...`：先保存当前 `.sb`，选择运行时与输出目录，再调用 `SmallBasic.Compiler.Tool`
- `Run compiled...`：必要时按策略重编译，再启动产物
- `Debug compiled...`：必要时按策略重编译，再以 DAP 启动产物

> `vscode.dev` / Web 扩展不支持本机进程，因此不提供这些命令。

### 5.2 新设置

建议在现有 `smallbasic.csharp.runHostPath` 之外，新增：

| 设置 | 默认值建议 | 说明 |
|---|---|---|
| `smallbasic.csharp.compilerPath` | `""` | 自定义 `SmallBasic.Compiler.Tool.exe/.dll`；为空时用扩展内置版本 |
| `smallbasic.csharp.compile.defaultRuntime` | Windows=`net8.0-windows`，其它=`net8.0` | 编译器模式默认运行时 |
| `smallbasic.csharp.compile.defaultOutputDirectory` | `${workspaceFolder}\\.smallbasic\\bin` | 默认输出根目录 |
| `smallbasic.csharp.compile.rebuild` | `ifChanged` | `always` / `ifChanged` / `never` |

### 5.3 `launch.json` 扩展

当前 VS Code 只支持：

- `program`
- `backend`
- `mode`
- `stopOnEntry`

建议对 `backend: "csharp"` 增加以下可选字段：

```jsonc
{
  "type": "smallbasic",
  "request": "launch",
  "name": "SmallBasic: Debug current file with compiled C# backend (.NET Framework 4.8)",
  "program": "${file}",
  "backend": "csharp",
  "mode": "cli",
  "launchKind": "compiled",
  "runtime": "net48",
  "outputDirectory": "${workspaceFolder}\\.smallbasic\\bin\\${fileBasenameNoExtension}\\net48",
  "rebuild": "ifChanged",
  "stopOnEntry": false
}
```

字段语义建议：

| 字段 | 说明 |
|---|---|
| `launchKind` | `source`（默认）或 `compiled` |
| `runtime` | `net48` / `net8.0` / `net8.0-windows`，只对 `backend: "csharp"` + `launchKind: "compiled"` 生效 |
| `outputDirectory` | 编译产物目录 |
| `rebuild` | `always` / `ifChanged` / `never` |

行为建议：

- `launchKind=source`：保持当前逻辑不变
- `launchKind=compiled`：
  1. 调用 compiler tool
  2. 定位产物入口
  3. `noDebug=true` 时直接运行
  4. 调试时把产物入口作为 DAP 适配器进程启动

### 5.4 平台约束

VS Code 桌面端应按平台控制本地运行/调试可用性：

| 平台 | `net48` | `net8.0-windows` | `net8.0` |
|---|---|---|---|
| Windows | 编译/运行/调试 | 编译/运行/调试 | 编译/运行/调试（文本） |
| Linux/macOS | 仅在明确支持“导出 Windows 工件”时允许编译；本地运行/调试禁用 | 同左 | 编译/运行/调试（文本） |

为避免首期复杂度过高，**第一阶段也可以更保守**：

- Windows：开放三运行时
- Linux/macOS：只开放 `net8.0`

如果按本文当前更推荐的收敛方案推进，则可进一步缩小为：

- **首期只在 Windows 桌面版开放 `net48` compiler mode**
- VS Code for the Web 不提供 compiler mode
- Linux/macOS 首期不提供 C# compiler mode

## 6. Visual Studio 扩展设计

### 6.1 菜单与会话状态

当前 `SmallBasicCommandService` 只维护：

- `SelectedBackend`
- `LastFocusedSmallBasicDocumentPath`

建议新增两项会话状态：

- `SelectedLaunchKind`：`source` / `compiled`
- `SelectedCSharpRuntime`：`net48` / `net8.0` / `net8.0-windows`

如果一期只支持 `net48`，则还可以进一步简化成：

- 保留 `SelectedLaunchKind`
- `SelectedCSharpRuntime` 首期固定为 `net48`，暂不暴露多运行时切换 UI

Tools > Small Basic 菜单建议新增：

1. `Compile Current File`
2. `Run Compiled Current File`
3. `Debug Compiled Current File`
4. `Use C# Runtime: .NET Framework 4.8`
5. `Use C# Runtime: .NET 8`
6. `Use C# Runtime: .NET 8 Windows`

这样与当前“显式选择后端”的交互模型一致，不需要新增独立设置页。

若一期固定 `net48`，则菜单可先收敛为：

1. `Compile Current File`
2. `Run Compiled Current File`
3. `Debug Compiled Current File`

把运行时选择留到后续版本再开放。

### 6.2 `launch.vs.json` 扩展

当前 Open Folder schema 只覆盖：

- `program`
- `target`
- `backend`
- `noDebug`
- `stopOnEntry`

建议为 `type: "smallbasic"` 增加：

- `launchKind`
- `runtime`
- `outputDirectory`
- `rebuild`

示例：

```jsonc
{
  "type": "smallbasic",
  "project": "hello/hello.sb",
  "projectTarget": "csharp-net48-compiled",
  "name": "SmallBasic [Compiled]: Debug current file with C# backend (.NET Framework 4.8)",
  "program": "${file}",
  "backend": "csharp",
  "launchKind": "compiled",
  "runtime": "net48",
  "outputDirectory": ".smallbasic/bin/hello/net48",
  "rebuild": "ifChanged",
  "stopOnEntry": false
}
```

行为建议：

- `SmallBasicLaunchDebugTargetProvider` 先解析 `launchKind`
- `compiled` 分支下，先调用 compiler tool，再决定走 `Run(...)` 还是 `Debug(...)`
- `projectTarget` 继续承担 VS 用来区分 profile identity 的角色

### 6.3 调试接入

当前 `SmallBasicDebugLauncher` 会：

1. 解析后端
2. 生成临时 `launch-*.json`
3. 调用 `DebugAdapterHost.Launch`

compiler mode 下建议改为：

1. 先取得编译产物入口路径
2. C# 编译产物若支持 `debug`，则把**产物入口**作为 `$adapter`
3. `program` 仍然保留为原始 `.sb`，供断点 source identity、条件断点与表达式求值使用

这样可以最大限度复用现有 DAP 工作流。

这里需要明确区分两种“能否调试”：

### A. 用 VS 自带的普通 .NET 托管调试器直接调试生成的 EXE

**不建议把它作为 Small Basic 调试方案。**

原因：

- 旧编译器虽然会生成 `*.pdb`；
- 但从反编译结果中，目前只能明确看到 `DefineDynamicModule(..., emitSymbolInfo: true)`；
- **没有看到**把 `.sb` 源文件映射为可用 sequence points 的 `DefineDocument` / `MarkSequencePoint` 一类逻辑；
- 因而不能把“普通托管调试”当成 Small Basic 源级断点、单步、变量语义的可靠基础。

结论：即使生成的 `net48` EXE 可以被 Visual Studio 当作普通托管程序启动，它也**不等价于**当前扩展里的 Small Basic 调试体验。

### B. 继续走现有 Small Basic DAP 路线，在 VS 里调试“编译产物”

**可行。**

当前 VS 调试接入的关键点是：

1. `SmallBasicDebugLauncher` 本质上是生成临时 launch JSON，再调用 `DebugAdapterHost.Launch`；
2. Debug Adapter Host 只要求能启动一个 adapter 进程，并不要求它必须是当前的 RunHost；
3. 当前真正的限制在于：
   - `launch.vs.json` schema 还没有 `launchKind=compiled`
   - `SmallBasicLaunchDebugTargetProvider` 目前把 `program` 强约束为 `.sb`

因此，只要后续满足下面两个条件，VS 就能调试 compiler mode 产物：

- **条件 1**：`net48` 编译产物或其配套 adapter 支持 `debug` 子命令（或等价入口）；
- **条件 2**：launch provider / debug launcher 能把“原始 `.sb` + 编译产物入口”同时传给 adapter。

推荐的最小实现是：

- `SmallBasic.Compiler.Tool compile ...` 输出：
  - `program.exe`
  - `program.pdb`
  - `SmallBasicLibrary.dll`
  - `smallbasic.program.json`（记录源文件哈希、入口、运行时、是否图形程序）
- VS 在 `launchKind=compiled` 时：
  - 先运行 compiler tool
  - 再把 `program.exe debug`（或 `SmallBasic.Compiler.Tool debug --artifact ...`）作为 `$adapter`
  - 同时把原始 `.sb` 路径继续作为 `program` / `source` 语义输入

这样一来，VS 看到的仍然是 **Small Basic 自定义 DAP 会话**，而不是退化成普通 .NET EXE 调试。

## 7. 打包与分发调整

### 7.1 统一运行时 ID

建议把运行时选择的**逻辑 ID**统一成 TFM 字面值：

- `net48`
- `net8.0`
- `net8.0-windows`

IDE、compiler tool、manifest 都使用这三个值。

文件夹命名可以继续保持现状映射，例如：

- VS Code 扩展内部仍用 `windows` / `portable`
- VSIX 仍可用 `csharp/`

但运行时选择逻辑必须统一映射到三种 canonical ID。

### 7.2 VS Code 载荷

VS Code 端建议新增：

- `runhost/compiler/SmallBasic.Compiler.Tool.*`

并继续复用：

- `runhost/windows/**`
- `runhost/portable/**`

不需要改变 `blazor/` 与 Web 载荷。

### 7.3 Visual Studio VSIX 载荷

Visual Studio 当前 `PrepareRunHostForVsix` 只把 `net48` 打进 `runhost/csharp/`。

若要支持 compiler mode 的三运行时，建议改为 VSIX 内同时携带：

- `runhost/net48/**`
- `runhost/net8.0/**`
- `runhost/net8.0-windows/**`
- `runhost/compiler/**`

原因：

1. Visual Studio 侧需要本地选择运行时；
2. compiler tool 需要有稳定的宿主模板来源；
3. 否则 VS 端只能做 `net48` 编译器模式，能力会与 VS Code 桌面版分叉。

## 8. 调试语义要求

compiler mode 必须继承现有调试语义，而不是定义第二套 debugger contract：

- 断点吸附仍基于 `GetExecutableLines()`
- 条件断点仍基于 `CompileExpression(...)`
- Watch / Debug Console 仍基于 `EvaluateExpressionAsync(...)`
- 运行时错误仍复用 `LastError`

因此，编译产物调试的重点不是协议创新，而是：

1. 如何定位产物入口；
2. 如何保证“源码文件”和“编译产物所携带源码”一致；
3. 如何在 `rebuild=never` 时给出明确错误。

建议规则：

- 若 `sourceHash` 与当前工作区源码不一致：
  - `rebuild=always` / `ifChanged`：自动重编译
  - `rebuild=never`：阻止启动，并明确提示“源码已变化，编译产物过期”

## 9. 非目标

本文方案**不**包含以下事项：

- JavaScript / Blazor 的 compiler mode
- 把 Small Basic 编译为 C# 或 IL
- 单文件自包含发布
- RID 矩阵打包
- Web 版 / `vscode.dev` 的编译功能
- 安装包签名、图标资源注入、Windows Shell 集成

这些都可以放到 compiler mode 稳定后再评估。

## 10. 建议落地顺序

### 阶段 0（本次）

- 完成源码调查与设计文档

### 阶段 1

- 引入 `SmallBasic.Compiler.Tool`
- 先支持“编译输出文件夹工件”
- 先支持“运行编译产物”

### 阶段 2

- 支持“调试编译产物”
- VS Code / VS 的 `launch.json` / `launch.vs.json` 接入 `launchKind=compiled`

### 阶段 3

- 评估单文件封装、RID、自包含发布、Windows 图标等增强项

## 11. 最终建议

综合当前代码现状，建议明确采用以下判断：

1. **现成 upstream 代码中不存在 compiler mode / EXE emitter**；
2. **当前仓库已经具备做 compiler mode 的运行时与调试基础**；
3. **实现路径应是“宿主打包 + 统一工件契约 + IDE 编译工作流”**，而不是重写编译器发射后端；
4. **三运行时都可纳入设计**，但 `net8.0` 在第一阶段应表述为“便携运行时包”，不要过度承诺统一 EXE 体验；
5. **VSIX 侧需要补齐 `net8.0` / `net8.0-windows` 与 compiler tool 载荷**，否则 Visual Studio 无法与 VS Code 桌面版保持同等能力。
