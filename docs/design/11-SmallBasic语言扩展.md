# 11 SmallBasic 语言扩展总览：通用要求与分册结构

> 更新时间：2026-10-07
> 状态：v1 / v1.1 / v1.2 / v1.3 / v1.4 已实施
> 适用范围：C# / TypeScript 双语言核心，JavaScript / C# / Blazor 三种运行与调试后端，Visual Studio / VS Code / Monaco Playground 三类编辑表面

## 0. 结论先行

Small Basic 语言扩展已经不再是“一份文档描述所有特性”的规模。当前仓库中的扩展能力跨越：

- 两套编译器（C# / TypeScript）
- 三种运行与调试后端（JavaScript / C# / Blazor）
- 三类编辑表面（VS Code / Visual Studio / Monaco Playground）

因此，本页只保留**通用要求、统一结构、共同验收口径与分册索引**；各功能点的语义细节、文件级改动与测试分析，统一拆分到 [extends/](./extends/README.md) 目录。

## 1. 分册组织方式

### 1.1 分册索引

| 功能点 | 文档 | 状态 |
|---|---|---|
| 过程、参数、局部作用域、`Return` | [extends/01-过程与作用域扩展.md](./extends/01-过程与作用域扩展.md) | 已实施 |
| `Break` / `Continue` | [extends/02-循环控制扩展.md](./extends/02-循环控制扩展.md) | 已实施 |
| `\` / `Mod` / `Math.Div` / `Math.Mod` | [extends/03-整除与取余扩展.md](./extends/03-整除与取余扩展.md) | 已实施 |
| `GoSub` / `On Error` | [extends/04-GoSub与OnError错误处理.md](./extends/04-GoSub与OnError错误处理.md) | 已实施 |

完整索引见 [extends/README.md](./extends/README.md)。

### 1.2 适用边界

所有语言扩展分册默认适用于：

- `visual_studio_code_plugin/vendor/SmallBasicOnline`
- `visual_studio_plugin/vendor/SmallBasicEditor/Source/SmallBasic.Compiler`
- `smallbasic-lang-core` / `smallbasic-language-services`
- `SmallBasic.LanguageServices`
- VS Code / Visual Studio / Playground 的编辑器适配层
- JS / C# / Blazor 的运行与调试宿主

也就是说，任何语言扩展都不能只在单一编译器或单一后端上定义语义。

## 2. 通用目标与非目标

### 2.1 通用目标

1. **双编译器语义一致**：C# 与 TypeScript 必须遵守同一份语言契约。
2. **三后端行为一致**：JavaScript、C#、Blazor 运行/调试链路不能在同一语法上出现语义漂移。
3. **调试器与编辑器一并演进**：新语法不是只改 parser/VM，必须同步覆盖断点、单步、变量、着色、补全、hover、诊断等表面。
4. **可测试、可握手、可发布**：新增能力应具备针对性的测试面与 capability 声明，避免“编辑器接受新语法，但外部旧宿主不支持”。

### 2.2 非目标

- 不通过跨语言桥接把某一端的语义实现“外包”给另一端
- 不把编辑器正则/词法兜底当作语义真相源
- 不让某项扩展只在某个 IDE 表面可用、在另一表面退化为未定义行为

## 3. 共享基线与统一结构

### 3.1 仓库现实基线

语言扩展工作不是改一个项目，而是同时影响多层：

| 层 | TypeScript / JavaScript 侧 | C# / .NET 侧 |
|---|---|---|
| 语言核心 | `visual_studio_code_plugin/vendor/SmallBasicOnline/src/compiler` | `visual_studio_plugin/vendor/SmallBasicEditor/Source/SmallBasic.Compiler` |
| 共享服务 | `smallbasic-lang-core`、`smallbasic-language-services` | `SmallBasic.LanguageServices` |
| 运行 | Node / 浏览器中的 `ExecutionEngine` | `SmallBasic.RunHost` 与 Blazor WASM 中的 `SmallBasicEngine` |
| 调试 | VS Code 内嵌 TS DAP、Web Inline DAP | `SmallBasic.RunHost` DAP、`SmallBasic.Blazor.RunHost` DAP |
| 编辑器 | VS Code Provider + Monaco Worker | VS 内置 LSP + MEF 分类/折叠/导航栏兼容层 |

### 3.2 统一实施结构

每个功能点分册都应尽量按下面的固定结构书写：

1. 功能范围
2. 语言契约
3. 编译器与运行时实现
4. 调试器影响
5. 编辑器与语言服务影响
6. capability / 测试 / 实施状态

这样做的目的，是让新增语言能力在“语义 → 编译器 → VM → 调试 → 编辑器 → 测试”这条链上可被完整审视，而不是停留在某个局部实现。

## 4. 通用设计要求

### 4.1 语言契约先于实现

任何新增语法，必须先冻结：

- 合法/非法语法边界
- 与既有 Small Basic 语义的兼容方式
- 诊断与错误提示
- 调试器可观察行为
- 编辑器表面最低支持要求

### 4.2 C# 与 TypeScript 必须同构实现

允许实现细节不同，但以下几类抽象必须等价：

- Token / Syntax / Bound 节点
- 过程、局部、全局等符号模型
- VM 调用帧与变量可见性
- 可执行行与断点吸附规则
- 用户可见的运行时结果与错误格式

### 4.3 三后端一致性优先于单后端便利性

新增语言扩展时，默认验收单位是：

```text
同一份 .sb 程序
  在 JavaScript / C# / Blazor 三后端上
  编译、运行、调试、编辑器语义都保持一致
