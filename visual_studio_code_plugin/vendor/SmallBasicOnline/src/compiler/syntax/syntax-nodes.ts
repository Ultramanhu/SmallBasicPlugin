import { CompilerRange } from "./ranges";
import { Token } from "./tokens";

/**
 * Computes the end range of a procedure header (`Sub`/`Function`). The closing
 * parenthesis is optional, so the header may end at the last parameter, or at
 * the procedure name when there is no parameter list at all.
 */
function parameterListEndRange(
    nameToken: TokenSyntax,
    parameterTokens: ReadonlyArray<TokenSyntax>,
    rightParenToken: TokenSyntax | undefined): CompilerRange {
    if (rightParenToken) {
        return rightParenToken.range;
    }

    if (parameterTokens.length) {
        return parameterTokens[parameterTokens.length - 1].range;
    }

    return nameToken.range;
}

export enum SyntaxKind {
    ParseTree,
    SubModuleDeclaration,
    FunctionDeclaration,

    // Statements
    StatementBlock,
    IfHeader,
    IfStatement,
    WhileStatement,
    ForStatement,

    // Commands
    IfCommand,
    ElseCommand,
    ElseIfCommand,
    EndIfCommand,
    ForStepClause,
    ForCommand,
    EndForCommand,
    WhileCommand,
    EndWhileCommand,
    BreakCommand,
    ContinueCommand,
    LabelCommand,
    GoToCommand,
    GoSubCommand,
    OnErrorCommand,
    SubCommand,
    EndSubCommand,
    FunctionCommand,
    EndFunctionCommand,
    DimCommand,
    ReturnCommand,
    ExpressionCommand,
    CommentCommand,

    // Expressions
    UnaryOperatorExpression,
    BinaryOperatorExpression,
    ObjectAccessExpression,
    ArrayAccessExpression,
    Argument,
    InvocationExpression,
    ParenthesisExpression,
    IdentifierExpression,
    NumberLiteralExpression,
    StringLiteralExpression,

    Token
}

export abstract class BaseSyntaxNode {
    private _parentOpt?: BaseSyntaxNode;

    public get parentOpt(): BaseSyntaxNode | undefined {
        return this._parentOpt;
    }

    public set parentOpt(parentOpt: BaseSyntaxNode | undefined) {
        this._parentOpt = parentOpt;
    }

    protected constructor(
        public readonly kind: SyntaxKind,
        public readonly range: CompilerRange) {
    }

    public abstract children(): ReadonlyArray<BaseSyntaxNode>;
}

export class ParseTreeSyntax extends BaseSyntaxNode {
    public constructor(
        public readonly mainModule: StatementBlockSyntax,
        public readonly subModules: ReadonlyArray<SubModuleDeclarationSyntax>,
        public readonly functions: ReadonlyArray<FunctionDeclarationSyntax> = []) {
        // Main statements may legally appear after sub modules, so the ranges
        // must be spanned (min start / max end), not combined in order.
        super(SyntaxKind.ParseTree, CompilerRange.spanning(
            [mainModule.range, ...subModules.map(subModule => subModule.range), ...functions.map(func => func.range)]));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.mainModule, ...this.subModules, ...this.functions];
    }
}

