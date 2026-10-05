export { Compilation } from "../../../vendor/SmallBasicOnline/src/compiler/compilation";
export { ExecutionEngine, ExecutionMode, ExecutionState, type StackFrame } from "../../../vendor/SmallBasicOnline/src/compiler/execution-engine";
export { CompletionService } from "../../../vendor/SmallBasicOnline/src/compiler/services/completion-service";
export { HoverService } from "../../../vendor/SmallBasicOnline/src/compiler/services/hover-service";
export { RuntimeLibraries } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/libraries";
export { IGraphicsWindowLibraryPlugin } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/libraries/graphics-window";
export { IShapesLibraryPlugin } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/libraries/shapes";
export { ITextWindowLibraryPlugin, TextWindowColor } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/libraries/text-window";
export { ValueKind, BaseValue } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/values/base-value";
export { ArrayValue } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/values/array-value";
export { NumberValue } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/values/number-value";
export { StringValue } from "../../../vendor/SmallBasicOnline/src/compiler/runtime/values/string-value";
export { Diagnostic, ErrorCode } from "../../../vendor/SmallBasicOnline/src/compiler/utils/diagnostics";
export { CompilerPosition, CompilerRange } from "../../../vendor/SmallBasicOnline/src/compiler/syntax/ranges";
export { TokenKind } from "../../../vendor/SmallBasicOnline/src/compiler/syntax/tokens";
export { SyntaxKind } from "../../../vendor/SmallBasicOnline/src/compiler/syntax/syntax-nodes";
export type {
    BaseSyntaxNode,
    BinaryOperatorExpressionSyntax,
    DimCommandSyntax,
    ForCommandSyntax,
    FunctionDeclarationSyntax,
    IdentifierExpressionSyntax,
    InvocationExpressionSyntax,
    ObjectAccessExpressionSyntax,
    StatementBlockSyntax,
    SubModuleDeclarationSyntax,
    TokenSyntax
} from "../../../vendor/SmallBasicOnline/src/compiler/syntax/syntax-nodes";
export { CompilerUtils } from "../../../vendor/SmallBasicOnline/src/compiler/utils/compiler-utils";
export {
    compileDebugExpression,
    evaluateDebugCondition,
    evaluateDebugExpression,
    type CompiledDebugExpression
} from "./debug-expression";
export { setDocumentationLocale } from "../../../vendor/SmallBasicOnline/src/strings/documentation";
export { resolveDocumentationLocale } from "../../../vendor/SmallBasicOnline/src/strings/locale";
