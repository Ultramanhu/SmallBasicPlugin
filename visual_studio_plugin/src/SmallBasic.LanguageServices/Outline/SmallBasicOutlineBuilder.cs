namespace SmallBasic.LanguageServices.Outline
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using SmallBasic.Compiler;
    using SmallBasic.Compiler.Services;

    /// <summary>
    /// Turns the compiler outline model into the flat tree shown by the Visual Studio
    /// document-outline tool window. Top level variables are grouped under a synthetic
    /// <c>&lt;主程序&gt;</c> node, mirroring the VS Code outline.
    /// </summary>
    public static class SmallBasicOutlineBuilder
    {
        public static IReadOnlyList<SmallBasicOutlineNodeInfo> Build(string sourceText, string filePath)
        {
            var compilation = new SmallBasicCompilation(sourceText ?? string.Empty);
            var topLevelVariables = new List<SmallBasicOutlineNodeInfo>();
            var procedureNodes = new List<SmallBasicOutlineNodeInfo>();

            foreach (OutlineItem item in compilation.GetOutlineItems())
            {
                if (item.Kind == OutlineItemKind.Procedure || item.Kind == OutlineItemKind.Function)
                {
                    procedureNodes.Add(ToProcedureNode(filePath, item));
                }
                else
                {
                    topLevelVariables.Add(ToVariableNode(filePath, item));
                }
            }

            var nodes = new List<SmallBasicOutlineNodeInfo>();
            if (topLevelVariables.Count > 0)
            {
                var firstTopLevelVariable = topLevelVariables[0];
                nodes.Add(new SmallBasicOutlineNodeInfo(
                    displayText: "<主程序>",
                    filePath: filePath,
                    line: firstTopLevelVariable.Line,
                    column: firstTopLevelVariable.Column,
                    children: topLevelVariables));
            }

            nodes.AddRange(procedureNodes);
            return nodes;
        }

        private static SmallBasicOutlineNodeInfo ToProcedureNode(string filePath, OutlineItem item)
        {
            return new SmallBasicOutlineNodeInfo(
                displayText: item.Detail,
                filePath: filePath,
                line: item.SelectionRange.Start.Line,
                column: item.SelectionRange.Start.Column,
                children: item.Children.Select(child => ToVariableNode(filePath, child)).ToArray());
        }

        private static SmallBasicOutlineNodeInfo ToVariableNode(string filePath, OutlineItem item)
        {
            return new SmallBasicOutlineNodeInfo(
                displayText: item.Name,
                filePath: filePath,
                line: item.SelectionRange.Start.Line,
                column: item.SelectionRange.Start.Column,
                children: Array.Empty<SmallBasicOutlineNodeInfo>());
        }
    }

    /// <summary>A single row of the document outline (0-based compiler coordinates).</summary>
    public sealed class SmallBasicOutlineNodeInfo
    {
        public SmallBasicOutlineNodeInfo(
            string displayText,
            string filePath,
            int line,
            int column,
            IReadOnlyList<SmallBasicOutlineNodeInfo> children)
        {
            this.DisplayText = displayText;
            this.FilePath = filePath;
            this.Line = line;
            this.Column = column;
            this.Children = children;
        }

        public string DisplayText { get; }

        public string FilePath { get; }

        public int Line { get; }

        public int Column { get; }

        public IReadOnlyList<SmallBasicOutlineNodeInfo> Children { get; }
    }
}