export class FunctionDeclarationSyntax extends BaseSyntaxNode {
    public constructor(
        public readonly functionCommand: FunctionCommandSyntax,
        public readonly statementsList: StatementBlockSyntax,
        public readonly endFunctionCommand: EndFunctionCommandSyntax) {
        super(SyntaxKind.FunctionDeclaration, CompilerRange.combine(functionCommand.range, endFunctionCommand.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.functionCommand, this.statementsList, this.endFunctionCommand];
    }
}

export class SubModuleDeclarationSyntax extends BaseSyntaxNode {
    public constructor(
        public readonly subCommand: SubCommandSyntax,
        public readonly statementsList: StatementBlockSyntax,
        public readonly endSubCommand: EndSubCommandSyntax) {
        super(SyntaxKind.SubModuleDeclaration, CompilerRange.combine(subCommand.range, endSubCommand.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.subCommand, this.statementsList, this.endSubCommand];
    }
}

export abstract class BaseStatementSyntax extends BaseSyntaxNode {
    protected constructor(
        public readonly kind: SyntaxKind,
        public readonly range: CompilerRange) {
        super(kind, range);
    }
}

export class StatementBlockSyntax extends BaseSyntaxNode {
    public constructor(
        public readonly statements: ReadonlyArray<BaseStatementSyntax>) {
        super(SyntaxKind.StatementBlock, statements.length
            ? CompilerRange.combine(statements[0].range, statements[statements.length - 1].range)
            : CompilerRange.fromValues(0, 0, 0, 0));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return this.statements;
    }
}

export class IfHeaderSyntax<THeaderSyntax extends IfCommandSyntax | ElseIfCommandSyntax | ElseCommandSyntax> extends BaseSyntaxNode {
    public constructor(
        public readonly headerCommand: THeaderSyntax,
        public readonly statementsList: StatementBlockSyntax) {
        super(SyntaxKind.IfHeader, CompilerRange.combine(headerCommand.range, statementsList.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.headerCommand, this.statementsList];
    }
}

export class IfStatementSyntax extends BaseStatementSyntax {
    public constructor(
        public readonly ifPart: IfHeaderSyntax<IfCommandSyntax>,
        public readonly elseIfParts: ReadonlyArray<IfHeaderSyntax<ElseIfCommandSyntax>>,
        public readonly elsePartOpt: IfHeaderSyntax<ElseCommandSyntax> | undefined,
        public readonly endIfCommand: EndIfCommandSyntax) {
        super(SyntaxKind.IfStatement, CompilerRange.combine(ifPart.range, endIfCommand.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return this.elsePartOpt
            ? [this.ifPart, ...this.elseIfParts, this.elsePartOpt, this.endIfCommand]
            : [this.ifPart, ...this.elseIfParts, this.endIfCommand];
    }
}

export class WhileStatementSyntax extends BaseStatementSyntax {
    public constructor(
        public readonly whileCommand: WhileCommandSyntax,
        public readonly statementsList: StatementBlockSyntax,
        public readonly endWhileCommand: EndWhileCommandSyntax) {
        super(SyntaxKind.WhileStatement, CompilerRange.combine(whileCommand.range, endWhileCommand.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.whileCommand, this.statementsList, this.endWhileCommand];
    }
}

export class ForStatementSyntax extends BaseStatementSyntax {
    public constructor(
        public readonly forCommand: ForCommandSyntax,
        public readonly statementsList: StatementBlockSyntax,
        public readonly endForCommand: EndForCommandSyntax) {
        super(SyntaxKind.ForStatement, CompilerRange.combine(forCommand.range, endForCommand.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.forCommand, this.statementsList, this.endForCommand];
    }
}

export abstract class BaseCommandSyntax extends BaseSyntaxNode {
    protected constructor(
        public readonly kind: SyntaxKind,
        public readonly range: CompilerRange) {
        super(kind, range);
    }
}

export class IfCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly ifToken: TokenSyntax,
        public readonly expression: BaseExpressionSyntax,
        public readonly thenToken: TokenSyntax) {
        super(SyntaxKind.IfCommand, CompilerRange.combine(ifToken.range, thenToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.ifToken, this.expression, this.thenToken];
    }
}

export class ElseCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly elseToken: TokenSyntax) {
        super(SyntaxKind.ElseCommand, elseToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.elseToken];
    }
}

export class ElseIfCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly elseIfToken: TokenSyntax,
        public readonly expression: BaseExpressionSyntax,
        public readonly thenToken: TokenSyntax) {
        super(SyntaxKind.ElseIfCommand, CompilerRange.combine(elseIfToken.range, thenToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.elseIfToken, this.expression, this.thenToken];
    }
}

export class EndIfCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly endIfToken: TokenSyntax) {
        super(SyntaxKind.EndIfCommand, endIfToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.endIfToken];
    }
}

export class ForStepClauseSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly stepToken: TokenSyntax,
        public readonly expression: BaseExpressionSyntax) {
        super(SyntaxKind.ForStepClause, CompilerRange.combine(stepToken.range, expression.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.stepToken, this.expression];
    }
}