```

若某功能暂时无法在某后端支持，必须通过：

- capability 握手
- 明确错误提示
- 文档限制说明

来显式暴露，而不是静默降级。

### 4.4 调试器必须视新语法为一等公民

新增语言结构时，至少要回答：

- 是否形成新的调用帧？
- 是否引入新的可执行行？
- `stepIn` / `next` / `stepOut` 的可见行为是什么？
- 条件断点 / Watch / Debug Console 如何读到新增语义中的变量或结果？
- 浏览器协议 / DAP 是否需要扩字段或扩 capability？

### 4.5 编辑器与语言服务必须同步升级

新增语法后，至少要同步评估：

- 词法着色与语义令牌
- completion / snippets
- hover / signature help
- diagnostics
- outline / document symbols / navigation
- definition / references（若目标是符号）

### 4.6 capability 与版本握手

外部宿主（尤其 VS Code 调用 C# RunHost）上的语言扩展，应通过：

- `protocolVersion`
- `capabilities[]`

声明支持面。原则上：

- 已发布能力不要 silently break
- 新能力优先新增 capability，而不是复用旧 capability 语义
- 编辑器在运行/调试前应显式拦截能力不足的宿主

### 4.7 生成源与文档同步

若扩展触及 C# 生成代码链（如 TokenKind、SyntaxNodes、Diagnostics、Libraries 包装），则：

- XML/生成模板必须是真相源
- 生成产物必须可再生
- 文档必须说明“改哪里”与“哪些 generated files 会变化”

## 5. 通用测试与质量门禁

### 5.1 一致性测试

推荐把共享语义样例沉淀到双编译器共读的语料中，保证：

- 同一输入程序
- 同一输出/诊断/行为预期
- TS 与 C# 两套 runner 同时回归

### 5.2 最小测试面

每个功能点至少需要覆盖：

1. **语言核心**
   - 语法
   - 绑定
   - 运行时
2. **调试**
   - 断点
   - 单步
   - 变量/调用栈/求值
3. **编辑器**
   - 着色
   - 补全 / hover / diagnostics
   - 必要时的导航与符号服务

### 5.3 门禁原则

- 优先跑改动直接相关的最小测试集
- capability 或协议变更必须补对应单测
- 文档若更新了语义契约，测试也必须同步更新

## 6. 维护约定

1. **顶层 11 文档只保留通用要求与结构**，不再承载某个功能点的具体实现细节。
2. **功能点新增/拆分时优先修改 `extends/` 分册**，只有跨功能、跨版本的公共约束才回写本页。
3. **README 与 `docs/design/README.md` 只链接总览与分册索引**，避免把具体逻辑散落到多个入口。
4. **未实施提案与已落地能力必须分开标注**，避免读者把设计稿误读成现状。
