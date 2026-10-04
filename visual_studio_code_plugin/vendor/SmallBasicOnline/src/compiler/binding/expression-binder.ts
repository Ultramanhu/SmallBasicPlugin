import { RuntimeLibraries } from "../runtime/libraries";
import { Diagnostic, ErrorCode } from "../utils/diagnostics";
import { CompilerUtils } from "../utils/compiler-utils";
import {
    BoundArrayAccessExpression,
    BaseBoundExpression,
    BoundKind,
    BoundLibraryEventExpression,
    BoundLibraryMethodExpression,
    BoundLibraryTypeExpression,
    BoundNegationExpression,
    BoundSubModuleExpression,
    BoundVariableExpression,
    BoundLibraryMethodInvocationExpression,
    BoundSubModuleInvocationExpression,
    BoundLibraryPropertyExpression,
    BoundParenthesisExpression,
    BoundNumberLiteralExpression,
    BoundStringLiteralExpression,
    BoundOrExpression,
    BoundAndExpression,
    BoundNotEqualExpression,
    BoundEqualExpression,
    BoundLessThanExpression,
    BoundGreaterThanExpression,
    BoundGreaterThanOrEqualExpression,
    BoundLessThanOrEqualExpression,
    BoundAdditionExpression,
    BoundSubtractionExpression,
    BoundMultiplicationExpression,
    BoundDivisionExpression
} from "./bound-nodes";
import {
    ArrayAccessExpressionSyntax,
    BaseSyntaxNode,
    BinaryOperatorExpressionSyntax,
    InvocationExpressionSyntax,
    SyntaxKind,
    ObjectAccessExpressionSyntax,
    ParenthesisExpressionSyntax,
    UnaryOperatorExpressionSyntax,
    IdentifierExpressionSyntax,
    NumberLiteralExpressionSyntax,
    StringLiteralExpressionSyntax,
    BaseExpressionSyntax
} from "../syntax/syntax-nodes";
import { TokenKind } from "../syntax/tokens";
import type { ProcedureSymbol } from "./modules-binder";

export class ExpressionBinder {
    private readonly _result: BaseBoundExpression;

    public get result(): BaseBoundExpression {
        return this._result;
    }

    public constructor(
        syntax: BaseSyntaxNode,
        expectedValue: boolean,
        private readonly _definedProcedures: { readonly [name: string]: ProcedureSymbol },
        private readonly _diagnostics: Diagnostic[]) {
        this._result = this.bindExpression(syntax, expectedValue);
    }

    private bindExpression(syntax: BaseExpressionSyntax, expectedValue: boolean): BaseBoundExpression {
        let expression: BaseBoundExpression;

        switch (syntax.kind) {
            case SyntaxKind.ArrayAccessExpression: expression = this.bindArrayAccess(syntax as ArrayAccessExpressionSyntax); break;
            case SyntaxKind.BinaryOperatorExpression: expression = this.bindBinaryOperator(syntax as BinaryOperatorExpressionSyntax); break;
            case SyntaxKind.InvocationExpression: expression = this.bindInvocation(syntax as InvocationExpressionSyntax, expectedValue); break;
            case SyntaxKind.ObjectAccessExpression: expression = this.bindObjectAccess(syntax as ObjectAccessExpressionSyntax, expectedValue); break;
            case SyntaxKind.ParenthesisExpression: expression = this.bindParenthesis(syntax as ParenthesisExpressionSyntax); break;
            case SyntaxKind.NumberLiteralExpression: expression = this.bindNumberLiteral(syntax as NumberLiteralExpressionSyntax); break;
            case SyntaxKind.StringLiteralExpression: expression = this.bindStringLiteral(syntax as StringLiteralExpressionSyntax); break;
            case SyntaxKind.IdentifierExpression: expression = this.bindIdentifier(syntax as IdentifierExpressionSyntax, expectedValue); break;
            case SyntaxKind.UnaryOperatorExpression: expression = this.bindUnaryOperator(syntax as UnaryOperatorExpressionSyntax); break;
            default: throw new Error(`Unexpected syntax kind: ${SyntaxKind[syntax.kind]}`);
        }

        return expression;
    }

    private bindArrayAccess(syntax: ArrayAccessExpressionSyntax): BoundArrayAccessExpression {
        const baseExpression = this.bindExpression(syntax.baseExpression, true);
        const indexExpression = this.bindExpression(syntax.indexExpression, true);

        let arrayName: string;
        let indices: BaseBoundExpression[];
        let hasErrors = baseExpression.hasErrors || indexExpression.hasErrors;

        switch (baseExpression.kind) {
            case BoundKind.ArrayAccessExpression: {
                const arrayAccess = baseExpression as BoundArrayAccessExpression;
                arrayName = arrayAccess.arrayName;
                indices = [...(arrayAccess).indices, indexExpression];
                break;
            }
            case BoundKind.VariableExpression: {
                arrayName = (baseExpression as BoundVariableExpression).variableName;
                indices = [indexExpression];
                break;
            }
            default: {
                if (!hasErrors) {
                    hasErrors = true;
                    this._diagnostics.push(new Diagnostic(ErrorCode.UnsupportedArrayBaseExpression, baseExpression.syntax.range));
                }

                arrayName = "<array>";
                indices = [indexExpression];
                break;
            }
        }

        return new BoundArrayAccessExpression(arrayName, indices, hasErrors, syntax);
    }

