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

        private static string[] SubModuleHover(BoundSubModule subModule) => new[]
        {
            $"Sub {subModule.Name}",
            "User-defined subroutine",
        };

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
    }
}
