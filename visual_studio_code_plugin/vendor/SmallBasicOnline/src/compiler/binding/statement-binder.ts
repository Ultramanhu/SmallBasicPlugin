import { RuntimeLibraries } from "../runtime/libraries";
import { ExpressionBinder } from "./expression-binder";
import { ErrorCode, Diagnostic } from "../utils/diagnostics";
import { BaseBoundStatement, BoundArrayAccessExpression, BaseBoundExpression, BoundKind, BoundEqualExpression, BoundLibraryEventExpression, BoundLibraryMethodInvocationExpression, BoundLibraryPropertyExpression, BoundSubModuleExpression, BoundSubModuleInvocationExpression, BoundVariableExpression, BoundForStatement, BoundIfStatement, BoundWhileStatement, BoundLabelStatement, BoundGoToStatement, BoundReturnStatement, BoundInvalidExpressionStatement, BoundVariableAssignmentStatement, BoundArrayAssignmentStatement, BoundPropertyAssignmentStatement, BoundEventAssignmentStatement, BoundLibraryMethodInvocationStatement, BoundSubModuleInvocationStatement, BoundIfHeaderStatement, BoundStatementBlock } from "./bound-nodes";
import { GoToCommandSyntax, BaseSyntaxNode, SyntaxKind, ForStatementSyntax, IfStatementSyntax, WhileStatementSyntax, LabelCommandSyntax, ExpressionCommandSyntax, ReturnCommandSyntax, DimCommandSyntax, BaseStatementSyntax, StatementBlockSyntax } from "../syntax/syntax-nodes";
import type { ProcedureSymbol } from "./modules-binder";

export class StatementBinder {
    private _definedLabels: { [name: string]: boolean } = {};
    private _goToStatements: GoToCommandSyntax[] = [];
    private _declaredNames: { [name: string]: string } = {};
    private _declarations: string[] = [];
    private _locals: string[] = [];

    public readonly result: BoundStatementBlock;

    public get locals(): ReadonlyArray<string> {
        return this._locals;
    }

    public get declarations(): ReadonlyArray<string> {
        return this._declarations;
    }

    public constructor(
        statements: StatementBlockSyntax,
        private _definedProcedures: { readonly [name: string]: ProcedureSymbol },
        private readonly _diagnostics: Diagnostic[],
        parameters: ReadonlyArray<string> = [],
        private readonly _returnsValue: boolean = false,
        private readonly _localsAreLocal: boolean = true) {
        parameters.forEach(parameter => this._declaredNames[parameter.toLowerCase()] = parameter);
        this.collectLocalDeclarations(statements);
        this.result = this.bindStatementsBlock(statements, true);

        this._goToStatements.forEach(statement => {
            const identifier = statement.labelToken;
            if (!this._definedLabels[identifier.token.text]) {
                this._diagnostics.push(new Diagnostic(ErrorCode.LabelDoesNotExist, identifier.range, identifier.token.text));
            }
        });
    }

    private collectLocalDeclarations(block: StatementBlockSyntax): void {
        block.statements.forEach(statement => {
            if (statement.kind !== SyntaxKind.DimCommand) {
                return;
            }

            const dim = statement as unknown as DimCommandSyntax;
            dim.variableTokens.forEach(variable => {
                const name = variable.token.text;
                const key = name.toLowerCase();
                if (this._declaredNames[key]) {
                    this._diagnostics.push(new Diagnostic(ErrorCode.DuplicateLocalVariable, variable.range, name));
                } else {
                    this._declaredNames[key] = name;
                    this._declarations.push(name);
                    if (this._localsAreLocal) {
                        this._locals.push(name);
                    }
                }
            });
        });
    }

    private bindStatementsBlock(block: StatementBlockSyntax, allowDim: boolean = false): BoundStatementBlock {
        const result: BaseBoundStatement[] = [];

        block.statements.forEach(statement => {
            if (statement.kind === SyntaxKind.CommentCommand) {
                return;
            }

            if (statement.kind === SyntaxKind.DimCommand) {
                if (!allowDim) {
                    this._diagnostics.push(new Diagnostic(ErrorCode.DimMustBeAtProcedureLevel, statement.range));
                }
                return;
            }

            result.push(this.bindStatement(statement));
        });

        return new BoundStatementBlock(result, block);
    }

