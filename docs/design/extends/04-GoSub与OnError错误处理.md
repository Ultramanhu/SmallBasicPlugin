# 04 GoSub 与 On Error 错误处理

> 调研日期：2026-10-06
> 状态：**已实施**（2026-10-07；设计分析见下文，实施结果见 §10）
> 目标版本：Language Extension v1.4
> 适用范围：C# / TypeScript 双语言核心，JavaScript / C# / Blazor 三种运行与调试后端，Visual Studio / VS Code / Monaco Playground 三类编辑表面

## 0. 结论先行

这次需求里，`GoSub` 本身并不复杂；真正有规模的是 `On Error`。

当前仓库里的两个运行时都还没有“统一的、可恢复的运行时错误模型”：

- **TypeScript** 侧只有少量 `Diagnostic` 风格的终止错误，更多情况要么直接抛原生 `Error`，要么像 `Math.SquareRoot(-4)`、`Math.Log(0)`、`Math.Div(9, 0)` 这样**静默折叠为 `0`**。
- **C#** 侧更偏“宿主异常直出”：`SmallBasicEngine` 自身没有 `LastError` / `RuntimeError` 槽位，`MathLibrary` 与部分库直接把非法数学结果折叠为 `0`，宿主/调试器再在最外层 `catch (Exception)` 后输出文本并结束会话。
- **调试器** 目前把“运行时错误”视为“宿主或引擎抛异常后立即 terminated”，没有保留失败现场，也没有“handled runtime error”的概念。
- **编辑器** 目前没有 `GoSub`、`On Error` 的语法模型；VS Code/Monaco 的 definition/reference 只认识 `InvocationExpression` 的过程调用，Visual Studio 的分类器/补全/悬停也不知道 `On Error GoSub Handler` 里的 `Handler` 是过程符号。

因此，这个需求不是“加几个关键字”就结束，而是要同时补上：

1. **语法与绑定**：识别 `GoSub` / `On Error`，并把 handler 目标绑定为真正的 `Sub` 符号。
2. **运行时错误模型**：把“除 0 / 非法数学域 / 栈空 / 不支持库 / 运行时宿主异常”统一收束为 `错误码 + 错误字符串`。
3. **可恢复执行**：为 `Resume Next` / `GoSub Handler` 增加“跳过当前语句、清理求值栈、必要时压入 handler frame”的能力。
4. **调试语义**：区分“已处理错误”和“未处理错误”；未处理错误至少应保留失败行与局部变量，已处理错误则只镜像到控制台，不应让 IDE 误判为调试器崩溃。
5. **编辑器语义**：关键字着色、补全、悬停、诊断，以及（TS 侧已有的）定义/引用都要认识 `GoSub` 与 `On Error GoSub`。

建议将本次扩展定义为 **Language Extension v1.4**，并补齐对应的 capability 握手与回归测试。

## 1. 建议语义契约

### 1.1 新语法

| 语法 | 约束 | 语义 |
|---|---|---|
| `GoSub Handler` | `Handler` 必须是已定义的 `Sub`；本提案第一版只接受**裸标识符**，不接受实参列表 | 调用目标 `Sub`，等价于一个“关键字形式”的过程调用 |
| `On Error Resume Next` | 无 | 后续运行时错误统一写入控制台，并跳过当前失败语句，继续执行下一条语句 |
| `On Error GoTo -1` | 无 | 清空当前运行时错误状态，恢复**默认的出错即终止**语义 |
| `On Error GoTo 0` | 无 | 清除当前注册的 `GoSub` 错误回调；对外语义上等价于“禁用回调”，不再重定向到 handler |
| `On Error GoSub Handler` | `Handler` 必须是已定义的 `Sub`，且**恰好有 2 个参数** | 发生运行时错误时：先写控制台，再中断当前语句，调用 `Handler(code, message)`，handler 返回后继续执行失败语句的下一条 |

### 1.2 关键的语义取舍

#### 1.2.1 `GoSub` 是 `Sub` 调用，不是 `GoTo` 标签跳转

这里的 `GoSub` 明确不是 VB6 风格的“跳到标签再返回”，而是：

- 目标只能是 **`Sub` 名称**；
- 走现有的**调用帧**模型；
- 会出现在调用栈里；
- 可以被 debugger 的 `stepIn` / `stepOut` 正常看见。

这样可以最大化复用已经存在的 `Sub`/`Function` 调用约定，而不必在两个 VM 里再造一套“label-return stack”。

#### 1.2.2 `GoSub` 第一版建议只支持无参调用

用户给出的需求是 `GoSub Func` 这种形态，而当前语言已经有：

- `Sub Ping`
- `Ping`
- `Ping()`
- `Ping(1, 2)`

所以 plain `GoSub` 最适合作为**显式的“调用某个无参 Sub”关键字写法**，第一版建议：

- `GoSub Handler`：允许；
- `GoSub Handler()`：**不允许**；
- `GoSub Handler(1, 2)`：**不允许**；
- `GoSub` 目标若声明了参数：报诊断。

这样实现最小、调试最稳定，也不会和现有 `Sub(...)` 调用形式重叠。

#### 1.2.3 `On Error` 第一版建议按“引擎级状态”实现

Small Basic 当前没有 `Err` 对象，也没有 `Resume` / `Resume <label>` / `Resume <line>` 等配套语法。为了把复杂度控制在可交付范围内，建议第一版采用**引擎级**（program-wide）错误处理状态，而不是 VB/VBA 那种逐过程 handler 链：