    private bindInvocation(syntax: InvocationExpressionSyntax, expectedValue: boolean): BaseBoundExpression {
        const baseExpression = this.bindExpression(syntax.baseExpression, false);
        const argumentsList = syntax.argumentsList.map(arg => this.bindExpression(arg.expression, true));

        let hasErrors = baseExpression.hasErrors || argumentsList.some(arg => arg.hasErrors);

        switch (baseExpression.kind) {
            case BoundKind.LibraryMethodExpression: {
                const method = baseExpression as BoundLibraryMethodExpression;
                const definition = RuntimeLibraries.Metadata[method.libraryName].methods[method.methodName];
                const parametersCount = definition.parameters.length;

                if (argumentsList.length !== parametersCount) {
                    hasErrors = true;
                    this._diagnostics.push(new Diagnostic(ErrorCode.UnexpectedArgumentsCount, baseExpression.syntax.range, parametersCount.toString(), argumentsList.length.toString()));
                }
                else if (expectedValue && !definition.returnsValue) {
                    hasErrors = true;
                    this._diagnostics.push(new Diagnostic(ErrorCode.UnexpectedVoid_ExpectingValue, syntax.range));
                }

                return new BoundLibraryMethodInvocationExpression(method.libraryName, method.methodName, argumentsList, definition.returnsValue, hasErrors, syntax);
            }
            case BoundKind.SubModuleExpression: {
                const procedure = baseExpression as BoundSubModuleExpression;
                if (argumentsList.length !== procedure.parameters.length) {
                    hasErrors = true;
                    this._diagnostics.push(new Diagnostic(
                        ErrorCode.UnexpectedArgumentsCount,
                        baseExpression.syntax.range,
                        procedure.parameters.length.toString(),
                        argumentsList.length.toString()));
                } else if (expectedValue && !procedure.returnsValue) {
                    hasErrors = true;
                    this._diagnostics.push(new Diagnostic(ErrorCode.UnexpectedVoid_ExpectingValue, syntax.range));
                }

                return new BoundSubModuleInvocationExpression(
                    procedure.subModuleName,
                    argumentsList,
                    procedure.returnsValue,
                    hasErrors,
                    syntax);
            }
            default: {
                hasErrors = true;
                this._diagnostics.push(new Diagnostic(ErrorCode.UnsupportedCallBaseExpression, baseExpression.syntax.range));
                return new BoundLibraryMethodInvocationExpression("<library>", "<method>", argumentsList, true, hasErrors, syntax);
            }
        }
    }

    private bindObjectAccess(syntax: ObjectAccessExpressionSyntax, expectedValue: boolean): BaseBoundExpression {
        const leftHandSide = this.bindExpression(syntax.baseExpression, false);
        const rightHandSide = syntax.identifierToken.token.text;
        let hasErrors = leftHandSide.hasErrors;

        if (leftHandSide.kind !== BoundKind.LibraryTypeExpression) {
            hasErrors = true;
            this._diagnostics.push(new Diagnostic(ErrorCode.UnsupportedDotBaseExpression, leftHandSide.syntax.range));
            return new BoundLibraryPropertyExpression("<library>", rightHandSide, true, hasErrors, syntax);
        }

        const libraryType = leftHandSide as BoundLibraryTypeExpression;
        const propertyName = CompilerUtils.findKeyIgnoreCase(RuntimeLibraries.Metadata[libraryType.libraryName].properties, rightHandSide);
        const propertyInfo = propertyName === undefined ? undefined : RuntimeLibraries.Metadata[libraryType.libraryName].properties[propertyName];

        if (propertyInfo) {
            if (expectedValue && !propertyInfo.hasGetter) {
                hasErrors = true;
                this._diagnostics.push(new Diagnostic(ErrorCode.UnexpectedVoid_ExpectingValue, syntax.range));
            }

            return new BoundLibraryPropertyExpression(libraryType.libraryName, propertyName!, propertyInfo.hasGetter, hasErrors, syntax);
        }

        const methodName = CompilerUtils.findKeyIgnoreCase(RuntimeLibraries.Metadata[libraryType.libraryName].methods, rightHandSide);
        const methodInfo = methodName === undefined ? undefined : RuntimeLibraries.Metadata[libraryType.libraryName].methods[methodName];
        if (methodInfo) {
            if (expectedValue) {
                hasErrors = true;
                this._diagnostics.push(new Diagnostic(ErrorCode.UnexpectedVoid_ExpectingValue, syntax.range));
            }

            return new BoundLibraryMethodExpression(libraryType.libraryName, methodName!, false, hasErrors, syntax);
        }

        const eventName = CompilerUtils.findKeyIgnoreCase(RuntimeLibraries.Metadata[libraryType.libraryName].events, rightHandSide);
        if (eventName !== undefined) {
            return new BoundLibraryEventExpression(libraryType.libraryName, eventName, hasErrors, syntax);
        }

        hasErrors = true;
        this._diagnostics.push(new Diagnostic(ErrorCode.LibraryMemberNotFound, leftHandSide.syntax.range, libraryType.libraryName, rightHandSide));
        return new BoundLibraryPropertyExpression(libraryType.libraryName, rightHandSide, true, hasErrors, syntax);
    }