    private bindStatement(syntax: BaseStatementSyntax): BaseBoundStatement {
        switch (syntax.kind) {
            case SyntaxKind.ForStatement: return this.bindForStatement(syntax as ForStatementSyntax);
            case SyntaxKind.IfStatement: return this.bindIfStatement(syntax as IfStatementSyntax);
            case SyntaxKind.WhileStatement: return this.bindWhileStatement(syntax as WhileStatementSyntax);
            case SyntaxKind.LabelCommand: return this.bindLabelStatement(syntax as LabelCommandSyntax);
            case SyntaxKind.GoToCommand: return this.bindGoToStatement(syntax as GoToCommandSyntax);
            case SyntaxKind.ReturnCommand: return this.bindReturnStatement(syntax as unknown as ReturnCommandSyntax);
            case SyntaxKind.ExpressionCommand: return this.bindExpressionStatement(syntax as ExpressionCommandSyntax);
            default: throw new Error(`Unexpected statement of kind ${SyntaxKind[syntax.kind]} here`);
        }
    }

    private bindForStatement(syntax: ForStatementSyntax): BoundForStatement {
        const identifier = syntax.forCommand.identifierToken.token.text;

        const fromExpression = this.bindExpression(syntax.forCommand.fromExpression, true);
        const toExpression = this.bindExpression(syntax.forCommand.toExpression, true);

        let stepExpression: BaseBoundExpression | undefined;
        if (syntax.forCommand.stepClauseOpt) {
            stepExpression = this.bindExpression(syntax.forCommand.stepClauseOpt.expression, true);
        }

        const statementsList = this.bindStatementsBlock(syntax.statementsList);

        return new BoundForStatement(identifier, fromExpression, toExpression, stepExpression, statementsList, syntax);
    }

    private bindIfStatement(syntax: IfStatementSyntax): BoundIfStatement {
        const ifPart = new BoundIfHeaderStatement(
            this.bindExpression(syntax.ifPart.headerCommand.expression, true),
            this.bindStatementsBlock(syntax.ifPart.statementsList),
            syntax.ifPart);

        const elseIfParts = syntax.elseIfParts.map(elseIfPart => {
            return new BoundIfHeaderStatement(
                this.bindExpression(elseIfPart.headerCommand.expression, true),
                this.bindStatementsBlock(elseIfPart.statementsList),
                elseIfPart);
        });

        let elsePart: BoundStatementBlock | undefined;
        if (syntax.elsePartOpt) {
            elsePart = this.bindStatementsBlock(syntax.elsePartOpt.statementsList);
        }

        return new BoundIfStatement(ifPart, elseIfParts, elsePart, syntax);
    }

    private bindWhileStatement(syntax: WhileStatementSyntax): BoundWhileStatement {
        const condition = this.bindExpression(syntax.whileCommand.expression, true);
        const statementsList = this.bindStatementsBlock(syntax.statementsList);

        return new BoundWhileStatement(condition, statementsList, syntax);
    }

    private bindLabelStatement(syntax: LabelCommandSyntax): BoundLabelStatement {
        const labelName = syntax.labelToken.token.text;
        this._definedLabels[labelName] = true;

        return new BoundLabelStatement(labelName, syntax);
    }

    private bindGoToStatement(syntax: GoToCommandSyntax): BoundGoToStatement {
        this._goToStatements.push(syntax);

        return new BoundGoToStatement(syntax.labelToken.token.text, syntax);
    }

    private bindReturnStatement(syntax: ReturnCommandSyntax): BoundReturnStatement {
        const expression = this.bindExpression(syntax.expression, true);
        if (!this._returnsValue) {
            this._diagnostics.push(new Diagnostic(ErrorCode.ReturnOutsideFunction, syntax.range));
        }

        return new BoundReturnStatement(expression, syntax);
    }