- 任意位置执行 `On Error ...`，都会更新当前引擎的错误策略；
- 后续所有语句共享这套策略，直到被新的 `On Error ...` 覆盖；
- `On Error GoSub Handler` 调用的 handler 本身也是普通 `Sub`，它内部若再执行 `On Error ...`，同样覆盖引擎当前策略。

这样做的优点：

- TS 与 C# 两边都只需要在 engine 上挂一份 error state；
- 事件回调、定时器回调、普通 `Sub`/`Function` 调用不需要再叠加“过程级 handler 继承/回溯”规则；
- 调试器、Web debug 协议、RunHost capability 的表面最小。

代价是：它**不是**完整复刻 VB 的过程级 `On Error`。但从当前需求来看，这个取舍是可接受且显著降低风险的。

#### 1.2.4 handler 返回后的继续位置：固定为“失败语句的下一条”

因为本次需求没有要求 `Resume` 语句，所以建议：

- `On Error Resume Next`：失败后跳过当前语句；
- `On Error GoSub Handler`：调用 handler，handler 返回后也跳过当前语句。

也就是说，`On Error GoSub` 的续行语义与 `Resume Next` 保持一致，只是多了一次可观察的 `Sub(code, message)` 调用。

#### 1.2.5 错误处理必须是**非重入**的

如果 handler 自己再次触发错误，且仍允许同一个 handler 递归进入，很容易形成无限递归：

```smallbasic
On Error GoSub Handle
A = 1 / 0

Sub Handle(Code, Message)
  B = 1 / 0
EndSub
```

因此建议：

- 运行时维护 `isHandlingRuntimeError` 标志；
- 当 handler 正在执行，新的运行时错误一律按**未处理错误**终止程序；
- 依旧要把新错误写到控制台，并尽量带上第二次错误的 code/message。

### 1.3 统一错误表示

用户要求“统一用一个错误码和一个字符串表示”，建议收束为：

- `code`：`Number`
- `message`：`String`

控制台格式建议统一成：

```text
[Runtime Error] 1001: Divide by zero.
```

handler 的两参也固定为：

```smallbasic
Sub HandleError(Code, Message)
  TextWindow.WriteLine("ERR=" + Code)
  TextWindow.WriteLine(Message)
EndSub
```

第一版建议至少定义下列稳定错误码：