export class ForCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly forToken: TokenSyntax,
        public readonly identifierToken: TokenSyntax,
        public readonly equalToken: TokenSyntax,
        public readonly fromExpression: BaseExpressionSyntax,
        public readonly toToken: TokenSyntax,
        public readonly toExpression: BaseExpressionSyntax,
        public readonly stepClauseOpt?: ForStepClauseSyntax) {
        super(SyntaxKind.ForCommand, CompilerRange.combine(
            forToken.range,
            stepClauseOpt ? stepClauseOpt.expression.range : toExpression.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        const children = [this.forToken, this.identifierToken, this.equalToken, this.fromExpression, this.toToken, this.toExpression];
        if (this.stepClauseOpt) {
            children.push(this.stepClauseOpt);
        }
        return children;
    }
}

export class EndForCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly endForToken: TokenSyntax) {
        super(SyntaxKind.EndForCommand, endForToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.endForToken];
    }
}

export class WhileCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly whileToken: TokenSyntax,
        public readonly expression: BaseExpressionSyntax) {
        super(SyntaxKind.WhileCommand, CompilerRange.combine(whileToken.range, expression.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.whileToken, this.expression];
    }
}

export class EndWhileCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly endWhileToken: TokenSyntax) {
        super(SyntaxKind.EndWhileCommand, endWhileToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.endWhileToken];
    }
}

export class BreakCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly breakToken: TokenSyntax) {
        super(SyntaxKind.BreakCommand, breakToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.breakToken];
    }
}

export class ContinueCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly continueToken: TokenSyntax) {
        super(SyntaxKind.ContinueCommand, continueToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.continueToken];
    }
}

export class LabelCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly labelToken: TokenSyntax,
        public readonly colonToken: TokenSyntax) {
        super(SyntaxKind.LabelCommand, CompilerRange.combine(labelToken.range, colonToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.labelToken, this.colonToken];
    }
}

export class GoToCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly goToToken: TokenSyntax,
        public readonly labelToken: TokenSyntax) {
        super(SyntaxKind.GoToCommand, CompilerRange.combine(goToToken.range, labelToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.goToToken, this.labelToken];
    }
}

/**
 * A `GoSub Handler` statement: an explicit keyword-form call of a
 * parameterless Sub. The target is a bare identifier token, not an
 * invocation expression, so editors must resolve it separately.
 */
export class GoSubCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly goSubToken: TokenSyntax,
        public readonly nameToken: TokenSyntax) {
        super(SyntaxKind.GoSubCommand, CompilerRange.combine(goSubToken.range, nameToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.goSubToken, this.nameToken];
    }
}

export type OnErrorAction = "resume-next" | "goto-default" | "goto-clear" | "gosub";

/**
 * An `On Error ...` statement. `On`/`Error`/`Resume`/`Next` are contextual
 * keywords (plain Identifier tokens); only the tokens actually consumed by
 * the clause are kept for coloring and hover.
 */
export class OnErrorCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly onToken: TokenSyntax,
        public readonly errorToken: TokenSyntax,
        public readonly action: OnErrorAction,
        public readonly clauseTokens: ReadonlyArray<TokenSyntax>,
        public readonly targetToken: TokenSyntax | undefined) {
        const lastToken = targetToken ?? clauseTokens[clauseTokens.length - 1] ?? errorToken;
        super(SyntaxKind.OnErrorCommand, CompilerRange.combine(onToken.range, lastToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.onToken, this.errorToken, ...this.clauseTokens, ...(this.targetToken ? [this.targetToken] : [])];
    }
}

export class SubCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly subToken: TokenSyntax,
        public readonly nameToken: TokenSyntax,
        public readonly leftParenToken: TokenSyntax | undefined,
        public readonly parameterTokens: ReadonlyArray<TokenSyntax>,
        public readonly commaTokens: ReadonlyArray<TokenSyntax>,
        public readonly rightParenToken: TokenSyntax | undefined) {
        super(SyntaxKind.SubCommand, CompilerRange.combine(
            subToken.range,
            parameterListEndRange(nameToken, parameterTokens, rightParenToken)));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        const children: BaseSyntaxNode[] = [this.subToken, this.nameToken];
        if (this.leftParenToken) {
            children.push(this.leftParenToken);
        }
        this.parameterTokens.forEach((parameter, index) => {
            children.push(parameter);
            if (index < this.commaTokens.length) {
                children.push(this.commaTokens[index]);
            }
        });
        if (this.rightParenToken) {
            children.push(this.rightParenToken);
        }
        return children;
    }
}

