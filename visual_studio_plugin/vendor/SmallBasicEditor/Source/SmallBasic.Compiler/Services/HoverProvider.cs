// <copyright file="HoverProvider.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Services
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using SmallBasic.Compiler.Binding;
    using SmallBasic.Compiler.Diagnostics;
    using SmallBasic.Compiler.Parsing;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Compiler.Scanning;
    using SmallBasic.Utilities;

    internal static class HoverProvider
    {
        public static string[] Provide(DiagnosticBag diagnostics, Parser parser, Binder binder, TextPosition position)
        {
            Diagnostic diagnostic = diagnostics.Contents.FirstOrDefault(d => d.Range.Contains(position));
            if (!diagnostic.IsDefault())
            {
                return new[] { diagnostic.ToDisplayString() };
            }

            if (!parser.SyntaxTree.Body.Any())
            {
                return Array.Empty<string>();
            }

            string[] userSymbolHover = ProvideUserSymbolHover(parser, binder, position);
            if (userSymbolHover.Length > 0)
            {
                return userSymbolHover;
            }

            var node = parser.SyntaxTree.FindNodeAt(position);

            // Loop control keywords carry no symbol, so they would otherwise
            // fall through to the library-member checks and produce no hover.
            if (node is LoopControlStatementSyntax loopControlStatement)
            {
                return loopControlStatement.ControlToken.Kind == TokenKind.Break
                    ? new[] { "Break", "Exits the innermost While or For loop." }
                    : new[] { "Continue", "Skips to the next iteration of the innermost While or For loop. In a For loop the increment or Step still runs." };
            }

            // Same for the GoSub keyword and its target: the target is a bare
            // identifier token, not an invocation expression, so it needs its
            // own procedure hover.
            if (node is GoSubStatementSyntax goSubStatement)
            {
                if (goSubStatement.NameToken.Range.Contains(position))
                {
                    return ProcedureTargetHover(binder, goSubStatement.NameToken.Text);
                }

                return new[] { "GoSub", "Calls a parameterless Sub and returns to the statement after the call." };
            }

            if (node is OnErrorStatementSyntax onErrorStatement)
            {
                if (!onErrorStatement.TargetToken.IsDefault() &&
                    onErrorStatement.TargetToken.Range.Contains(position))
                {
                    return ProcedureTargetHover(binder, onErrorStatement.TargetToken.Text);
                }

                return OnErrorHover(onErrorStatement.Action);
            }

            // Same for the Mod keyword and the \ operator: keyword-driven
            // binary operators carry no symbol of their own.
            if (node is BinaryOperatorExpressionSyntax binaryOperator &&
                binaryOperator.OperatorToken.Range.Contains(position))
            {
                if (binaryOperator.OperatorToken.Kind == TokenKind.Mod)
                {
                    return new[] { "Mod", "Returns the remainder of dividing the left number by the right one, with the same sign as the dividend. Dividing by zero is a runtime error that On Error can catch." };
                }

                if (binaryOperator.OperatorToken.Kind == TokenKind.Backslash)
                {
                    return new[] { "\\", "Integer division: divides the left number by the right one and truncates the quotient toward zero. Dividing by zero is a runtime error that On Error can catch." };
                }
            }

            if (node is ObjectAccessExpressionSyntax objectAccess &&
                objectAccess.BaseExpression is IdentifierExpressionSyntax baseExpression)
            {
                if (Libraries.Types.TryGetValue(baseExpression.IdentifierToken.Text, out Library library))
                {
                    if (baseExpression.Range.Contains(position))
                    {
                        return new[] { library.Name, library.Description };
                    }
                    else if (objectAccess.IdentifierToken.Range.Contains(position))
                    {
                        string memberName = objectAccess.IdentifierToken.Text;
                        if (library.Methods.TryGetValue(memberName, out Method method))
                        {
                            // Method hovers show the signature spelled like the official
                            // documentation, followed by the localized parameter docs.
                            var lines = new List<string>
                            {
                                $"{library.Name}.{method.Name}({method.Parameters.Values.Select(p => p.Name).Join(", ")})",
                                method.Description,
                            };

                            foreach (Parameter parameter in method.Parameters.Values)
                            {
                                lines.Add($"{parameter.Name}: {parameter.Description}");
                            }

                            return lines.ToArray();
                        }
                        else if (library.Properties.TryGetValue(memberName, out Property property))
                        {
                            return new[] { property.Name, property.Description };
                        }
                        else if (library.Events.TryGetValue(memberName, out Event @event))
                        {
                            return new[] { @event.Name, @event.Description };
                        }
                    }
                }
            }
            else if (node is IdentifierExpressionSyntax identifier)
            {
                if (Libraries.Types.TryGetValue(identifier.IdentifierToken.Text, out Library library))
                {
                    return new[] { library.Name, library.Description };
                }
            }

            return Array.Empty<string>();
        }

        private static string[] ProvideUserSymbolHover(Parser parser, Binder binder, TextPosition position)
        {
            foreach (BoundFunction function in binder.Functions.Values)
            {
                if (function.Syntax.NameToken.Range.Contains(position))
                {
                    return FunctionHover(function);
                }

                ParameterSyntax parameter = function.Syntax.Parameters
                    .FirstOrDefault(candidate => candidate.IdentifierToken.Range.Contains(position));
                if (!parameter.IsDefault())
                {
                    return ParameterHover(parameter.IdentifierToken.Text);
                }
            }

            foreach (BoundSubModule subModule in binder.SubModules.Values)
            {
                if (subModule.Syntax.NameToken.Range.Contains(position))
                {
                    return SubModuleHover(subModule);
                }

                ParameterSyntax parameter = subModule.Syntax.Parameters
                    .FirstOrDefault(candidate => candidate.IdentifierToken.Range.Contains(position));
                if (!parameter.IsDefault())
                {
                    return ParameterHover(parameter.IdentifierToken.Text);
                }
            }

            BaseSyntaxNode node = parser.SyntaxTree.FindNodeAt(position);
            if (node is DimVariableSyntax dimVariable)
            {
                return LocalHover(dimVariable.IdentifierToken.Text);
            }

            if (!(node is IdentifierExpressionSyntax identifier))
            {
                return Array.Empty<string>();
            }

            string name = identifier.IdentifierToken.Text;
            BoundFunction referencedFunction = binder.Functions.Values
                .FirstOrDefault(function => string.Equals(function.Name, name, StringComparison.OrdinalIgnoreCase));
            if (!referencedFunction.IsDefault())
            {
                return FunctionHover(referencedFunction);
            }

            BoundSubModule referencedSubModule = binder.SubModules.Values
                .FirstOrDefault(subModule => string.Equals(subModule.Name, name, StringComparison.OrdinalIgnoreCase));
            if (!referencedSubModule.IsDefault())
            {
                return SubModuleHover(referencedSubModule);
            }

            BoundFunction containingFunction = binder.Functions.Values
                .FirstOrDefault(function => function.Syntax.Range.Contains(position));
            if (!containingFunction.IsDefault())
            {
                string parameterName = containingFunction.Parameters
                    .FirstOrDefault(parameter => string.Equals(parameter, name, StringComparison.OrdinalIgnoreCase));
                if (!parameterName.IsDefault())
                {
                    return ParameterHover(parameterName);
                }

                string localName = containingFunction.Locals
                    .FirstOrDefault(local => string.Equals(local, name, StringComparison.OrdinalIgnoreCase));
                if (!localName.IsDefault())
                {
                    return LocalHover(localName);
                }
            }

            BoundSubModule containingSubModule = binder.SubModules.Values
                .FirstOrDefault(subModule => subModule.Syntax.Range.Contains(position));
            if (!containingSubModule.IsDefault())
            {
                string parameterName = containingSubModule.Syntax.Parameters
                    .Select(parameter => parameter.IdentifierToken.Text)
                    .FirstOrDefault(parameter => string.Equals(parameter, name, StringComparison.OrdinalIgnoreCase));
                if (!parameterName.IsDefault())
                {
                    return ParameterHover(parameterName);
                }

                string localName = containingSubModule.Locals
                    .FirstOrDefault(local => string.Equals(local, name, StringComparison.OrdinalIgnoreCase));
                if (!localName.IsDefault())
                {
                    return LocalHover(localName);
                }
            }

            return Array.Empty<string>();
        }

        private static string[] FunctionHover(BoundFunction function) => new[]
        {
            $"Function {function.Name}({function.Parameters.Join(", ")})",
            "User-defined function",
        };

        private static string[] SubModuleHover(BoundSubModule subModule)
        {
            var parameters = subModule.Syntax.Parameters.Select(parameter => parameter.IdentifierToken.Text).ToArray();
            return new[]
            {
                parameters.Length == 0
                    ? $"Sub {subModule.Name}"
                    : $"Sub {subModule.Name}({parameters.Join(", ")})",
                "User-defined subroutine",
            };
        }

        private static string[] ParameterHover(string name) => new[]
        {
            $"Parameter {name}",
            "Function-scoped parameter",
        };

        private static string[] LocalHover(string name) => new[]
        {
            $"Local variable {name}",
            "Procedure-scoped variable declared with Dim",
        };

        private static string[] ProcedureTargetHover(Binder binder, string name)
        {
            BoundFunction function = binder.Functions.Values
                .FirstOrDefault(candidate => string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase));
            if (!function.IsDefault())
            {
                return FunctionHover(function);
            }

            BoundSubModule subModule = binder.SubModules.Values
                .FirstOrDefault(candidate => string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase));
            if (!subModule.IsDefault())
            {
                return SubModuleHover(subModule);
            }

            return Array.Empty<string>();
        }

        private static string[] OnErrorHover(OnErrorAction action) => action switch
        {
            OnErrorAction.ResumeNext => new[]
            {
                "On Error Resume Next",
                "Skips the statement that caused a runtime error, mirrors it to the console, and keeps running.",
            },
            OnErrorAction.GoToDefault => new[]
            {
                "On Error GoTo -1",
                "Clears the current error state and restores the default behavior: a runtime error terminates the program.",
            },
            OnErrorAction.GoToClear => new[]
            {
                "On Error GoTo 0",
                "Disables the current On Error handler; runtime errors terminate the program again.",
            },
            OnErrorAction.GoSub => new[]
            {
                "On Error GoSub",
                "When a runtime error occurs, mirrors it to the console and calls the handler Sub with the error code and message; execution then resumes after the failed statement.",
            },
            _ => new[] { "On Error", "Configures the runtime error handling policy." },
        };
    }
}
