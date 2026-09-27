// <copyright file="OutlineProvider.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Services
{
    using System;
    using System.Collections.Generic;
    using SmallBasic.Compiler.Parsing;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Compiler.Scanning;

    /// <summary>The kind of a document-outline entry.</summary>
    public enum OutlineItemKind
    {
        /// <summary>A <c>Sub ... EndSub</c> procedure declaration.</summary>
        Procedure,

        /// <summary>A variable, reported at the position of its first use.</summary>
        Variable,
    }

    /// <summary>A single document-outline entry.</summary>
    public sealed class OutlineItem
    {
        internal OutlineItem(
            string name,
            OutlineItemKind kind,
            TextRange range,
            TextRange selectionRange,
            IReadOnlyList<OutlineItem> children)
        {
            this.Name = name;
            this.Kind = kind;
            this.Range = range;
            this.SelectionRange = selectionRange;
            this.Children = children;
        }

        /// <summary>Gets the identifier shown in the outline.</summary>
        public string Name { get; }

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
            var procedures = new List<SubModuleStatementSyntax>();
            var procedureNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var statement in syntaxTree.Body)
            {
                if (statement is SubModuleStatementSyntax subModule)
                {
                    procedures.Add(subModule);
                    procedureNames.Add(subModule.NameToken.Text);
                }
            }

            var firstUses = new Dictionary<string, FirstUse>(StringComparer.OrdinalIgnoreCase);
            CollectVariableUses(syntaxTree, -1, procedureNames, firstUses);
            for (var index = 0; index < procedures.Count; index++)
            {
                CollectVariableUses(procedures[index].Body, index, procedureNames, firstUses);
            }

            var variablesByScope = new Dictionary<int, List<OutlineItem>>();
            foreach (var use in firstUses.Values)
            {
                var item = new OutlineItem(use.Name, OutlineItemKind.Variable, use.Range, use.Range, Array.Empty<OutlineItem>());
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
                var subModule = procedures[index];
                var children = variablesByScope.TryGetValue(index, out var bucket)
                    ? SortByPosition(bucket)
                    : Array.Empty<OutlineItem>();
                items.Add(new OutlineItem(
                    subModule.NameToken.Text,
                    OutlineItemKind.Procedure,
                    subModule.Range,
                    subModule.NameToken.Range,
                    children));
            }

            items.Sort((left, right) => ComparePositions(left.Range.Start, right.Range.Start));
            return items;
        }

        private static void CollectVariableUses(
            BaseSyntaxNode node,
            int scope,
            HashSet<string> procedureNames,
            Dictionary<string, FirstUse> firstUses)
        {
            switch (node)
            {
                case SubModuleStatementSyntax _:
                    // Procedures are outlined separately; their body is never part of
                    // the enclosing scope.
                    return;

                case IdentifierExpressionSyntax identifier:
                    Register(identifier.IdentifierToken.Text, identifier.IdentifierToken.Range, scope, procedureNames, firstUses);
                    break;

                case ForStatementSyntax forStatement:
                    // `For i = ...` declares the loop variable even though it is a
                    // plain token rather than an identifier expression.
                    Register(forStatement.IdentifierToken.Text, forStatement.IdentifierToken.Range, scope, procedureNames, firstUses);
                    break;
            }

            foreach (var child in node.Children)
            {
                CollectVariableUses(child, scope, procedureNames, firstUses);
            }
        }

        private static void Register(
            string name,
            TextRange range,
            int scope,
            HashSet<string> procedureNames,
            Dictionary<string, FirstUse> firstUses)
        {
            if (procedureNames.Contains(name) || Libraries.Types.ContainsKey(name))
            {
                return;
            }

            if (firstUses.TryGetValue(name, out var existing) && existing.Range.Start <= range.Start)
            {
                return;
            }

            firstUses[name] = new FirstUse(name, range, scope);
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
    }
}
