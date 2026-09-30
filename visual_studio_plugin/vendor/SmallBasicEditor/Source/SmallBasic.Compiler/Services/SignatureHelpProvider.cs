// <copyright file="SignatureHelpProvider.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Services
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Compiler.Scanning;
    using SmallBasic.Utilities;

    /// <summary>
    /// Describes one parameter of a signature, using LSP-like shapes so hosts can
    /// forward it verbatim.
    /// </summary>
    public sealed class SignatureParameterInformation
    {
        public SignatureParameterInformation(string label, string documentation)
        {
            this.Label = label;
            this.Documentation = documentation;
        }

        public string Label { get; private set; }

        public string Documentation { get; private set; }
    }

    public sealed class SignatureInformation
    {
        public SignatureInformation(string label, string documentation, IReadOnlyList<SignatureParameterInformation> parameters)
        {
            this.Label = label;
            this.Documentation = documentation;
            this.Parameters = parameters;
        }

        public string Label { get; private set; }

        public string Documentation { get; private set; }

        public IReadOnlyList<SignatureParameterInformation> Parameters { get; private set; }
    }

    public sealed class SignatureHelp
    {
        public SignatureHelp(IReadOnlyList<SignatureInformation> signatures, int activeSignature, int activeParameter)
        {
            this.Signatures = signatures;
            this.ActiveSignature = activeSignature;
            this.ActiveParameter = activeParameter;
        }

        public IReadOnlyList<SignatureInformation> Signatures { get; private set; }

        public int ActiveSignature { get; private set; }

        public int ActiveParameter { get; private set; }
    }

    /// <summary>
    /// Shows the signature of the library method containing the caret, with the
    /// argument at the caret marked as active, mirroring the parameter hints of
    /// other languages.
    /// </summary>
    public static class SignatureHelpProvider
    {
        public static SignatureHelp Provide(string text, TextPosition position)
        {
            if (string.IsNullOrEmpty(text) || position.Line < 0)
            {
                return null;
            }

            string line = GetLine(text, position.Line);
            if (line is null)
            {
                return null;
            }

            int caret = Math.Min(Math.Max(position.Column, 0), line.Length);
            if (!TryFindInvocation(line, caret, out int openParen, out int activeParameter))
            {
                return null;
            }

            if (!TryMatchMethodName(line, openParen, out string libraryName, out string methodName))
            {
                return null;
            }

            if (!Libraries.Types.TryGetValue(libraryName, out Library library) ||
                !library.Methods.TryGetValue(methodName, out Method method))
            {
                return null;
            }

            var parameters = method.Parameters.Values.ToArray();
            var signature = new SignatureInformation(
                $"{library.Name}.{method.Name}({parameters.Select(p => p.Name).Join(", ")})",
                method.Description,
                parameters.Select(p => new SignatureParameterInformation(p.Name, p.Description)).ToArray());

            return new SignatureHelp(
                new[] { signature },
                activeSignature: 0,
                activeParameter: Math.Min(activeParameter, Math.Max(parameters.Length - 1, 0)));
        }

        private static string GetLine(string text, int line)
        {
            int start = 0;
            for (int current = 0; current < line; current++)
            {
                int newLine = text.IndexOf('\n', start);
                if (newLine < 0)
                {
                    return null;
                }

                start = newLine + 1;
            }

            int end = text.IndexOf('\n', start);
            end = end < 0 ? text.Length : end;
            return text.Substring(start, end - start).TrimEnd('\r');
        }

        // Small Basic statements are single-line, so the scan never leaves the
        // line containing the caret.
        private static bool TryFindInvocation(string line, int caret, out int openParen, out int activeParameter)
        {
            openParen = -1;
            activeParameter = 0;

            // Parallel stacks: the last entry of each belongs to the innermost
            // open paren, so the comma count for it survives closing a nested call.
            var parens = new List<int>();
            var commas = new List<int>();
            bool inString = false;

            for (int index = 0; index < caret; index++)
            {
                char current = line[index];
                if (inString)
                {
                    if (current == '"')
                    {
                        inString = false;
                    }

                    continue;
                }

                switch (current)
                {
                    case '"':
                        inString = true;
                        break;
                    case '\'':
                        // A quote starts a comment that runs to the end of the line.
                        return false;
                    case '(':
                        parens.Add(index);
                        commas.Add(0);
                        break;
                    case ')':
                        if (parens.Count == 0)
                        {
                            return false;
                        }

                        parens.RemoveAt(parens.Count - 1);
                        commas.RemoveAt(commas.Count - 1);
                        break;
                    case ',':
                        if (parens.Count > 0)
                        {
                            commas[commas.Count - 1]++;
                        }

                        break;
                    default:
                        break;
                }
            }

            if (parens.Count == 0 || inString)
            {
                return false;
            }

            openParen = parens[parens.Count - 1];
            activeParameter = commas[commas.Count - 1];
            return true;
        }

        private static bool TryMatchMethodName(string line, int openParen, out string libraryName, out string methodName)
        {
            libraryName = null;
            methodName = null;

            int index = openParen - 1;
            while (index >= 0 && (line[index] == ' ' || line[index] == '\t'))
            {
                index--;
            }

            int methodEnd = index + 1;
            while (index >= 0 && IsIdentifierCharacter(line[index]))
            {
                index--;
            }

            if (methodEnd == index + 1 || index < 0 || line[index] != '.')
            {
                return false;
            }

            methodName = line.Substring(index + 1, methodEnd - (index + 1));
            index--;

            int libraryEnd = index + 1;
            while (index >= 0 && IsIdentifierCharacter(line[index]))
            {
                index--;
            }

            if (libraryEnd == index + 1)
            {
                return false;
            }

            libraryName = line.Substring(index + 1, libraryEnd - (index + 1));
            return true;
        }

        private static bool IsIdentifierCharacter(char value)
        {
            return char.IsLetterOrDigit(value) || value == '_';
        }
    }
}