export class EndSubCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly endSubToken: TokenSyntax) {
        super(SyntaxKind.EndSubCommand, endSubToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.endSubToken];
    }
}

export class FunctionCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly functionToken: TokenSyntax,
        public readonly nameToken: TokenSyntax,
        public readonly leftParenToken: TokenSyntax | undefined,
        public readonly parameterTokens: ReadonlyArray<TokenSyntax>,
        public readonly commaTokens: ReadonlyArray<TokenSyntax>,
        public readonly rightParenToken: TokenSyntax | undefined) {
        super(SyntaxKind.FunctionCommand, CompilerRange.combine(
            functionToken.range,
            parameterListEndRange(nameToken, parameterTokens, rightParenToken)));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        const children: BaseSyntaxNode[] = [this.functionToken, this.nameToken];
        if (this.leftParenToken) {
            children.push(this.leftParenToken);
        }
        this.parameterTokens.forEach((parameter, index) => {
            children.push(parameter);
            if (index < this.commaTokens.length) {
                children.push(this.commaTokens[index]);
            }
        });
        if (this.rightParenToken) {
            children.push(this.rightParenToken);
        }
        return children;
    }
}

export class EndFunctionCommandSyntax extends BaseCommandSyntax {
    public constructor(public readonly endFunctionToken: TokenSyntax) {
        super(SyntaxKind.EndFunctionCommand, endFunctionToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.endFunctionToken];
    }
}

export class DimCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly dimToken: TokenSyntax,
        public readonly variableTokens: ReadonlyArray<TokenSyntax>,
        public readonly commaTokens: ReadonlyArray<TokenSyntax>) {
        super(SyntaxKind.DimCommand, variableTokens.length
            ? CompilerRange.combine(dimToken.range, variableTokens[variableTokens.length - 1].range)
            : dimToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        const children: BaseSyntaxNode[] = [this.dimToken];
        this.variableTokens.forEach((variable, index) => {
            children.push(variable);
            if (index < this.commaTokens.length) {
                children.push(this.commaTokens[index]);
            }
        });
        return children;
    }
}

export class ReturnCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly returnToken: TokenSyntax,
        public readonly expression: BaseExpressionSyntax) {
        super(SyntaxKind.ReturnCommand, CompilerRange.combine(returnToken.range, expression.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.returnToken, this.expression];
    }
}

export class ExpressionCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly expression: BaseExpressionSyntax) {
        super(SyntaxKind.ExpressionCommand, expression.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.expression];
    }
}

export class CommentCommandSyntax extends BaseCommandSyntax {
    public constructor(
        public readonly commentToken: TokenSyntax) {
        super(SyntaxKind.CommentCommand, commentToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.commentToken];
    }
}

export class MissingCommandSyntax extends BaseCommandSyntax {
    public constructor(
        expectedKind: SyntaxKind,
        expectedRange: CompilerRange) {
        super(expectedKind, expectedRange);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [];
    }
}

export abstract class BaseExpressionSyntax extends BaseSyntaxNode {
    protected constructor(
        public readonly kind: SyntaxKind,
        public readonly range: CompilerRange) {
        super(kind, range);
    }
}