    private bindExpressionStatement(syntax: ExpressionCommandSyntax): BaseBoundStatement {
        const expression = this.bindExpression(syntax.expression, false);

        if (expression.hasErrors) {
            return new BoundInvalidExpressionStatement(expression, syntax);
        }

        switch (expression.kind) {
            case BoundKind.EqualExpression: {
                const binaryExpression = expression as BoundEqualExpression;

                switch (binaryExpression.leftExpression.kind) {
                    case BoundKind.VariableExpression: {
                        const variable = binaryExpression.leftExpression as BoundVariableExpression;
                        return new BoundVariableAssignmentStatement(variable.variableName, binaryExpression.rightExpression, syntax);
                    }

                    case BoundKind.ArrayAccessExpression: {
                        const array = binaryExpression.leftExpression as BoundArrayAccessExpression;
                        return new BoundArrayAssignmentStatement(array.arrayName, array.indices, binaryExpression.rightExpression, syntax);
                    }

                    case BoundKind.LibraryPropertyExpression: {
                        const property = binaryExpression.leftExpression as BoundLibraryPropertyExpression;

                        if (!RuntimeLibraries.Metadata[property.libraryName].properties[property.propertyName].hasSetter) {
                            this._diagnostics.push(new Diagnostic(ErrorCode.PropertyHasNoSetter, property.syntax.range));
                        }

                        return new BoundPropertyAssignmentStatement(property.libraryName, property.propertyName, binaryExpression.rightExpression, syntax);
                    }

                    case BoundKind.LibraryEventExpression: {
                        const eventExpression = binaryExpression.leftExpression as BoundLibraryEventExpression;

                        if (binaryExpression.rightExpression.kind === BoundKind.SubModuleExpression) {
                            const subModule = binaryExpression.rightExpression as BoundSubModuleExpression;
                            if (subModule.returnsValue) {
                                this._diagnostics.push(new Diagnostic(ErrorCode.FunctionCannotBeEventHandler, subModule.syntax.range));
                                return new BoundInvalidExpressionStatement(expression, syntax);
                            }
                            return new BoundEventAssignmentStatement(eventExpression.libraryName, eventExpression.eventName, subModule.subModuleName, syntax);
                        }

                        this._diagnostics.push(new Diagnostic(ErrorCode.AssigningNonSubModuleToEvent, eventExpression.syntax.range));
                        return new BoundInvalidExpressionStatement(expression, syntax);
                    }

                    default: {
                        this._diagnostics.push(new Diagnostic(
                            ErrorCode.ValueIsNotAssignable,
                            binaryExpression.leftExpression.syntax.range));

                        return new BoundInvalidExpressionStatement(expression, syntax);
                    }
                }
            }

            case BoundKind.LibraryMethodInvocationExpression: {
                const call = expression as BoundLibraryMethodInvocationExpression;
                return new BoundLibraryMethodInvocationStatement(call.libraryName, call.methodName, call.argumentsList, syntax);
            }

            case BoundKind.SubModuleInvocationExpression: {
                const call = expression as BoundSubModuleInvocationExpression;
                if (!call.returnsValue) {
                    return new BoundSubModuleInvocationStatement(call.subModuleName, call.argumentsList, syntax);
                }
                break;
            }

            case BoundKind.SubModuleExpression: {
                const reference = expression as BoundSubModuleExpression;
                // A no-argument Sub may be called without parentheses.
                if (!reference.returnsValue && reference.parameters.length === 0) {
                    return new BoundSubModuleInvocationStatement(reference.subModuleName, [], syntax);
                }
                break;
            }
        }

        const errorCode = expression.hasValue
            ? ErrorCode.UnassignedExpressionStatement
            : ErrorCode.InvalidExpressionStatement;

        this._diagnostics.push(new Diagnostic(errorCode, syntax.expression.range));
        return new BoundInvalidExpressionStatement(expression, syntax);
    }

    private bindExpression(syntax: BaseSyntaxNode, expectedValue: boolean): BaseBoundExpression {
        return new ExpressionBinder(syntax, expectedValue, this._definedProcedures, this._diagnostics).result;
    }
}