| 代码 | 名称 | 典型来源 |
|---|---|---|
| `1001` | DivideByZero | `/`、`\`、`Mod`、`Math.Div`、`Math.Mod`、`Math.Remainder` |
| `1002` | InvalidMathOperation | `Math.SquareRoot(-1)`、`Math.Log(0)`、`Math.ArcCos(2)`、`Math.ArcSin(2)` |
| `1003` | InvalidNumericResult | 结果落到 `NaN` / `Infinity` / .NET `decimal` 无法表示 |
| `1101` | EmptyStack | `Stack.PopValue` 在空栈上调用 |
| `1901` | UnsupportedLibraryOperation | 文本后端访问 `GraphicsWindow` 等宿主不支持成员 |
| `1999` | InternalRuntimeError | 解释器或宿主内部异常；尽量归一，但不保证可恢复 |

## 2. 当前基线与直接冲突点

### 2.1 现有“静默吞错”行为必须被改写

当前仓库中，以下行为与本需求直接冲突：

- `visual_studio_plugin/vendor/SmallBasicEditor/Source/SmallBasic.Editor/Libraries/MathLibrary.cs`
  - `Div` / `Mod` / `Remainder` 的除数为 `0` 时直接返回 `0`
  - `SquareRoot(-4)`、`ArcCos(2)` 等通过 `FromDouble` 折叠为 `0`
- `visual_studio_code_plugin/vendor/SmallBasicOnline/src/compiler/runtime/libraries/math.ts`
  - `Div` / `Mod` / `Remainder` 在除数为 `0` 时直接返回 `0`
  - 非法数学域与 `Infinity` / `NaN` 直接折叠为 `0`
- `visual_studio_plugin/tests/SmallBasic.Compiler.Tests/Runtime/ArithmeticOperatorsTests.cs`
- `visual_studio_code_plugin/packages/smallbasic-lang-core/tests/language-extension.spec.ts`
- `README.md` 与 [03-整除与取余扩展.md](./03-整除与取余扩展.md)

这些地方当前都在把“数学错误 = 正常结果 `0` / `1`”当成语义契约。要支持 `On Error`，这条契约必须整体改成“产生运行时错误，再由 `On Error` 决定是否恢复”。

### 2.2 现有 debugger 只会“报错后直接结束”

- TS debug driver：`packages/smallbasic-vscode/src/debug/engine-driver.ts`
- .NET DAP 基类：`visual_studio_plugin/src/SmallBasic.RunHost/Debug/DapAdapterBase.cs`
- Blazor 调试桥：`visual_studio_plugin/src/SmallBasic.Blazor.Client/Runtime/BrowserEngineSession.cs`

这三条链路当前都没有“停在异常现场但不立刻销毁状态”的能力；因此未处理错误若想拥有可调试性，至少要补一个“`stopped(reason=exception)` + 再 terminate”的中间态。

### 2.3 现有编辑器只认识“普通调用表达式”

目前下列能力默认只把 `Foo()` 这类语法当作过程引用：

- TS definition/reference：`packages/smallbasic-language-services/src/navigation.ts`
- TS user-function signature help：`packages/smallbasic-language-services/src/method-signatures.ts`
- TS / C# hover：`vendor/.../compiler/services/hover-service.ts` 与 `SmallBasic.Compiler/Services/HoverProvider.cs`

因此：

- `GoSub Foo` 里的 `Foo`
- `On Error GoSub Handle` 里的 `Handle`

都必须新增专门分支，否则编辑器会把它们当成普通变量文本处理。

## 3. 语言核心与运行时：需要做的改动

### 3.1 TypeScript 侧（`visual_studio_code_plugin/vendor/SmallBasicOnline`）

| 文件/区域 | 需要做的改动 |
|---|---|
| `src/compiler/syntax/tokens.ts` | 新增 `GoSubKeyword`；`On/Error/Resume/Next` 建议继续保持**上下文关键字**，不要全局保留，以降低兼容性破坏 |
| `src/compiler/syntax/scanner.ts` | 识别 `GoSub`；`On/Error/Resume/Next` 仍按 `Identifier` 扫描 |
| `src/compiler/syntax/command-parser.ts` | 新增 `parseGoSubCommand()`；新增 `parseOnErrorCommand()`，按 `Identifier("On") + Identifier("Error") + ...` 识别 4 个合法子句 |
| `src/compiler/syntax/syntax-nodes.ts` | 新增 `GoSubCommandSyntax`、`OnErrorCommandSyntax`（建议带 `action: "resume-next" | "goto-default" | "goto-clear" | "gosub"` 与可选 target token） |
| `src/compiler/syntax/statements-parser.ts` | 把两种新 command 当成普通可执行 statement 收进 block；它们不会形成新的 block 结构 |
| `src/compiler/utils/compiler-utils.ts` | `commandToDisplayString()`、`tokenToDisplayString()` 补齐 `GoSub` 与 `On Error ...` 的展示文本 |
| `src/compiler/utils/diagnostics.ts` + `src/strings/diagnostics.ts` | 新增语义诊断：如 `GoSubTargetMustBeSub`、`GoSubTargetMustBeParameterlessSub`、`OnErrorHandlerMustBeTwoParameterSub`、`InvalidOnErrorClause` |
| `src/compiler/binding/modules-binder.ts` | `ProcedureSymbol` 已有 `kind/parameters/returnsValue`，可直接用于校验 `GoSub` 与 handler arity，无需再造符号模型 |
| `src/compiler/binding/statement-binder.ts` | `GoSub` 绑定为新的 bound node，或直接 lower 成 `BoundSubModuleInvocationStatement`；`On Error GoSub` 需要校验目标是 `Sub` 且参数数为 2 |
| `src/compiler/binding/bound-nodes.ts` | 若 `GoSub` / `On Error` 不直接 lower，需要新增对应 bound 节点；推荐 `GoSub` lower 成既有 `BoundSubModuleInvocationStatement`，`On Error` 保留独立节点 |
| `src/compiler/emitting/module-emitter.ts` | `GoSub` 复用既有 `InvokeSubModuleInstruction`；`On Error ...` 需要发射新的错误策略指令 |
| `src/compiler/emitting/instructions.ts` | 新增 `SetErrorHandlerInstruction` / `ClearErrorHandlerInstruction` / `SetResumeNextInstruction` 等，或一个参数化 `ConfigureErrorHandlingInstruction` |
| `src/compiler/execution-engine.ts` | 这是 TS 侧的核心改动点：新增统一 `RuntimeError`、错误策略状态、当前语句栈基线、错误恢复与 handler 派发 |
| `src/compiler/runtime/libraries/math.ts` | 从“返回 0”改成“构造 `RuntimeError` 并交给 engine” |
| `src/compiler/runtime/libraries/stack.ts` | 现有 `Diagnostic(ErrorCode.PoppingAnEmptyStack)` 应迁到统一 `RuntimeError` 模型 |

#### 3.1.1 TS 运行时建议新增的 engine 状态

建议在 `ExecutionEngine` 中新增至少这些字段：

- `runtimeError?: RuntimeError`
- `errorMode: "abort" | "resume-next" | "gosub"`
- `errorHandlerSubName?: string`
- `isHandlingRuntimeError: boolean`
- `currentStatementLine: number`
- `currentStatementEvaluationStackBase: number`

其中最关键的是最后两项：`Resume Next` / `GoSub` 都要求**从失败语句的下一条继续**，而当前 engine 只有过程级 `evaluationStackBase`，没有“语句级回滚点”。建议在每次进入新源码行的第一条指令前记录：

1. 当前行号
2. 当时的 evaluation stack depth

一旦某条指令在本行内失败：

- 先把 evaluation stack 恢复到 `currentStatementEvaluationStackBase`
- 再把当前 frame 的 `instructionIndex` 快进到**下一条源码行**
- 根据 `errorMode` 决定终止、直接继续，还是 `pushProcedure(handler, [code, message], false)`

这样无需把整个 VM 做成“每条指令事务”，但足以覆盖本语言“一行一个 statement”的语法模型。

#### 3.1.2 `GoSub` 在 TS 侧建议直接 lower 到既有调用指令

plain `GoSub Handler` 不建议再造独立运行时指令；最稳妥的办法是：

- parser/binder 保留它是一个新 statement 的事实，用于诊断与编辑器语义；
- emitter 直接发射既有 `InvokeSubModuleInstruction(name, 0, false, range)`。

这样：

- debugger 的调用栈逻辑不需要感知新的 call kind；
- JS 与 .NET 两侧都能复用现有 `Sub` frame；
- 编辑器仍能通过 syntax/bound node 知道“这是 `GoSub` 而不是 `Foo`”。

### 3.2 C# 侧（`visual_studio_plugin/vendor/SmallBasicEditor`）

| 文件/区域 | 需要做的改动 |
|---|---|
| `official_repo/editor/Source/SmallBasic.Generators/Scanning/TokenKinds.xml` | 新增 `GoSub`（仅 plain `GoSub` 建议成为真正 token） |
| `official_repo/editor/Source/SmallBasic.Generators/Parsing/SyntaxNodes.xml` | 新增 `GoSubStatementSyntax`、`OnErrorStatementSyntax` |
| `official_repo/editor/Source/SmallBasic.Generators/Diagnostics/Diagnostics.xml` | 新增 `GoSub` / `On Error` 的语义诊断 |
| 生成后的 `SmallBasic.Compiler/Scanning/TokenKind.Generated.cs` | 同步生成产物 |
| 生成后的 `SmallBasic.Compiler/Parsing/SyntaxNodes.Generated.cs` | 同步生成产物 |
| 生成后的 `SmallBasic.Compiler/Diagnostics/*.Generated.cs` | 同步生成产物 |
| `SmallBasic.Compiler/Parsing/Parser.cs` | 解析 `GoSub`；按 `Identifier("On") + Identifier("Error")` 识别 `On Error` 四种语法 |
| `SmallBasic.Compiler/Binding/Binder.cs` | `GoSub` 与 `On Error GoSub` 的目标校验；新增 bound node 或直接 lower 策略 |
| `SmallBasic.Compiler/Runtime/ModuleEmitter.cs` | 发射错误策略配置指令；`GoSub` 复用 `InvokeSubModuleInstruction` |
| `SmallBasic.Compiler/Runtime/RuntimeModule.cs`、`Runtime/Frame.cs` | 如需记录语句级回滚点、handler frame 标记、last error 等，需要补模型字段 |
| `SmallBasic.Compiler/SmallBasicEngine.cs` | 与 TS `execution-engine.ts` 同级别的大改：统一 `RuntimeError`、error mode、handler dispatch、statement rollback |
| `SmallBasic.Editor/Libraries/MathLibrary.cs` | 停止把非法数学结果折叠成 `0`；改为抛可归一的运行时错误，或返回统一错误结果 |
| `SmallBasic.Editor/Libraries/StackLibrary.cs` | 当前空栈 `PopValue` 返回空字符串，需与 TS 一致改成运行时错误 |
| `SmallBasic.RunHost/Libraries/UnsupportedLibraries.cs` | `NotSupportedException` 需要归一成稳定 runtime error，而不是把 .NET 异常栈原样透出 |

#### 3.2.1 C# 侧最大的额外成本：库调用包装是生成代码

`SmallBasic.Compiler/Runtime/Libraries/Libraries.Generated.cs` 是生成文件，当前每个库方法都直接：

1. 从 `EvaluationStack` 取参
2. 调用 `engine.Libraries.Xxx.Method(...)`
3. 把返回值压回栈

这意味着如果要把 `MathLibrary` / `UnsupportedLibraries` / 其它库中的异常统一路由到 `On Error`，不能靠“散落在每个方法里手改生成产物”解决。更稳妥的方向有两个：

1. **在生成模板层补一层统一包装**  
   让每个生成的 `execute(SmallBasicEngine engine)` 都经过共享 helper，例如：  
   `RuntimeErrorHelpers.Invoke(engine, range, () => engine.Libraries.Math.Div(...))`
2. **定义专用异常类型**  
   例如 `SmallBasicRuntimeException(code, message)`，生成代码统一 `catch (SmallBasicRuntimeException)` 后交给 engine 的错误分派器

无论选哪条，都建议保持“生成模板改一次、所有库方法自动受益”的结构，不要手改 `Libraries.Generated.cs`。

#### 3.2.2 `SmallBasicEngine` 需要新增显式的 runtime error 通道

与 TS 侧不同，C# 当前 `SmallBasicEngine` 只有：

- `State`
- `CurrentSourceLine`
- `ExecutionStack`
- `EvaluationStack`
- `Memory`

没有 `Exception` / `LastError` 槽位。为了让 console RunHost、DAP adapter、Blazor browser session 都走同一条逻辑，建议在 engine 上补：

- `RuntimeError? LastError`
- `void ReportRuntimeError(RuntimeError error)`
- `void ClearRuntimeError()`
- `ErrorHandlingMode ErrorMode`
- `string? ErrorHandlerSubName`

这样外层宿主就不用再依赖 `catch (Exception)` 来判断“是不是 Small Basic 语言错误”。

### 3.3 需要新增/调整的语义诊断

建议两边编译器都补齐下列诊断（名称可调整，语义不要丢）：

| 场景 | 建议诊断 |
|---|---|
| `GoSub` 目标不是 `Sub` | `GoSubTargetMustBeSub` |
| `GoSub` 目标有参数 | `GoSubTargetMustBeParameterlessSub` |
| `On Error GoSub` 目标不是 `Sub` | `OnErrorHandlerMustBeSub` |
| `On Error GoSub` 目标参数数不是 2 | `OnErrorHandlerMustAcceptCodeAndMessage` |
| `On Error GoTo Label` 这类不合法写法 | `InvalidOnErrorClause` |
| `On Error Resume Foo` / `On Error GoSub 0` | `InvalidOnErrorClause` |

另外，建议 plain `GoSub` 与 `On Error GoSub` 共用既有的“未定义过程/参数数不匹配/与库名冲突”等基础校验，而不是复制一套新规则。

## 4. 调试器：需要做的改动

### 4.1 调试语义建议

建议把运行时错误分成两类：

1. **已处理错误**
   - `Resume Next`
   - `GoSub Handler`
   - 处理方式：写控制台；不主动发送 `terminated`；仅当单步/断点命中 handler 时才正常停住
2. **未处理错误**
   - 默认模式 / `On Error GoTo -1`
   - 处理方式：先写控制台，再以 `stopped(reason="exception")` 保留失败现场；用户继续或终止后结束会话

这样可以同时满足：

- 用户要求“错误统一输出至控制台”
- debugger 不再把语言级运行时错误误当成“适配器崩溃”
- handler 被视为正常 `Sub` 调用，locals/stackTrace 逻辑自动成立

### 4.2 VS Code / Monaco / JS Web 调试链

| 文件/区域 | 需要做的改动 |
|---|---|
| `packages/smallbasic-vscode/src/debug/engine-driver.ts` | 识别 `engine.LastError` / `engine.exception` 的新模型；把未处理错误变成 `onStopped("exception", snapshot)` 而不是立刻 `finish(1)`；已处理错误只输出控制台文本 |
| `packages/smallbasic-vscode/src/debug/session.ts` | `StoppedEvent` reason 允许 `"exception"`；必要时把 code/message 放进 `description` 或先发 `OutputEvent` 再停住 |
| `packages/smallbasic-vscode/src/runhost/web-debug.ts` | 浏览器端 JS debug session 也要发 `reason: "exception"`，并镜像统一错误文本 |
| `packages/smallbasic-vscode/src/web/debug-protocol.ts`（若需要） | 若浏览器协议要显式带错误码，可增加可选 `errorCode` / `message` 字段；若只靠 `reason + output`，则可不改协议版本 |
| `packages/smallbasic-vscode/tests/debug-session.spec.ts` | 新增“未处理错误停在异常现场”“Resume Next 不终止”“On Error GoSub 进入 handler frame” |
| `packages/smallbasic-vscode/tests/browser-debug-session.spec.ts` / `webview-debug-adapter.spec.ts` | Web 模式对齐同样的 exception/handled-error 行为 |

### 4.3 C# DAP / Blazor 调试链

| 文件/区域 | 需要做的改动 |
|---|---|
| `src/SmallBasic.RunHost/Debug/DapAdapterBase.cs` | 当前 `catch (Exception ex)` 直接输出并 `EndSession(1)`；应改为优先消费 `engine.LastError`，并支持 `SendStopped("exception", "...")` |
| `src/SmallBasic.RunHost/Debug/DebugAdapter.cs` | stack/locals 本身复用现有 frame 即可，但需要在 exception stop 之后保持 snapshot 仍可读 |
| `src/SmallBasic.Blazor.RunHost/Debug/BlazorDebugAdapter.cs` | 本地 C# engine 与浏览器 WASM 两条路径都要支持 exception stop；若 `BrowserMessage` 扩展了错误字段，这里也要转给 DAP |
| `src/SmallBasic.Blazor.Shared/Protocol.cs` | 如果要让 WASM runtime 把错误码结构化送回适配器，可给 `BrowserMessage` 增加可选 `ErrorCode` / `Message` 字段；属于向后兼容的可选扩展 |
| `src/SmallBasic.Blazor.Client/Runtime/BrowserEngineSession.cs` | `RunDebugAsync()` / `ExecuteControlAsync()` 里要区分 handled 与 unhandled runtime error，并在需要时推送 `stopped(exception)` |
| `src/SmallBasic.Blazor.RunHost/Hosting/BlazorHostSession.cs` | 若协议加了新的错误字段，只做透传即可 |

### 4.4 capability 握手要从“只认 function-v1”升级为通用特性集合

当前能力探测只检查：

- `packages/smallbasic-vscode/src/run/capabilities.ts`
- `packages/smallbasic-vscode/src/run/csharp-runner.ts`
- `src/SmallBasic.RunHost/Program.cs`

而且只认 `function-v1`。这对于新特性已经不够：

- 旧 RunHost 看不懂 `GoSub`
- 旧 RunHost 看不懂 `On Error`
- 旧调试宿主也不会提供新的错误恢复语义

建议至少新增：

- `gosub-v1`
- `error-handling-v1`

更稳妥的做法是顺手把 capability helper 抽象成“检查一组 required capabilities”，否则未来每加一个语言扩展都要继续复制 `supportsXxxCapability()`。

## 5. 编辑器：需要做的改动

### 5.1 词法着色与即时兜底着色

#### VS Code / Monaco

| 文件/区域 | 需要做的改动 |
|---|---|
| `packages/smallbasic-vscode/syntaxes/smallbasic.tmLanguage.json` | 新增 `GoSub`；为 `On Error Resume Next` / `On Error GoTo -1` / `On Error GoTo 0` / `On Error GoSub Foo` 增加上下文正则，让 `On`、`Error`、`Resume`、`Next` 也按 keyword 着色 |
| `packages/smallbasic-vscode/language-configuration.json` | `On Error` 不是 block，不需要改缩进规则；只需确认 `wordPattern` 对 `-1` 不产生副作用 |
| `packages/smallbasic-language-services/src/semantic-tokens.ts` | 让 `GoSub`、`On`、`Error`、`Resume`、`Next` 在其语法位置上被标成 `keyword`；`On Error GoSub Handler` 里的 `Handler` 应标成 `function` |

#### Visual Studio

| 文件/区域 | 需要做的改动 |
|---|---|
| `src/SmallBasic.Vsix/Editor/Classification/SmallBasicSimpleLexer.cs` | `Keywords` 集合加入 `GoSub`；另外要增加一条“行级上下文”规则，把 `On Error ...` 里的 `On/Error/Resume/Next` 识别成关键字，而不是普通 `Identifier` |
| `src/SmallBasic.Vsix/Editor/Classification/SmallBasicClassifier.cs` | plain `GoSub Handler` / `On Error GoSub Handler` 中的 `Handler` 仍应使用过程颜色；当前它按“名字是否存在于 outline procedure set”高亮，大概率天然可用，但要补回归用例确认 |

### 5.2 补全、悬停、签名与导航

#### 两边都要补的能力

| 能力 | 需要做的改动 |
|---|---|
| Completion | 新增 `GoSub`、`On Error Resume Next`、`On Error GoTo -1`、`On Error GoTo 0`、`On Error GoSub ${1:Handler}` 五类片段 |
| Hover | 在关键字上提供说明；在 `GoSub Foo` 与 `On Error GoSub Foo` 的 `Foo` 上显示 `Sub Foo` 的签名/说明 |
| Diagnostics | parser/binder 新诊断会自动下沉到 IDE，但要保证错误消息文案和行列范围准确 |
| Signature Help | plain `GoSub Foo` 没有参数列表，不需要新增签名帮助入口；`On Error GoSub Foo` 也不需要 |

#### TypeScript / VS Code / Monaco 具体文件

| 文件/区域 | 需要做的改动 |
|---|---|
| `vendor/SmallBasicOnline/src/compiler/services/completion-service.ts` | 关键字 snippets 新增 `GoSub` / `On Error ...` |
| `vendor/SmallBasicOnline/src/compiler/services/hover-service.ts` | 新增 `GoSub` 与 `On Error` keyword hover；新增对 handler token 的过程 hover |
| `packages/smallbasic-language-services/src/navigation.ts` | 现有 definition/reference 只认 `InvocationExpression`；要把 `GoSub` 与 `On Error GoSub` 的目标 token 收集为 `procedureInvocation` |
| `packages/smallbasic-language-services/src/completions.ts` / `contextual-completions.ts` | 让 `On`、`On Error` 的上下文补全更自然，例如用户输入 `On E` 时能优先给 `On Error Resume Next` |
| `packages/smallbasic-vscode/snippets/smallbasic.json` | 增加显式 snippets |
| `packages/smallbasic-vscode/src/language/signature-help.ts` / `method-signatures.ts` | 原则上无需新增逻辑，但要确认 `GoSub` 不会被误判成普通调用并弹出签名提示 |

#### C# / Visual Studio 具体文件

| 文件/区域 | 需要做的改动 |
|---|---|
| `SmallBasic.Compiler/Services/CompletionItemProvider.cs` | 与 TS completion 一样新增片段；`On Error` 的说明文案可继续走 `DocumentationLocales` |
| `SmallBasic.Compiler/Services/HoverProvider.cs` | 新增 keyword hover；识别 `GoSub`/`On Error GoSub` 的过程目标 |
| `SmallBasic.Compiler/Services/SignatureHelpProvider.cs` | 原则上无需新增语法，但要确认 `GoSub` / `On Error` 不会干扰现有函数/过程签名识别 |
| `src/SmallBasic.LanguageServices/Lsp/SmallBasicLspAnalysisService.cs` | 这里只是把编译器语义映射到 LSP；编译器提供了新 completion/hover/diagnostic 后，这里通常无需新协议字段 |

### 5.3 Outline / 导航栏 / 文档符号

这部分原则上**不需要新 symbol kind**：

- `GoSub` 只是新的调用语法，不声明新符号；
- `On Error ...` 只是执行语句，不声明新块。

所以：

- `OutlineProvider`
- `smallbasic-language-services/src/document-symbols.ts`
- `src/SmallBasic.Vsix/Editor/Outlining/SmallBasicOutliningTagger.cs`
- `src/SmallBasic.Vsix/Editor/NavigationBar/*`

理论上都不需要新节点类型，只要 parser 不把新语法误当成未识别语句即可。

### 5.4 本地化资源

`On Error` 不是普通库成员，说明文案要走关键字/文档资源，而不是 `LibrariesResources`：

- TS：`visual_studio_code_plugin/vendor/SmallBasicOnline/src/strings/documentation.locales.ts`
- C#：`visual_studio_plugin/vendor/SmallBasicEditor/Source/SmallBasic.Utilities/DocumentationLocales/DocumentationLocales.xml`

至少建议补下面这些 key：

- `Keywords_GoSub`
- `Keywords_OnErrorResumeNext`
- `Keywords_OnErrorGoToMinus1`
- `Keywords_OnErrorGoTo0`
- `Keywords_OnErrorGoSub`

否则补全与 hover 只能显示英文标题，而不能走现有 21 语言文档体系。

## 6. 宿主与控制台输出：需要做的改动

### 6.1 统一 runtime error 输出格式

当前各宿主输出并不完全一致：

- Node CLI：`[Runtime Error] ${engine.exception.toString()}`
- VS Code Pseudoterminal：同上
- .NET CLI：通常是 `catch (Exception ex)` 后直接 `Console.Error.WriteLine(ex)`
- Blazor Browser：`BrowserEngineSession` 里把整个异常对象文本直接追加到 view

实现本需求时，四条路径都应该统一成**同一种语言级格式**，例如：

```text
[Runtime Error] 1002: Invalid math operation.
```

涉及文件至少包括：

- `packages/smallbasic-vscode/src/runhost/main.ts`
- `packages/smallbasic-vscode/src/runhost/web.ts`
- `packages/smallbasic-vscode/src/run/terminal-session.ts`
- `visual_studio_plugin/src/SmallBasic.RunHost/Program.cs`
- `visual_studio_plugin/src/SmallBasic.Blazor.Client/Runtime/BrowserEngineSession.cs`
- `visual_studio_plugin/src/SmallBasic.Blazor.Client/Runtime/RuntimeViewModel.cs`

### 6.2 JS/C#/Blazor 三后端都要对齐

这里不能只改某一条运行链：

- **JS**：VS Code CLI、VS Code Web、Playground 都直接吃 TS engine
- **C#**：Visual Studio 默认 F5 与 VS Code 的 C# backend 都走 `SmallBasic.RunHost`
- **Blazor**：文本模式可在本地 engine 跑，图形模式又会通过 `BrowserEngineSession` + WebSocket 协议进浏览器

如果只改其中一条，会马上出现：

- 同一份 `.sb` 程序，在 JS 后端能 `On Error Resume Next`，在 C# 后端却直接终止；
- CLI 能得到错误码，Blazor 图形程序却只看到 .NET 栈异常；
- debugger 的 locals/stack 在一种后端里可见，在另一种里直接 terminated。

因此这项功能的验收粒度必须是“**三后端一致**”。

## 7. 测试与回归面

### 7.1 需要新增的核心场景

#### 语言/运行时

1. `GoSub Handler` 调用无参 `Sub`
2. `GoSub` 目标不存在 / 是 `Function` / 带参数 `Sub`
3. `On Error Resume Next` 遇到：
   - `/ 0`
   - `\ 0`
   - `Mod 0`
   - `Math.Div/Mod/Remainder(..., 0)`
   - `Math.SquareRoot(-1)`
   - `Math.Log(0)` / `Math.NaturalLog(0)`
   - `Math.ArcCos(2)` / `Math.ArcSin(2)`
4. `On Error GoSub Handler`：
   - handler 收到正确的 `(code, message)`
   - handler 返回后继续执行下一语句
   - handler 再次出错时按非重入策略终止
5. `On Error GoTo -1` 恢复默认终止
6. `On Error GoTo 0` 清除 handler
7. 事件回调 / 递归 / 嵌套 `Sub` 调用中，错误策略仍按引擎级语义工作

#### 调试

1. 未处理错误停在异常行，`stackTrace` / `locals` 仍可读
2. `Resume Next` 只输出控制台，不触发 `terminated`
3. `On Error GoSub Handler` 进入 handler 时调用栈新增一帧，且两参可见
4. Web debug（JS/Blazor）与 CLI debug（JS/C#/Blazor）行为一致

#### 编辑器

1. `GoSub` / `On Error ...` 着色正确
2. completion/snippets 能插入 5 类新模板
3. hover 能区分：
   - 关键字 hover
   - handler 过程 hover
4. TS 侧 definition/reference 能从 `GoSub Foo` / `On Error GoSub Foo` 跳到 `Sub Foo`

### 7.2 建议补到哪些现有测试文件

| 测试工程 | 建议补充文件 |
|---|---|
| TS 语言核心 | `packages/smallbasic-lang-core/tests/language-extension.spec.ts` |
| TS 语言服务 | `packages/smallbasic-language-services/tests/service.spec.ts`、`semantic-tokens.spec.ts`、`navigation.spec.ts` |
| VS Code 扩展调试 | `packages/smallbasic-vscode/tests/debug-session.spec.ts`、`browser-debug-session.spec.ts`、`webview-debug-adapter.spec.ts`、`runhost-capabilities.spec.ts`、`snippets.spec.ts` |
| C# 编译器/运行时 | `visual_studio_plugin/tests/SmallBasic.Compiler.Tests/Runtime/LanguageExtensionTests.cs`、`ArithmeticOperatorsTests.cs`、`RunHostRuntimeTests.cs`、`LanguageExtensionConformanceTests.cs` |
| C# 语言服务 | `visual_studio_plugin/tests/SmallBasic.LanguageServices.Tests/LanguageServer/SmallBasicLspAnalysisServiceTests.cs`、`SmallBasicLanguageServerTests.cs` |

### 7.3 现有用例要同步改写

当前有一批测试与文档把“数学错误返回 0/1”写死了，实现时必须整体改：

- `ArithmeticOperatorsTests.cs`
- `packages/smallbasic-lang-core/tests/language-extension.spec.ts`
- `packages/smallbasic-language-services/tests/service.spec.ts` 里 `Mod` / `\` hover 文案
- `README.md` 的“整除与取余”说明
- [06-运行时库与宿主集成.md](../06-运行时库与宿主集成.md) 的值语义表
- [03-整除与取余扩展.md](./03-整除与取余扩展.md) 的当前算术契约

## 8. 建议实施顺序

1. **先冻结语言契约**
   - `GoSub` 是否只支持无参 `Sub`
   - `On Error` 是否采用引擎级策略
   - `GoTo 0` 与 `GoTo -1` 的精确定义
   - 错误码表
2. **先改 TS 语言核心并补测试**
   - TS 改动反馈更快，VS Code/Playground/Web debug 都可立即验证
3. **再改 C# 语言核心与生成链**
   - 特别是 `Libraries.Generated.cs` 的统一错误包装
4. **再接调试器**
   - 先 CLI JS/C#，再 Blazor/browser path
5. **最后补编辑器与文档**
   - grammar / snippets / hover / navigation / README / 设计文档同步

这个顺序的原因是：`On Error` 的真正难点在运行时和调试器，不在 editor。先把“恢复/终止/handler frame”做稳，再补编辑器语义，返工最少。

## 9. 本次仅文档阶段的结论

如果只从工作量与风险来看：

- **`GoSub`**：属于中等偏小改动，主要是 parser/binder/editor 语义补齐；
- **`On Error`**：属于跨编译器、跨运行时、跨调试器、跨文档契约的系统性改动。

真正的根因不是“缺少几个关键字”，而是：

1. 当前三后端并没有共享的“可恢复运行时错误模型”；
2. 当前算术/Math 契约把很多本应报错的情况静默吞掉了；
3. 当前 debugger 把 runtime error 当作 session 结束，而不是语言事件；
4. 当前 editor 只认识显式调用表达式，不认识 `GoSub` / `On Error GoSub` 这种过程引用位置。

所以，后续如果进入实现阶段，建议把它当成一次 **v1.4 语言扩展** 来做，而不是作为零碎语法补丁插入。

## 10. 实施结果（2026-10-07）

v1.4 已按本文契约落地，关键点如下。

### 10.1 语言契约的最终取值

- `GoSub` 只接受无参 `Sub` 的裸标识符目标；目标是 `Function` 或带参 `Sub` 时报 `GoSubTargetMustBeParameterlessSub`，目标不存在时报 `GoSubTargetMustBeSub`。
- `On Error` 为引擎级策略：`Resume Next` 跳过失败语句；`GoTo -1` / `GoTo 0` 都恢复默认的出错即终止并丢弃 handler；`GoSub Handler` 要求 handler 恰好两参（`OnErrorHandlerMustAcceptCodeAndMessage`），handler 返回后从失败语句的下一条继续。
- handler 非重入：handler 执行期间再次出错按未处理错误终止（`isHandlingRuntimeError`）。
- 错误码表与 §1.3 完全一致（`1001/1002/1003/1101/1901/1999`），控制台统一 `[Runtime Error] <code>: <message>`。

### 10.2 运行时模型

- TS：`runtime/runtime-error.ts` 提供 `RuntimeError` / `RuntimeErrorSignal`；`ExecutionEngine` 新增 `errorMode`、`errorHandlerName`、`isHandlingRuntimeError`、`lastRuntimeError`、`pausedOnRuntimeError`，以及语句级回滚点（行号 + evaluation stack 基线）。`GoSub` 直接 lower 为既有 `InvokeSubModuleInstruction`。
- C#：`Runtime/RuntimeError.cs`（`SmallBasicRuntimeException`）与 `Runtime/OnErrorAction.cs`；`SmallBasicEngine` 暴露 `LastError` / `PausedOnRuntimeError` / `ErrorMode` / `ConfigureErrorHandling`，执行循环统一捕获 `SmallBasicRuntimeException`、`DivideByZeroException`、`OverflowException`、`NotSupportedException` 并归一到同一模型。
- `Math` / `Stack` / 算术指令不再把错误折叠为 `0`：除零报 `1001`，非法数学域报 `1002`，非有限结果报 `1003`，空栈 `PopValue` 报 `1101`，文本后端访问图形库报 `1901`。

### 10.3 调试语义

- 未处理错误：先镜像控制台，再以 `stopped(reason="exception")` 保留失败现场（locals/stackTrace 可读），继续后终止；运行模式下直接终止并由宿主镜像 stderr、退出码非 0（JS/C# 为 4，Blazor 浏览器为 1/4）。
- 已处理错误（`Resume Next` / `GoSub`）：只写控制台，不发 `terminated`；handler 是普通调用帧，单步可进入。
- 三条链路都已接入：TS `engine-driver.ts`、C# `DapAdapterBase`、Blazor `BrowserEngineSession`（`BrowserMessage` 复用 `Reason` 字段透传 `exception`，协议无破坏性扩展）。

### 10.4 编辑器

- TS：grammar 新增 `GoSub` 与 `On Error` 上下文规则；semantic tokens 把 `On/Error/Resume/Next` 在子句内标为 keyword、handler 标为 function；completion/hover 支持 5 类新片段与关键字/过程 hover；navigation 从 `GoSub` / `On Error GoSub` 目标跳到 `Sub` 声明。
- C#/VS：`CompletionItemProvider` 与 `HoverProvider` 对齐同 5 类片段与 hover；`SmallBasicSimpleLexer` 增加 `GoSub` 关键字与 `On Error` 行级上下文着色；诊断自动下沉到 LSP。
- 本地化：`Keywords_GoSub` / `Keywords_OnErrorResumeNext` / `Keywords_OnErrorGoToMinus1` / `Keywords_OnErrorGoTo0` / `Keywords_OnErrorGoSub` 已补入两边文档资源。

### 10.5 capability 与宿主

- RunHost 能力集升级为 `["function-v1", "gosub-v1", "error-handling-v1"]`（JS 与 C# 一致），VS Code 侧用 `supportsRequiredCapabilities` 做必需能力拦截。
- JS / C# / Blazor 三个 CLI 宿主行为一致：未处理错误镜像 `[Runtime Error] code: message` 到 stderr 并以非 0 退出。

### 10.6 测试落点

- TS：`language-extension.spec.ts`、`language-extension-conformance.spec.ts`、`debug-session.spec.ts`（exception 停住 / Resume Next 存活 / GoSub handler 两参）、`navigation.spec.ts`、`semantic-tokens.spec.ts`、`runhost-capabilities.spec.ts`、`snippets.spec.ts`。
- C#：`LanguageExtensionTests.cs`（语法诊断、Resume Next、GoSub handler、GoTo 0/-1、handler 非重入、补全与 hover）、`LanguageExtensionConformanceTests.cs`、`ArithmeticOperatorsTests.cs`（hover 文案改写）、`CompletionItemProviderTests.cs`。
- 端到端：`cli-debug-contract.spec.ts` 驱动真实 net8/net48 DAP 适配器验证 capability 握手与未处理错误的 `exception` 停止。