export class UnaryOperatorExpressionSyntax extends BaseExpressionSyntax {
    public constructor(
        public readonly operatorToken: TokenSyntax,
        public readonly expression: BaseExpressionSyntax) {
        super(SyntaxKind.UnaryOperatorExpression, CompilerRange.combine(operatorToken.range, expression.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.operatorToken, this.expression];
    }
}

export class BinaryOperatorExpressionSyntax extends BaseExpressionSyntax {
    public constructor(
        public readonly leftExpression: BaseExpressionSyntax,
        public readonly operatorToken: TokenSyntax,
        public readonly rightExpression: BaseExpressionSyntax) {
        super(SyntaxKind.BinaryOperatorExpression, CompilerRange.combine(leftExpression.range, rightExpression.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.leftExpression, this.operatorToken, this.rightExpression];
    }
}

export class ObjectAccessExpressionSyntax extends BaseExpressionSyntax {
    public constructor(
        public readonly baseExpression: BaseExpressionSyntax,
        public readonly dotToken: TokenSyntax,
        public readonly identifierToken: TokenSyntax) {
        super(SyntaxKind.ObjectAccessExpression, CompilerRange.combine(baseExpression.range, identifierToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.baseExpression, this.dotToken, this.identifierToken];
    }
}

export class ArrayAccessExpressionSyntax extends BaseExpressionSyntax {
    public constructor(
        public readonly baseExpression: BaseExpressionSyntax,
        public readonly leftBracketToken: TokenSyntax,
        public readonly indexExpression: BaseExpressionSyntax,
        public readonly rightBracketToken: TokenSyntax) {
        super(SyntaxKind.ArrayAccessExpression, CompilerRange.combine(baseExpression.range, rightBracketToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.baseExpression, this.leftBracketToken, this.indexExpression, this.rightBracketToken];
    }
}

export class ArgumentSyntax extends BaseSyntaxNode {
    public constructor(
        public readonly expression: BaseExpressionSyntax,
        public readonly commaOpt?: TokenSyntax) {
        super(SyntaxKind.Argument, commaOpt ? CompilerRange.combine(expression.range, commaOpt.range) : expression.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return this.commaOpt ? [this.expression, this.commaOpt] : [this.expression];
    }
}

export class InvocationExpressionSyntax extends BaseExpressionSyntax {
    public constructor(
        public readonly baseExpression: BaseExpressionSyntax,
        public readonly leftParenToken: TokenSyntax,
        public readonly argumentsList: ReadonlyArray<ArgumentSyntax>,
        public readonly rightParenToken: TokenSyntax) {
        super(SyntaxKind.InvocationExpression, CompilerRange.combine(baseExpression.range, rightParenToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.baseExpression, this.leftParenToken, ...this.argumentsList, this.rightParenToken];
    }
}

export class ParenthesisExpressionSyntax extends BaseExpressionSyntax {
    public constructor(
        public readonly leftParenToken: TokenSyntax,
        public readonly expression: BaseExpressionSyntax,
        public readonly rightParenToken: TokenSyntax) {
        super(SyntaxKind.ParenthesisExpression, CompilerRange.combine(leftParenToken.range, rightParenToken.range));
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.leftParenToken, this.expression, this.rightParenToken];
    }
}

export class IdentifierExpressionSyntax extends BaseExpressionSyntax {
    public constructor(
        public readonly identifierToken: TokenSyntax) {
        super(SyntaxKind.IdentifierExpression, identifierToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.identifierToken];
    }
}

export class StringLiteralExpressionSyntax extends BaseExpressionSyntax {
    public constructor(
        public readonly stringToken: TokenSyntax) {
        super(SyntaxKind.StringLiteralExpression, stringToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.stringToken];

    }
}

export class NumberLiteralExpressionSyntax extends BaseExpressionSyntax {
    public constructor(
        public readonly numberToken: TokenSyntax) {
        super(SyntaxKind.NumberLiteralExpression, numberToken.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [this.numberToken];
    }
}

export class TokenSyntax extends BaseSyntaxNode {
    public constructor(
        public readonly token: Token) {
        super(SyntaxKind.Token, token.range);
    }

