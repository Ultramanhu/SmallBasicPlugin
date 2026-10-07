// <copyright file="CompletionItemProvider.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Services
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using SmallBasic.Compiler.Binding;
    using SmallBasic.Compiler.Parsing;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Compiler.Scanning;
    using SmallBasic.Utilities;
    using SmallBasic.Utilities.Resources;

    internal static class CompletionItemProvider
    {
        public static MonacoCompletionItem[] Provide(Parser parser, Binder binder, string text, TextPosition position)
        {
            if (!parser.SyntaxTree.Body.Any())
            {
                return GetItemsBeforeDot(binder, string.Empty, position);
            }

            TextPosition caretPosition = position;

            // column - 1, as we want to check inside the previous node, not after it.
            TextPosition lookupPosition = (position.Line, position.Column - 1);
            var node = parser.SyntaxTree.FindNodeAt(lookupPosition);

            switch (node)
            {
                case IdentifierExpressionSyntax identifier:
                    {
                        if (identifier.Parent is ObjectAccessExpressionSyntax objectAccess &&
                            objectAccess.BaseExpression is IdentifierExpressionSyntax library)
                        {
                            return GetItemsAfterDot(library.IdentifierToken.Text, identifier.IdentifierToken.Text);
                        }
                        else
                        {
                            return GetItemsBeforeDot(binder, identifier.IdentifierToken.Text, position);
                        }
                    }

                case ObjectAccessExpressionSyntax objectAccess when objectAccess.BaseExpression is IdentifierExpressionSyntax library:
                    {
                        return GetItemsAfterDot(library.IdentifierToken.Text, objectAccess.IdentifierToken.Text);
                    }

                default:
                    {
                        // Ctrl+Space can be invoked on a blank line or immediately after a
                        // completed statement, where the parser has no syntax node at the
                        // caret.  Still offer first-level names (Array, TextWindow, keywords,
                        // variables) and filter them by the word immediately before the caret.
                        return GetItemsBeforeDot(binder, ExtractWordAtPosition(text, caretPosition), position);
                    }
            }
        }

        private static string ExtractWordAtPosition(string text, TextPosition position)
        {
            int lineStart = 0;
            for (int line = 0; line < position.Line && lineStart < text.Length; line++)
            {
                int newLine = text.IndexOf('\n', lineStart);
                lineStart = newLine < 0 ? text.Length : newLine + 1;
            }

            int lineEnd = text.IndexOf('\n', lineStart);
            if (lineEnd < 0)
            {
                lineEnd = text.Length;
            }

            int caret = Math.Min(lineStart + Math.Max(position.Column, 0), lineEnd);
            int start = caret;
            while (start > lineStart)
            {
                char current = text[start - 1];
                if (!char.IsLetterOrDigit(current) && current != '_')
                {
                    break;
                }

                start--;
            }

            return text.Substring(start, caret - start);
        }

        private static MonacoCompletionItem[] GetItemsAfterDot(string libraryName, string prefix)
        {
            var items = new List<MonacoCompletionItem>();

            if (Libraries.Types.TryGetValue(libraryName, out Library library))
            {
                foreach (var method in library.Methods.Values.Where(m => m.Name.StartsWith(prefix, StringComparison.CurrentCultureIgnoreCase)))
                {
                    // Methods are displayed with their parameter names, spelled like
                    // the official documentation (e.g. `GetRandomNumber(maxNumber)`),
                    // while the inserted text stays a snippet with tab stops. The
                    // documentation carries the parameter docs, so the host tooltip
                    // matches what hover shows.
                    string label = $"{method.Name}({method.Parameters.Values.Select(p => p.Name).Join(", ")})";
                    string arguments = method.Parameters.Values.Select((p, i) => $"${{{i + 1}:{p.Name}}}").Join(", ");
                    string documentation = method.Parameters.Values.Select(p => $"{p.Name}: {p.Description}").Join(Environment.NewLine);
                    items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Method, label, method.Description, $"{method.Name}({arguments})", documentation));
                }

                foreach (var property in library.Properties.Values.Where(p => p.Name.StartsWith(prefix, StringComparison.CurrentCultureIgnoreCase)))
                {
                    items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Property, property.Name, property.Description));
                }

                foreach (var @event in library.Events.Values.Where(e => e.Name.StartsWith(prefix, StringComparison.CurrentCultureIgnoreCase)))
                {
                    items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Event, @event.Name, @event.Description));
                }
            }

            return items.ToArray();
        }

        private static string GetKeywordDescription(string name)
        {
            // Keyword help strings live in the localized documentation
            // (DocumentationLocales.xml); fall back to the keyword itself.
            string key;
            switch (name)
            {
                case "For Step": key = "Keywords_Step"; break;
                case "GoTo": key = "Keywords_Goto"; break;
                case "On Error Resume Next": key = "Keywords_OnErrorResumeNext"; break;
                case "On Error GoTo -1": key = "Keywords_OnErrorGoToMinus1"; break;
                case "On Error GoTo 0": key = "Keywords_OnErrorGoTo0"; break;
                case "On Error GoSub": key = "Keywords_OnErrorGoSub"; break;
                default: key = "Keywords_" + name; break;
            }

            var description = LibrariesResources.ResourceManager.GetString(key, LibrariesResources.Culture);
            return string.IsNullOrEmpty(description) ? name : description;
        }

        private static MonacoCompletionItem[] GetItemsBeforeDot(Binder binder, string prefix, TextPosition position)
        {
            var items = new List<MonacoCompletionItem>();
            var procedureNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var variableNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (BoundSubModule subModule in binder.SubModules.Values.Where(module => module.Name.StartsWith(prefix, StringComparison.CurrentCultureIgnoreCase)))
            {
                procedureNames.Add(subModule.Name);
                string[] subModuleParameters = subModule.Syntax.Parameters.Select(parameter => parameter.IdentifierToken.Text).ToArray();
                if (subModuleParameters.Length == 0)
                {
                    items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Method, subModule.Name, "Sub", subModule.Name + "()"));
                }
                else
                {
                    string subModuleLabel = $"{subModule.Name}({subModuleParameters.Join(", ")})";
                    string subModuleArguments = subModuleParameters.Select((parameter, index) => $"${{{index + 1}:{parameter}}}").Join(", ");
                    items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Method, subModuleLabel, "Sub", $"{subModule.Name}({subModuleArguments})"));
                }
            }

            foreach (BoundFunction function in binder.Functions.Values.Where(module => module.Name.StartsWith(prefix, StringComparison.CurrentCultureIgnoreCase)))
            {
                procedureNames.Add(function.Name);
                string label = $"{function.Name}({function.Parameters.Join(", ")})";
                string arguments = function.Parameters.Select((parameter, index) => $"${{{index + 1}:{parameter}}}").Join(", ");
                items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Method, label, "Function", $"{function.Name}({arguments})"));
            }

            foreach (var name in new VariablesAndSubModulesCollector(binder).Names.Where(name =>
                !procedureNames.Contains(name) && name.StartsWith(prefix, StringComparison.CurrentCultureIgnoreCase)))
            {
                if (variableNames.Add(name))
                {
                    items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Variable, name, name));
                }
            }

            IEnumerable<string> currentLocals = binder.SubModules.Values
                .Where(module => module.Syntax.Range.Contains(position))
                .SelectMany(module => module.Syntax.Parameters.Select(parameter => parameter.IdentifierToken.Text).Concat(module.Locals))
                .Concat(binder.Functions.Values
                    .Where(function => function.Syntax.Range.Contains(position))
                    .SelectMany(function => function.Parameters.Concat(function.Locals)));
            foreach (string name in currentLocals
                .Where(name => name.StartsWith(prefix, StringComparison.CurrentCultureIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (variableNames.Add(name))
                {
                    items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Variable, name, name));
                }
            }

            foreach (var library in Libraries.Types.Values.Where(library => library.Name.StartsWith(prefix, StringComparison.CurrentCultureIgnoreCase)))
            {
                items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Class, library.Name, library.Description));
            }

            void addSnippet(string name, params string[] lines)
            {
                if (name.StartsWith(prefix, StringComparison.CurrentCultureIgnoreCase))
                {
                    items.Add(new MonacoCompletionItem(MonacoCompletionItemKind.Snippet, name, GetKeywordDescription(name), lines.Join(Environment.NewLine)));
                }
            }

            addSnippet("If", "If ${1:condition} Then", "EndIf");
            addSnippet("ElseIf", "ElseIf ${1:condition} Then");
            addSnippet("Else", "Else");
            addSnippet("EndIf", "EndIf");

            addSnippet("GoTo", "GoTo ${1:label}");
            addSnippet("GoSub", "GoSub ${1:name}");
            addSnippet("On Error Resume Next", "On Error Resume Next");
            addSnippet("On Error GoTo -1", "On Error GoTo -1");
            addSnippet("On Error GoTo 0", "On Error GoTo 0");
            addSnippet("On Error GoSub", "On Error GoSub ${1:Handler}");

            addSnippet("While", "While ${1:condition}", "EndWhile");
            addSnippet("EndWhile", "EndWhile");

            addSnippet("For", "For ${1:name} = ${2:start} To ${3:end}", "EndFor");
            addSnippet("For Step", "For ${1:name} = ${2:start} To ${3:end} Step ${4:increment}", "EndFor");
            addSnippet("EndFor", "EndFor");
            addSnippet("Break", "Break");
            addSnippet("Continue", "Continue");

            addSnippet("Sub", "Sub ${1:name}", "EndSub");
            addSnippet("EndSub", "EndSub");
            addSnippet("Function", "Function ${1:name}(${2:arguments})", "\t${3}", "EndFunction");
            addSnippet("EndFunction", "EndFunction");
            addSnippet("Dim", "Dim ${1:name}");
            addSnippet("Return", "Return ${1:value}");

            return items.ToArray();
        }
    }
}