    private bindParenthesis(syntax: ParenthesisExpressionSyntax): BaseBoundExpression {
        const expression = this.bindExpression(syntax.expression, true);
        return new BoundParenthesisExpression(expression, expression.hasErrors, syntax);
    }

    private bindNumberLiteral(syntax: NumberLiteralExpressionSyntax): BaseBoundExpression {
        const value = parseFloat(syntax.numberToken.token.text);
        const isNotANumber = isNaN(value);
        const expression = new BoundNumberLiteralExpression(value, isNotANumber, syntax);

        if (isNotANumber) {
            this._diagnostics.push(new Diagnostic(ErrorCode.ValueIsNotANumber, expression.syntax.range, syntax.numberToken.token.text));
        }

        return expression;
    }

    private bindStringLiteral(syntax: StringLiteralExpressionSyntax): BaseBoundExpression {
        let value = syntax.stringToken.token.text;
        if (value.length < 1 || value[0] !== "\"") {
            throw new Error(`String literal '${value}' should have never been parsed without a starting double quotes`);
        }

        value = value.substr(1);
        if (value.length && value[value.length - 1] === "\"") {
            value = value.substr(0, value.length - 1);
        }

        return new BoundStringLiteralExpression(value, false, syntax);
    }

    private bindIdentifier(syntax: IdentifierExpressionSyntax, expectedValue: boolean): BaseBoundExpression {
        let hasErrors = false;
        const name = syntax.identifierToken.token.text;
        const libraryKey = CompilerUtils.findKeyIgnoreCase(RuntimeLibraries.Metadata, name);
        const library = libraryKey === undefined ? undefined : RuntimeLibraries.Metadata[libraryKey];

        if (library) {
            if (expectedValue) {
                hasErrors = true;
                this._diagnostics.push(new Diagnostic(ErrorCode.UnexpectedVoid_ExpectingValue, syntax.range));
            }

            return new BoundLibraryTypeExpression(libraryKey!, hasErrors, syntax);
        } else {
            const procedure = this._definedProcedures[name.toLowerCase()];

            if (procedure !== undefined) {
                // A no-argument function may be called without parentheses when a
                // value is expected (e.g. `Answer = Empty`). Event handler
                // assignments bind in a non-value context, so `Handler` still
                // resolves to a procedure reference there.
                if (procedure.parameters.length === 0 && procedure.returnsValue && expectedValue) {
                    return new BoundSubModuleInvocationExpression(
                        procedure.name,
                        [],
                        true,
                        hasErrors,
                        syntax);
                }

                if (expectedValue) {
                    hasErrors = true;
                    this._diagnostics.push(new Diagnostic(ErrorCode.UnexpectedVoid_ExpectingValue, syntax.range));
                }

                return new BoundSubModuleExpression(
                    procedure.name,
                    procedure.parameters,
                    procedure.returnsValue,
                    hasErrors,
                    syntax);
            }
        }

        return new BoundVariableExpression(name, hasErrors, syntax);
    }

    private bindUnaryOperator(syntax: UnaryOperatorExpressionSyntax): BoundNegationExpression {
        const expression = this.bindExpression(syntax.expression, true);

        if (syntax.operatorToken.token.kind === TokenKind.Minus) {
            return new BoundNegationExpression(expression, expression.hasErrors, syntax);
        } else {
            throw new Error(`Unsupported token kind: ${TokenKind[syntax.operatorToken.kind]}`);
        }
    }

    private bindBinaryOperator(syntax: BinaryOperatorExpressionSyntax): BaseBoundExpression {
        const leftHandSide = this.bindExpression(syntax.leftExpression, true);
        const rightHandSide = this.bindExpression(syntax.rightExpression, leftHandSide.kind !== BoundKind.LibraryEventExpression);

        const hasErrors = leftHandSide.hasErrors || rightHandSide.hasErrors;

        switch (syntax.operatorToken.token.kind) {
            case TokenKind.Or: return new BoundOrExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.And: return new BoundAndExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.NotEqual: return new BoundNotEqualExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.Equal: return new BoundEqualExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.LessThan: return new BoundLessThanExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.GreaterThan: return new BoundGreaterThanExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.LessThanOrEqual: return new BoundLessThanOrEqualExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.GreaterThanOrEqual: return new BoundGreaterThanOrEqualExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.Plus: return new BoundAdditionExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.Minus: return new BoundSubtractionExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.Multiply: return new BoundMultiplicationExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            case TokenKind.Divide: return new BoundDivisionExpression(leftHandSide, rightHandSide, hasErrors, syntax);
            default: throw new Error(`Unexpected token kind ${TokenKind[syntax.operatorToken.kind]}`);
        }
    }
}