    public children(): ReadonlyArray<BaseSyntaxNode> {
        return [];
    }
}

export class SyntaxNodeVisitor {
    public visit(node: BaseSyntaxNode): void {
        switch (node.kind) {
            case SyntaxKind.ParseTree: this.visitParseTree(node as ParseTreeSyntax); break;
            case SyntaxKind.SubModuleDeclaration: this.visitSubModuleDeclaration(node as SubModuleDeclarationSyntax); break;
            case SyntaxKind.FunctionDeclaration: this.visitFunctionDeclaration(node as FunctionDeclarationSyntax); break;
            case SyntaxKind.StatementBlock: this.visitStatementBlock(node as StatementBlockSyntax); break;
            case SyntaxKind.IfHeader: this.visitIfHeader(node as IfHeaderSyntax<IfCommandSyntax | ElseIfCommandSyntax | ElseCommandSyntax>); break;
            case SyntaxKind.IfStatement: this.visitIfStatement(node as IfStatementSyntax); break;
            case SyntaxKind.WhileStatement: this.visitWhileStatement(node as WhileStatementSyntax); break;
            case SyntaxKind.ForStatement: this.visitForStatement(node as ForStatementSyntax); break;
            case SyntaxKind.IfCommand: this.visitIfCommand(node as IfCommandSyntax); break;
            case SyntaxKind.ElseCommand: this.visitElseCommand(node as ElseCommandSyntax); break;
            case SyntaxKind.ElseIfCommand: this.visitElseIfCommand(node as ElseIfCommandSyntax); break;
            case SyntaxKind.EndIfCommand: this.visitEndIfCommand(node as EndIfCommandSyntax); break;
            case SyntaxKind.ForStepClause: this.visitForStepClause(node as ForStepClauseSyntax); break;
            case SyntaxKind.ForCommand: this.visitForCommand(node as ForCommandSyntax); break;
            case SyntaxKind.EndForCommand: this.visitEndForCommand(node as EndForCommandSyntax); break;
            case SyntaxKind.WhileCommand: this.visitWhileCommand(node as WhileCommandSyntax); break;
            case SyntaxKind.EndWhileCommand: this.visitEndWhileCommand(node as EndWhileCommandSyntax); break;
            case SyntaxKind.BreakCommand: this.visitBreakCommand(node as BreakCommandSyntax); break;
            case SyntaxKind.ContinueCommand: this.visitContinueCommand(node as ContinueCommandSyntax); break;
            case SyntaxKind.LabelCommand: this.visitLabelCommand(node as LabelCommandSyntax); break;
            case SyntaxKind.GoToCommand: this.visitGoToCommand(node as GoToCommandSyntax); break;
            case SyntaxKind.GoSubCommand: this.visitGoSubCommand(node as GoSubCommandSyntax); break;
            case SyntaxKind.OnErrorCommand: this.visitOnErrorCommand(node as OnErrorCommandSyntax); break;
            case SyntaxKind.SubCommand: this.visitSubCommand(node as SubCommandSyntax); break;
            case SyntaxKind.EndSubCommand: this.visitEndSubCommand(node as EndSubCommandSyntax); break;
            case SyntaxKind.FunctionCommand: this.visitFunctionCommand(node as FunctionCommandSyntax); break;
            case SyntaxKind.EndFunctionCommand: this.visitEndFunctionCommand(node as EndFunctionCommandSyntax); break;
            case SyntaxKind.DimCommand: this.visitDimCommand(node as DimCommandSyntax); break;
            case SyntaxKind.ReturnCommand: this.visitReturnCommand(node as ReturnCommandSyntax); break;
            case SyntaxKind.ExpressionCommand: this.visitExpressionCommand(node as ExpressionCommandSyntax); break;
            case SyntaxKind.CommentCommand: this.visitCommentCommand(node as CommentCommandSyntax); break;
            case SyntaxKind.UnaryOperatorExpression: this.visitUnaryOperatorExpression(node as UnaryOperatorExpressionSyntax); break;
            case SyntaxKind.BinaryOperatorExpression: this.visitBinaryOperatorExpression(node as BinaryOperatorExpressionSyntax); break;
            case SyntaxKind.ObjectAccessExpression: this.visitObjectAccessExpression(node as ObjectAccessExpressionSyntax); break;
            case SyntaxKind.ArrayAccessExpression: this.visitArrayAccessExpression(node as ArrayAccessExpressionSyntax); break;
            case SyntaxKind.Argument: this.visitArgument(node as ArgumentSyntax); break;
            case SyntaxKind.InvocationExpression: this.visitInvocationExpression(node as InvocationExpressionSyntax); break;
            case SyntaxKind.ParenthesisExpression: this.visitParenthesisExpression(node as ParenthesisExpressionSyntax); break;
            case SyntaxKind.IdentifierExpression: this.visitIdentifierExpression(node as IdentifierExpressionSyntax); break;
            case SyntaxKind.NumberLiteralExpression: this.visitNumberLiteralExpression(node as NumberLiteralExpressionSyntax); break;
            case SyntaxKind.StringLiteralExpression: this.visitStringLiteralExpression(node as StringLiteralExpressionSyntax); break;
            case SyntaxKind.Token: this.visitToken(node as TokenSyntax); break;
            default: throw new Error(`Unexpected syntax kind: '${SyntaxKind[node.kind]}'`);
        }
    }

