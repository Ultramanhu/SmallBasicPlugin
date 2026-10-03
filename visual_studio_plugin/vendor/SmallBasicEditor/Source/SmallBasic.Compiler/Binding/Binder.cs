// <copyright file="Binder.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Binding
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using SmallBasic.Compiler.Diagnostics;
    using SmallBasic.Compiler.Parsing;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Compiler.Scanning;
    using SmallBasic.Utilities;

    internal sealed class Binder
    {
        private readonly DiagnosticBag diagnostics;
        private readonly bool isRunningOnDesktop;
        private readonly IReadOnlyDictionary<string, ProcedureSymbol> definedProcedures;

        private bool currentReturnsValue;

        public Binder(StatementBlockSyntax syntaxTree, DiagnosticBag diagnostics, bool isRunningOnDesktop)
        {
            this.diagnostics = diagnostics;
            this.isRunningOnDesktop = isRunningOnDesktop;
            var procedures = new Dictionary<string, ProcedureSymbol>(StringComparer.OrdinalIgnoreCase);
            foreach (BaseStatementSyntax syntax in syntaxTree.Body)
            {
                switch (syntax)
                {
                    case SubModuleStatementSyntax subModule:
                        addProcedure(subModule.NameToken, subModule, Array.Empty<string>(), returnsValue: false);
                        break;
                    case FunctionStatementSyntax function:
                        {
                            var parameterNames = new List<string>();
                            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            foreach (ParameterSyntax parameter in function.Parameters)
                            {
                                string name = parameter.IdentifierToken.Text;
                                if (!seen.Add(name))
                                {
                                    this.diagnostics.ReportDuplicateParameter(parameter.IdentifierToken.Range, name);
                                }
                                else
                                {
                                    parameterNames.Add(name);
                                }
                            }

                            addProcedure(function.NameToken, function, parameterNames, returnsValue: true);
                            break;
                        }
                }
            }

            this.definedProcedures = procedures;

            this.MainModule = this.BindProcedureBody(
                syntaxTree,
                Array.Empty<string>(),
                returnsValue: false,
                out IReadOnlyList<string> globalDeclarations);
            this.GlobalDeclarations = globalDeclarations;
            this.CheckForLabelErrors(this.MainModule);

            var subModules = new Dictionary<string, BoundSubModule>(StringComparer.OrdinalIgnoreCase);
            var functions = new Dictionary<string, BoundFunction>(StringComparer.OrdinalIgnoreCase);
            foreach (BaseStatementSyntax syntax in syntaxTree.Body)
            {
                switch (syntax)
                {
                    case SubModuleStatementSyntax subModuleSyntax when
                        procedures.TryGetValue(subModuleSyntax.NameToken.Text, out ProcedureSymbol subSymbol) &&
                        ReferenceEquals(subSymbol.Declaration, subModuleSyntax):
                        {
                            BoundStatementBlock body = this.BindProcedureBody(
                                subModuleSyntax.Body,
                                subSymbol.Parameters,
                                returnsValue: false,
                                out IReadOnlyList<string> locals);
                            subModules.Add(subSymbol.Name, new BoundSubModule(subModuleSyntax, subSymbol.Name, locals, body));
                            break;
                        }

                    case FunctionStatementSyntax functionSyntax when
                        procedures.TryGetValue(functionSyntax.NameToken.Text, out ProcedureSymbol functionSymbol) &&
                        ReferenceEquals(functionSymbol.Declaration, functionSyntax):
                        {
                            BoundStatementBlock body = this.BindProcedureBody(
                                functionSyntax.Body,
                                functionSymbol.Parameters,
                                returnsValue: true,
                                out IReadOnlyList<string> locals);
                            functions.Add(functionSymbol.Name, new BoundFunction(
                                functionSyntax,
                                functionSymbol.Name,
                                functionSymbol.Parameters,
                                locals,
                                body));
                            break;
                        }
                }
            }

            this.SubModules = subModules;
            foreach (var subModule in this.SubModules.Values)
            {
                this.CheckForLabelErrors(subModule.Body);
            }

            this.Functions = functions;
            foreach (var function in this.Functions.Values)
            {
                this.CheckForLabelErrors(function.Body);
            }

            void addProcedure(
                Token nameToken,
                BaseStatementSyntax declaration,
                IReadOnlyList<string> parameters,
                bool returnsValue)
            {
                string name = nameToken.Text;
                if (Libraries.Types.Keys.Any(libraryName => string.Equals(libraryName, name, StringComparison.OrdinalIgnoreCase)))
                {
                    this.diagnostics.ReportProcedureConflictsWithLibrary(nameToken.Range, name);
                }

                if (procedures.TryGetValue(name, out ProcedureSymbol existingProcedure))
                {
                    if (!returnsValue && !existingProcedure.ReturnsValue)
                    {
                        // Keep the established diagnostic contract for two Sub declarations.
                        this.diagnostics.ReportTwoSubModulesWithTheSameName(nameToken.Range, name);
                    }
                    else
                    {
                        this.diagnostics.ReportTwoProceduresWithTheSameName(nameToken.Range, name);
                    }
                }
                else
                {
                    procedures.Add(name, new ProcedureSymbol(name, declaration, parameters, returnsValue));
                }
            }
        }

        public BoundStatementBlock MainModule { get; private set; }

        public IReadOnlyList<string> GlobalDeclarations { get; private set; }

        public IReadOnlyDictionary<string, BoundSubModule> SubModules { get; private set; }

        public IReadOnlyDictionary<string, BoundFunction> Functions { get; private set; }

        private BoundStatementBlock BindProcedureBody(
            StatementBlockSyntax syntax,
            IReadOnlyList<string> parameters,
            bool returnsValue,
            out IReadOnlyList<string> locals)
        {
            bool previousReturnsValue = this.currentReturnsValue;
            this.currentReturnsValue = returnsValue;

            var declaredNames = new HashSet<string>(parameters, StringComparer.OrdinalIgnoreCase);
            var localNames = new List<string>();
            foreach (DimStatementSyntax dim in syntax.Body.OfType<DimStatementSyntax>())
            {
                foreach (DimVariableSyntax variable in dim.Variables)
                {
                    string name = variable.IdentifierToken.Text;
                    if (!declaredNames.Add(name))
                    {
                        this.diagnostics.ReportDuplicateLocalVariable(variable.IdentifierToken.Range, name);
                    }
                    else
                    {
                        localNames.Add(name);
                    }
                }
            }

            BoundStatementBlock result = this.BindStatementBlock(syntax, allowDim: true);
            this.currentReturnsValue = previousReturnsValue;
            locals = localNames;
            return result;
        }

        private void CheckForLabelErrors(BoundStatementBlock module)
        {
            var labelsCollector = new LabelDefinitionsCollector(this.diagnostics, module);
            var gotoChecker = new GoToUndefinedLabelChecker(this.diagnostics, labelsCollector.Labels, module);
        }

        private BaseBoundStatement BindStatementOpt(BaseStatementSyntax syntax)
        {
            switch (syntax)
            {
                case StatementBlockSyntax statementBlock: return this.BindStatementBlock(statementBlock);
                case IfStatementSyntax ifStatement: return this.BindIfStatement(ifStatement);
                case WhileStatementSyntax whileStatement: return this.BindWhileStatement(whileStatement);
                case ForStatementSyntax forStatement: return this.BindForStatement(forStatement);
                case ExpressionStatementSyntax expressionStatement: return this.BindExpressionStatement(expressionStatement);
                case ReturnStatementSyntax returnStatement: return this.BindReturnStatement(returnStatement);

                // Procedure declarations are collected in the first binding pass. They are
                // declarations, not executable statements in the main module.
                case SubModuleStatementSyntax subModuleStatement: return null;
                case FunctionStatementSyntax functionStatement: return null;

                case LabelStatementSyntax labelStatement: return new BoundLabelStatement(labelStatement, labelStatement.LabelToken.Text);
                case GoToStatementSyntax goToStatement: return new BoundGoToStatement(goToStatement, goToStatement.LabelToken.Text);

                case UnrecognizedStatementSyntax unrecognizedStatement: return null;
                case CommentStatementSyntax commentStatement: return null;

                default: throw ExceptionUtilities.UnexpectedValue(syntax);
            }
        }

        private BoundStatementBlock BindStatementBlock(StatementBlockSyntax syntax, bool allowDim = false)
        {
            var statements = new List<BaseBoundStatement>();

            foreach (var child in syntax.Body)
            {
                if (child is DimStatementSyntax)
                {
                    if (!allowDim)
                    {
                        this.diagnostics.ReportDimMustBeAtProcedureLevel(child.Range);
                    }

                    continue;
                }

                var statement = this.BindStatementOpt(child);

                if (!statement.IsDefault())
                {
                    statements.Add(statement);
                }
            }

            return new BoundStatementBlock(syntax, statements);
        }

        private BoundIfStatement BindIfStatement(IfStatementSyntax syntax)
        {
            BaseBoundExpression ifExpression = this.BindExpression(syntax.IfPart.Condition);
            BoundStatementBlock ifBody = this.BindStatementBlock(syntax.IfPart.Body);
            BoundIfPart ifPart = new BoundIfPart(syntax.IfPart, ifExpression, ifBody);

            List<BoundElseIfPart> elseIfParts = new List<BoundElseIfPart>();
            foreach (var part in syntax.ElseIfParts)
            {
                BaseBoundExpression elseIfExpression = this.BindExpression(part.Condition);
                BoundStatementBlock elseIfBody = this.BindStatementBlock(part.Body);
                elseIfParts.Add(new BoundElseIfPart(part, elseIfExpression, elseIfBody));
            }

            BoundElsePart elsePart = null;
            if (!syntax.ElsePartOpt.IsDefault())
            {
                BoundStatementBlock elseBody = this.BindStatementBlock(syntax.ElsePartOpt.Body);
                elsePart = new BoundElsePart(syntax.ElsePartOpt, elseBody);
            }

            return new BoundIfStatement(syntax, ifPart, elseIfParts, elsePart);
        }

        private BoundWhileStatement BindWhileStatement(WhileStatementSyntax syntax)
        {
            BaseBoundExpression expression = this.BindExpression(syntax.Condition);
            BoundStatementBlock body = this.BindStatementBlock(syntax.Body);

            return new BoundWhileStatement(syntax, expression, body);
        }

        private BoundForStatement BindForStatement(ForStatementSyntax syntax)
        {
            string identifier = syntax.IdentifierToken.Text;

            BaseBoundExpression fromExpression = this.BindExpression(syntax.FromExpression);
            BaseBoundExpression toExpression = this.BindExpression(syntax.ToExpression);

            BaseBoundExpression stepExpression = null;
            if (!syntax.StepClauseOpt.IsDefault())
            {
                stepExpression = this.BindExpression(syntax.StepClauseOpt.Expression);
            }

            BoundStatementBlock body = this.BindStatementBlock(syntax.Body);

            return new BoundForStatement(syntax, identifier, fromExpression, toExpression, stepExpression, body);
        }

        private BoundReturnStatement BindReturnStatement(ReturnStatementSyntax syntax)
        {
            BaseBoundExpression expression = this.BindExpression(syntax.Expression);
            if (!this.currentReturnsValue)
            {
                this.diagnostics.ReportReturnOutsideFunction(syntax.Range);
            }

            return new BoundReturnStatement(syntax, expression);
        }

        private BaseBoundStatement BindExpressionStatement(ExpressionStatementSyntax syntax)
        {
            BaseBoundExpression expression = this.BindExpression(syntax.Expression, expectsValue: false);

            if (expression.HasErrors)
            {
                return new BoundInvalidExpressionStatement(syntax, expression);
            }

            switch (expression)
            {
                case BoundBinaryExpression assignment when assignment.Kind == TokenKind.Equal:
                    {
                        return this.BindAssignmentExpressionStatement(syntax, assignment);
                    }

                case BoundLibraryMethodInvocationExpression methodInvocation:
                    {
                        return new BoundLibraryMethodInvocationStatement(syntax, methodInvocation);
                    }

                case BoundSubModuleInvocationExpression subModuleInvocation:
                    {
                        if (!subModuleInvocation.ReturnsValue)
                        {
                            return new BoundSubModuleInvocationStatement(syntax, subModuleInvocation);
                        }

                        break;
                    }
            }

            if (expression.HasValue)
            {
                this.diagnostics.ReportUnassignedExpressionStatement(syntax.Range);
            }
            else
            {
                this.diagnostics.ReportInvalidExpressionStatement(syntax.Range);
            }

            return new BoundInvalidExpressionStatement(syntax, expression);
        }

        private BaseBoundStatement BindAssignmentExpressionStatement(ExpressionStatementSyntax syntax, BoundBinaryExpression assignment)
        {
            switch (assignment.Left)
            {
                case BoundVariableExpression variable:
                    {
                        return new BoundVariableAssignmentStatement(syntax, variable, assignment.Right);
                    }

                case BoundArrayAccessExpression arrayAccess:
                    {
                        return new BoundArrayAssignmentStatement(syntax, arrayAccess, assignment.Right);
                    }

                case BoundLibraryPropertyExpression property:
                    {
                        if (Libraries.Types[property.Library.Name].Properties[property.Name].Setter.IsDefault())
                        {
                            this.diagnostics.ReportPropertyHasNoSetter(property.Syntax.Range, property.Library.Name, property.Name);
                        }

                        return new BoundPropertyAssignmentStatement(syntax, property, assignment.Right);
                    }

                case BoundLibraryEventExpression @event:
                    {
                        if (assignment.Right is BoundSubModuleExpression subModule)
                        {
                            if (subModule.ReturnsValue)
                            {
                                this.diagnostics.ReportFunctionCannotBeEventHandler(subModule.Syntax.Range);
                                return new BoundInvalidExpressionStatement(syntax, assignment);
                            }

                            return new BoundEventAssignmentStatement(syntax, @event, subModule.Name);
                        }
                        else
                        {
                            this.diagnostics.ReportAssigningNonSubModuleToEvent(@event.Syntax.Range);
                            return new BoundInvalidExpressionStatement(syntax, assignment);
                        }
                    }

                default:
                    {
                        this.diagnostics.ReportUnassignedExpressionStatement(syntax.Range);
                        return new BoundInvalidExpressionStatement(syntax, assignment);
                    }
            }
        }

        private BaseBoundExpression BindExpression(BaseExpressionSyntax syntax, bool expectsValue = true)
        {
            switch (syntax)
            {
                case UnaryOperatorExpressionSyntax unaryOperatorExpression: return this.BindUnaryOperatorExpression(unaryOperatorExpression);
                case BinaryOperatorExpressionSyntax binaryOperatorExpression: return this.BindBinaryOperatorExpression(binaryOperatorExpression);
                case ArrayAccessExpressionSyntax arrayAccessExpression: return this.BindArrayAccessExpression(arrayAccessExpression);
                case ParenthesisExpressionSyntax parenthesisExpression: return this.BindParenthesisExpression(parenthesisExpression);
                case StringLiteralExpressionSyntax stringLiteralExpression: return BindStringLiteralExpression(stringLiteralExpression);
                case NumberLiteralExpressionSyntax numberLiteralExpression: return this.BindNumberLiteralExpression(numberLiteralExpression);

                case ObjectAccessExpressionSyntax objectAccessExpression: return this.BindObjectAccessExpression(objectAccessExpression, expectsValue);
                case InvocationExpressionSyntax invocationExpression: return this.BindInvocationExpression(invocationExpression, expectsValue);
                case IdentifierExpressionSyntax identifierExpression: return this.BindIdentifierExpression(identifierExpression, expectsValue);

                case UnrecognizedExpressionSyntax unrecognizedExpression: return new BoundInvalidExpression(unrecognizedExpression, hasValue: true, hasErrors: true);

                default: throw ExceptionUtilities.UnexpectedValue(syntax);
            }
        }

        private BoundUnaryExpression BindUnaryOperatorExpression(UnaryOperatorExpressionSyntax syntax)
        {
            BaseBoundExpression expression = this.BindExpression(syntax.Expression);

            switch (syntax.OperatorToken.Kind)
            {
                case TokenKind.Minus:
                    return new BoundUnaryExpression(syntax, hasValue: true, expression.HasErrors, syntax.OperatorToken.Kind, expression);
                default:
                    throw ExceptionUtilities.UnexpectedValue(syntax.OperatorToken.Kind);
            }
        }

        private BoundBinaryExpression BindBinaryOperatorExpression(BinaryOperatorExpressionSyntax syntax)
        {
            BaseBoundExpression left = this.BindExpression(syntax.Left);
            BaseBoundExpression right = this.BindExpression(syntax.Right, expectsValue: !(left is BoundLibraryEventExpression));

            switch (syntax.OperatorToken.Kind)
            {
                case TokenKind.Or:
                case TokenKind.And:
                case TokenKind.NotEqual:
                case TokenKind.Equal:
                case TokenKind.LessThan:
                case TokenKind.GreaterThan:
                case TokenKind.LessThanOrEqual:
                case TokenKind.GreaterThanOrEqual:
                case TokenKind.Plus:
                case TokenKind.Minus:
                case TokenKind.Multiply:
                case TokenKind.Divide:
                    return new BoundBinaryExpression(syntax, hasValue: true, left.HasErrors || right.HasErrors, syntax.OperatorToken.Kind, left, right);
                default:
                    throw ExceptionUtilities.UnexpectedValue(syntax.OperatorToken.Kind);
            }
        }

        private BaseBoundExpression BindArrayAccessExpression(ArrayAccessExpressionSyntax syntax)
        {
            BaseBoundExpression baseExpression = this.BindExpression(syntax.BaseExpression);
            BaseBoundExpression indexExpression = this.BindExpression(syntax.IndexExpression);

            string arrayName;
            List<BaseBoundExpression> indices = new List<BaseBoundExpression>();
            bool hasErrors = baseExpression.HasErrors || indexExpression.HasErrors;

            switch (baseExpression)
            {
                case BoundArrayAccessExpression arrayAccess:
                    {
                        arrayName = arrayAccess.Name;
                        indices.AddRange(arrayAccess.Indices);
                        indices.Add(indexExpression);
                        break;
                    }

                case BoundVariableExpression variable:
                    {
                        arrayName = variable.Name;
                        indices.Add(indexExpression);
                        break;
                    }

                default:
                    {
                        if (!hasErrors)
                        {
                            hasErrors = true;
                            this.diagnostics.ReportUnsupportedArrayBaseExpression(syntax.BaseExpression.Range);
                        }

                        return new BoundInvalidExpression(syntax, hasValue: true, hasErrors);
                    }
            }

            return new BoundArrayAccessExpression(syntax, hasValue: true, hasErrors, arrayName, indices);
        }

        private BoundParenthesisExpression BindParenthesisExpression(ParenthesisExpressionSyntax syntax)
        {
            BaseBoundExpression expression = this.BindExpression(syntax.Expression);
            return new BoundParenthesisExpression(syntax, hasValue: true, expression.HasErrors, expression);
        }

        private static BoundStringLiteralExpression BindStringLiteralExpression(StringLiteralExpressionSyntax syntax)
        {
            string value = syntax.StringToken.Text;
            if (value.Length < 1 || value[0] != '"')
            {
                throw new InvalidOperationException($"String literal '{value}' should have never been parsed without a starting double quotes.");
            }

            value = value.Substring(1);
            if (value.Length > 0 && value[value.Length - 1] == '"')
            {
                value = value.Substring(0, value.Length - 1);
            }

            return new BoundStringLiteralExpression(syntax, hasValue: true, hasErrors: false, value);
        }

        private BaseBoundExpression BindNumberLiteralExpression(NumberLiteralExpressionSyntax syntax)
        {
            string value = syntax.NumberToken.Text;

            if (decimal.TryParse(value, out decimal result))
            {
                return new BoundNumberLiteralExpression(syntax, hasValue: true, hasErrors: false, result);
            }

            this.diagnostics.ReportValueIsNotANumber(syntax.Range, value);
            return new BoundInvalidExpression(syntax, hasValue: true, hasErrors: true);
        }

        private BaseBoundExpression BindObjectAccessExpression(ObjectAccessExpressionSyntax syntax, bool expectsValue)
        {
            BaseBoundExpression baseExpression = this.BindExpression(syntax.BaseExpression, expectsValue: false);
            string identifier = syntax.IdentifierToken.Text;
            bool hasErrors = baseExpression.HasErrors;

            if (baseExpression is BoundLibraryTypeExpression libraryTypeExpression)
            {
                Library library = Libraries.Types[libraryTypeExpression.Name];

                if (library.Properties.TryGetValue(identifier, out Property property))
                {
                    bool noGetter = property.Getter.IsDefault();

                    if (!hasErrors)
                    {
                        if (expectsValue && noGetter)
                        {
                            hasErrors = true;
                            this.diagnostics.ReportExpectedExpressionWithAValue(syntax.Range);
                        }
                        else if (property.IsDeprecated)
                        {
                            hasErrors = true;
                            this.diagnostics.ReportLibraryMemberDeprecatedFromOlderVersion(syntax.Range, library.Name, property.Name);
                        }
                        else if (property.NeedsDesktop && !this.isRunningOnDesktop)
                        {
                            hasErrors = true;
                            this.diagnostics.ReportLibraryMemberNeedsDesktop(syntax.Range, library.Name, property.Name);
                        }
                    }

                    return new BoundLibraryPropertyExpression(syntax, hasValue: !noGetter, hasErrors, libraryTypeExpression, identifier);
                }

                if (library.Methods.TryGetValue(identifier, out Method method))
                {
                    if (!hasErrors)
                    {
                        if (expectsValue)
                        {
                            hasErrors = true;
                            this.diagnostics.ReportExpectedExpressionWithAValue(syntax.Range);
                        }
                        else if (method.IsDeprecated)
                        {
                            hasErrors = true;
                            this.diagnostics.ReportLibraryMemberDeprecatedFromOlderVersion(syntax.Range, library.Name, method.Name);
                        }
                        else if (method.NeedsDesktop && !this.isRunningOnDesktop)
                        {
                            hasErrors = true;
                            this.diagnostics.ReportLibraryMemberNeedsDesktop(syntax.Range, library.Name, method.Name);
                        }
                    }

                    return new BoundLibraryMethodExpression(syntax, hasValue: false, hasErrors, libraryTypeExpression, identifier);
                }

                if (library.Events.ContainsKey(identifier))
                {
                    return new BoundLibraryEventExpression(syntax, hasValue: false, hasErrors, libraryTypeExpression, identifier);
                }

                this.diagnostics.ReportLibraryMemberNotFound(syntax.Range, library.Name, identifier);
                return new BoundInvalidExpression(syntax, hasValue: true, hasErrors: true);
            }
            else
            {
                this.diagnostics.ReportUnsupportedDotBaseExpression(syntax.BaseExpression.Range);
                return new BoundInvalidExpression(syntax, hasValue: true, hasErrors: true);
            }
        }

        private BaseBoundExpression BindInvocationExpression(InvocationExpressionSyntax syntax, bool expectsValue)
        {
            BaseBoundExpression baseExpression = this.BindExpression(syntax.BaseExpression, expectsValue: false);
            bool hasErrors = baseExpression.HasErrors;
            List<BaseBoundExpression> arguments = new List<BaseBoundExpression>();

            foreach (ArgumentSyntax arg in syntax.Arguments)
            {
                BaseBoundExpression argument = this.BindExpression(arg.Expression);
                hasErrors |= argument.HasErrors;
                arguments.Add(argument);
            }

            switch (baseExpression)
            {
                case BoundLibraryMethodExpression libraryMethod:
                    {
                        Method method = Libraries.Types[libraryMethod.Library.Name].Methods[libraryMethod.Name];

                        if (!hasErrors)
                        {
                            if (arguments.Count != method.Parameters.Count)
                            {
                                hasErrors = true;
                                this.diagnostics.ReportUnexpectedArgumentsCount(syntax.Range, arguments.Count, method.Parameters.Count);
                            }
                            else if (expectsValue && !method.ReturnsValue)
                            {
                                hasErrors = true;
                                this.diagnostics.ReportExpectedExpressionWithAValue(syntax.Range);
                            }
                        }

                        return new BoundLibraryMethodInvocationExpression(syntax, method.ReturnsValue, hasErrors, libraryMethod, arguments);
                    }

                case BoundSubModuleExpression subModule:
                    {
                        if (!hasErrors)
                        {
                            if (arguments.Count != subModule.Parameters.Count)
                            {
                                hasErrors = true;
                                this.diagnostics.ReportUnexpectedArgumentsCount(syntax.Range, arguments.Count, subModule.Parameters.Count);
                            }
                            else if (expectsValue && !subModule.ReturnsValue)
                            {
                                hasErrors = true;
                                this.diagnostics.ReportExpectedExpressionWithAValue(syntax.Range);
                            }
                        }

                        return new BoundSubModuleInvocationExpression(
                            syntax,
                            hasValue: subModule.ReturnsValue,
                            hasErrors,
                            subModule.Name,
                            arguments,
                            subModule.ReturnsValue);
                    }

                default:
                    {
                        this.diagnostics.ReportUnsupportedInvocationBaseExpression(syntax.Range);
                        return new BoundInvalidExpression(syntax, hasValue: true, hasErrors: true);
                    }
            }
        }

        private BaseBoundExpression BindIdentifierExpression(IdentifierExpressionSyntax syntax, bool expectsValue)
        {
            bool hasErrors = false;
            string name = syntax.IdentifierToken.Text;

            if (Libraries.Types.TryGetValue(name, out Library library))
            {
                if (expectsValue)
                {
                    hasErrors = true;
                    this.diagnostics.ReportExpectedExpressionWithAValue(syntax.Range);
                }

                return new BoundLibraryTypeExpression(syntax, hasValue: false, hasErrors, name);
            }
            else if (this.definedProcedures.TryGetValue(name, out ProcedureSymbol procedure))
            {
                if (expectsValue)
                {
                    return new BoundVariableExpression(syntax, hasValue: true, hasErrors, name);
                }

                return new BoundSubModuleExpression(
                    syntax,
                    hasValue: false,
                    hasErrors,
                    procedure.Name,
                    procedure.Parameters,
                    procedure.ReturnsValue);
            }
            else
            {
                return new BoundVariableExpression(syntax, hasValue: true, hasErrors, name);
            }
        }

        private sealed class ProcedureSymbol
        {
            public ProcedureSymbol(
                string name,
                BaseStatementSyntax declaration,
                IReadOnlyList<string> parameters,
                bool returnsValue)
            {
                this.Name = name;
                this.Declaration = declaration;
                this.Parameters = parameters;
                this.ReturnsValue = returnsValue;
            }

            public string Name { get; }

            public BaseStatementSyntax Declaration { get; }

            public IReadOnlyList<string> Parameters { get; }

            public bool ReturnsValue { get; }
        }
    }
}
