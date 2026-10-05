# SmallBasic Lang Core

SmallBasic language core workspace package.

当前实现复用并内置 `vendor/SmallBasicOnline` 中的编译器与测试资产，
用于在现代工具链下先拉起语言内核、测试与扩展集成层。

扩展语言同时支持 `Function` / 带参数的 `Sub` / `Dim` / `Return`、`Break` / `Continue`，以及 VB 风格的整除 `\`、取余 `Mod` 和等价方法 `Math.Div` / `Math.Mod`。TypeScript 与 C# 实现通过同一份共享 conformance 语料锁定语义。