    public visitParseTree(node: ParseTreeSyntax): void {
        this.defaultVisit(node);
    }

    public visitSubModuleDeclaration(node: SubModuleDeclarationSyntax): void {
        this.defaultVisit(node);
    }

    public visitFunctionDeclaration(node: FunctionDeclarationSyntax): void {
        this.defaultVisit(node);
    }

    public visitStatementBlock(node: StatementBlockSyntax): void {
        this.defaultVisit(node);
    }

    public visitIfHeader(node: IfHeaderSyntax<IfCommandSyntax | ElseIfCommandSyntax | ElseCommandSyntax>): void {
        this.defaultVisit(node);
    }

    public visitIfStatement(node: IfStatementSyntax): void {
        this.defaultVisit(node);
    }

    public visitWhileStatement(node: WhileStatementSyntax): void {
        this.defaultVisit(node);
    }

    public visitForStatement(node: ForStatementSyntax): void {
        this.defaultVisit(node);
    }

    public visitIfCommand(node: IfCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitElseCommand(node: ElseCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitElseIfCommand(node: ElseIfCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitEndIfCommand(node: EndIfCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitForStepClause(node: ForStepClauseSyntax): void {
        this.defaultVisit(node);
    }

    public visitForCommand(node: ForCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitEndForCommand(node: EndForCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitWhileCommand(node: WhileCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitEndWhileCommand(node: EndWhileCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitBreakCommand(node: BreakCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitContinueCommand(node: ContinueCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitLabelCommand(node: LabelCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitGoToCommand(node: GoToCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitGoSubCommand(node: GoSubCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitOnErrorCommand(node: OnErrorCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitSubCommand(node: SubCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitEndSubCommand(node: EndSubCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitFunctionCommand(node: FunctionCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitEndFunctionCommand(node: EndFunctionCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitDimCommand(node: DimCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitReturnCommand(node: ReturnCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitExpressionCommand(node: ExpressionCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitCommentCommand(node: CommentCommandSyntax): void {
        this.defaultVisit(node);
    }

    public visitUnaryOperatorExpression(node: UnaryOperatorExpressionSyntax): void {
        this.defaultVisit(node);
    }

    public visitBinaryOperatorExpression(node: BinaryOperatorExpressionSyntax): void {
        this.defaultVisit(node);
    }

    public visitObjectAccessExpression(node: ObjectAccessExpressionSyntax): void {
        this.defaultVisit(node);
    }

    public visitArrayAccessExpression(node: ArrayAccessExpressionSyntax): void {
        this.defaultVisit(node);
    }

    public visitArgument(node: ArgumentSyntax): void {
        this.defaultVisit(node);
    }

    public visitInvocationExpression(node: InvocationExpressionSyntax): void {
        this.defaultVisit(node);
    }

    public visitParenthesisExpression(node: ParenthesisExpressionSyntax): void {
        this.defaultVisit(node);
    }

    public visitIdentifierExpression(node: IdentifierExpressionSyntax): void {
        this.defaultVisit(node);
    }

    public visitNumberLiteralExpression(node: NumberLiteralExpressionSyntax): void {
        this.defaultVisit(node);
    }

    public visitStringLiteralExpression(node: StringLiteralExpressionSyntax): void {
        this.defaultVisit(node);
    }

    public visitToken(node: TokenSyntax): void {
        this.defaultVisit(node);
    }

    private defaultVisit(node: BaseSyntaxNode): void {
        node.children().forEach(child => this.visit(child));
    }
}
