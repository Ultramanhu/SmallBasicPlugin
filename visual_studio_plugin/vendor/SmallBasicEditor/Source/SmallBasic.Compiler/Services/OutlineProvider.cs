// <copyright file="OutlineProvider.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Services
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using SmallBasic.Compiler.Parsing;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Compiler.Scanning;

    /// <summary>The kind of a document-outline entry.</summary>
    public enum OutlineItemKind
    {
        /// <summary>A <c>Sub ... EndSub</c> procedure declaration.</summary>
        Procedure,

        /// <summary>A <c>Function ... EndFunction</c> declaration.</summary>
        Function,

        /// <summary>A variable, reported at the position of its first use.</summary>
        Variable,
    }

    /// <summary>A single document-outline entry.</summary>
    public sealed class OutlineItem
    {
        internal OutlineItem(
            string name,
            string detail,
            OutlineItemKind kind,
            TextRange range,
            TextRange selectionRange,
            IReadOnlyList<OutlineItem> children)
        {
            this.Name = name;
            this.Detail = detail;
            this.Kind = kind;
            this.Range = range;
            this.SelectionRange = selectionRange;
            this.Children = children;
        }

        /// <summary>Gets the identifier shown in the outline.</summary>
        public string Name { get; }

        /// <summary>Gets the declaration signature displayed by editor surfaces.</summary>
        public string Detail { get; }

        /// <summary>Gets the kind of the entry.</summary>
        public OutlineItemKind Kind { get; }

        /// <summary>Gets the range covered by the entry (the whole procedure for <see cref="OutlineItemKind.Procedure"/>).</summary>
        public TextRange Range { get; }

        /// <summary>Gets the range highlighted when the entry is selected.</summary>
        public TextRange SelectionRange { get; }

        /// <summary>Gets the variables first used inside this procedure. Always empty for variables.</summary>
        public IReadOnlyList<OutlineItem> Children { get; }
    }

    /// <summary>
    /// Builds the document outline ("大纲") of a parsed program: every procedure
    /// declaration plus the first use of every variable.
    /// </summary>
    /// <remarks>
    /// A variable is reported once, at its earliest occurrence in the whole
    /// program, nested under the procedure that contains that occurrence (top
    /// level when the first use lives in the main module). Library names
    /// (<c>TextWindow</c>, <c>Math</c>, ...) and procedure names are not
    /// variables and are skipped.
    /// </remarks>
    internal static class OutlineProvider
    {
        public static IReadOnlyList<OutlineItem> Provide(StatementBlockSyntax syntaxTree)
        {
            var procedures = new List<ProcedureInfo>();
            var procedureNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var statement in syntaxTree.Body)
            {
                if (statement is SubModuleStatementSyntax subModule)
                {
                    Token[] parameterTokens = subModule.Parameters.Select(parameter => parameter.IdentifierToken).ToArray();
                    procedures.Add(new ProcedureInfo(
                        subModule.NameToken.Text,
                        parameterTokens.Length == 0
                            ? $"Sub {subModule.NameToken.Text}"
                            : $"Sub {subModule.NameToken.Text}({string.Join(", ", parameterTokens.Select(parameter => parameter.Text))})",
                        OutlineItemKind.Procedure,
                        subModule.NameToken.Range,
                        subModule.Range,
                        subModule.Body,
                        parameterTokens));
                    procedureNames.Add(subModule.NameToken.Text);
                }
                else if (statement is FunctionStatementSyntax function)
                {
                    procedures.Add(new ProcedureInfo(
                        function.NameToken.Text,
                        $"Function {function.NameToken.Text}({string.Join(", ", function.Parameters.Select(parameter => parameter.IdentifierToken.Text))})",
                        OutlineItemKind.Function,
                        function.NameToken.Range,
                        function.Range,
                        function.Body,
                        function.Parameters.Select(parameter => parameter.IdentifierToken).ToArray()));
                    procedureNames.Add(function.NameToken.Text);
                }
            }

            var firstUses = new Dictionary<string, FirstUse>(StringComparer.OrdinalIgnoreCase);
            CollectVariableUses(syntaxTree, -1, procedureNames, firstUses, new HashSet<string>(StringComparer.OrdinalIgnoreCase));
            for (var index = 0; index < procedures.Count; index++)
            {
                foreach (Token parameter in procedures[index].Parameters)
                {
                    Register(parameter.Text, parameter.Range, index, procedureNames, firstUses, procedures[index].LocalNames);
                }

                CollectVariableUses(procedures[index].Body, index, procedureNames, firstUses, procedures[index].LocalNames);
            }

            var variablesByScope = new Dictionary<int, List<OutlineItem>>();
            foreach (var use in firstUses.Values)
            {
                var item = new OutlineItem(use.Name, "Variable", OutlineItemKind.Variable, use.Range, use.Range, Array.Empty<OutlineItem>());
                if (!variablesByScope.TryGetValue(use.Scope, out var bucket))
                {
                    bucket = new List<OutlineItem>();
                    variablesByScope.Add(use.Scope, bucket);
                }

                bucket.Add(item);
            }

            var items = new List<OutlineItem>();
            if (variablesByScope.TryGetValue(-1, out var topLevelVariables))
            {
                items.AddRange(SortByPosition(topLevelVariables));
            }

            for (var index = 0; index < procedures.Count; index++)
            {
                var procedure = procedures[index];
                var children = variablesByScope.TryGetValue(index, out var bucket)
                    ? SortByPosition(bucket)
                    : Array.Empty<OutlineItem>();
                items.Add(new OutlineItem(
                    procedure.Name,
                    procedure.Detail,
                    procedure.Kind,
                    procedure.Range,
                    procedure.NameRange,
                    children));
            }

            items.Sort((left, right) => ComparePositions(left.Range.Start, right.Range.Start));
            return items;
        }

        private static void CollectVariableUses(
            BaseSyntaxNode node,
            int scope,
            HashSet<string> procedureNames,
            Dictionary<string, FirstUse> firstUses,
            HashSet<string> localNames)
        {
            switch (node)
            {
                case SubModuleStatementSyntax _:
                case FunctionStatementSyntax _:
                    // Procedures are outlined separately; their body is never part of
                    // the enclosing scope.
                    return;

                case IdentifierExpressionSyntax identifier:
                    Register(identifier.IdentifierToken.Text, identifier.IdentifierToken.Range, scope, procedureNames, firstUses, localNames);
                    break;

                case ForStatementSyntax forStatement:
                    // `For i = ...` declares the loop variable even though it is a
                    // plain token rather than an identifier expression.
                    Register(forStatement.IdentifierToken.Text, forStatement.IdentifierToken.Range, scope, procedureNames, firstUses, localNames);
                    break;

                case DimStatementSyntax dimStatement:
                    foreach (DimVariableSyntax variable in dimStatement.Variables)
                    {
                        Register(variable.IdentifierToken.Text, variable.IdentifierToken.Range, scope, procedureNames, firstUses, localNames);
                    }

                    break;
            }

            foreach (var child in node.Children)
            {
                CollectVariableUses(child, scope, procedureNames, firstUses, localNames);
            }
        }

        private static void Register(
            string name,
            TextRange range,
            int scope,
            HashSet<string> procedureNames,
            Dictionary<string, FirstUse> firstUses,
            HashSet<string> localNames)
        {
            if (procedureNames.Contains(name) || Libraries.Types.ContainsKey(name))
            {
                return;
            }

            string key = scope >= 0 && localNames.Contains(name)
                ? scope + ":" + name
                : "global:" + name;
            if (firstUses.TryGetValue(key, out var existing) && existing.Range.Start <= range.Start)
            {
                return;
            }

            firstUses[key] = new FirstUse(name, range, scope);
        }

        private static IReadOnlyList<OutlineItem> SortByPosition(List<OutlineItem> items)
        {
            items.Sort((left, right) => ComparePositions(left.Range.Start, right.Range.Start));
            return items;
        }

        private static int ComparePositions(TextPosition left, TextPosition right)
        {
            return left.Line != right.Line ? left.Line - right.Line : left.Column - right.Column;
        }

        private sealed class FirstUse
        {
            public FirstUse(string name, TextRange range, int scope)
            {
                this.Name = name;
                this.Range = range;
                this.Scope = scope;
            }

            public string Name { get; }

            public TextRange Range { get; }

            /// <summary>Gets the index of the owning procedure, or -1 for the main module.</summary>
            public int Scope { get; }
        }

        private sealed class ProcedureInfo
        {
            public ProcedureInfo(
                string name,
                string detail,
                OutlineItemKind kind,
                TextRange nameRange,
                TextRange range,
                StatementBlockSyntax body,
                IReadOnlyList<Token> parameters)
            {
                this.Name = name;
                this.Detail = detail;
                this.Kind = kind;
                this.NameRange = nameRange;
                this.Range = range;
                this.Body = body;
                this.Parameters = parameters;
                this.LocalNames = new HashSet<string>(parameters.Select(parameter => parameter.Text), StringComparer.OrdinalIgnoreCase);
                foreach (DimStatementSyntax dim in body.Body.OfType<DimStatementSyntax>())
                {
                    foreach (DimVariableSyntax variable in dim.Variables)
                    {
                        this.LocalNames.Add(variable.IdentifierToken.Text);
                    }
                }
            }

            public string Name { get; }

            public string Detail { get; }

            public OutlineItemKind Kind { get; }

            public TextRange NameRange { get; }

            public TextRange Range { get; }

            public StatementBlockSyntax Body { get; }

            public IReadOnlyList<Token> Parameters { get; }

            public HashSet<string> LocalNames { get; }
        }
    }
}
