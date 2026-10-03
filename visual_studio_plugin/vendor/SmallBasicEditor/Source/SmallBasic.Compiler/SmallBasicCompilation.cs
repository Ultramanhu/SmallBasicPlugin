// <copyright file="SmallBasicCompilation.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using SmallBasic.Compiler.Binding;
    using SmallBasic.Compiler.Diagnostics;
    using SmallBasic.Compiler.Parsing;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Compiler.Scanning;
    using SmallBasic.Compiler.Services;
    using SmallBasic.Utilities;

    public sealed class SmallBasicCompilation
    {
        private readonly DiagnosticBag diagnostics;
        private readonly bool isRunningOnDesktop;

        private readonly Scanner scanner;
        private readonly Parser parser;
        private readonly Binder binder;

        private readonly Lazy<RuntimeAnalysis> lazyAnalysis;

        public SmallBasicCompilation(string text)
#if IsBuildingForDesktop
           : this(text, isRunningOnDesktop: true)
#else
           : this(text, isRunningOnDesktop: false)
#endif
        {
        }

        public SmallBasicCompilation(string text, bool isRunningOnDesktop)
        {
            this.diagnostics = new DiagnosticBag();
            this.isRunningOnDesktop = isRunningOnDesktop;

            this.Text = text;

            this.scanner = new Scanner(this.Text, this.diagnostics);
            this.parser = new Parser(this.scanner.Tokens, this.diagnostics);
            this.binder = new Binder(this.parser.SyntaxTree, this.diagnostics, isRunningOnDesktop);

            this.lazyAnalysis = new Lazy<RuntimeAnalysis>(() => new RuntimeAnalysis(this));
        }

        public string Text { get; private set; }

        public RuntimeAnalysis Analysis => this.lazyAnalysis.Value;

        public IReadOnlyList<Diagnostic> Diagnostics => this.diagnostics.Contents;

        internal BoundStatementBlock MainModule => this.binder.MainModule;

        internal IReadOnlyList<string> GlobalDeclarations => this.binder.GlobalDeclarations;

        internal IReadOnlyDictionary<string, BoundSubModule> SubModules => this.binder.SubModules;

        internal IReadOnlyDictionary<string, BoundFunction> Functions => this.binder.Functions;

        public MonacoCompletionItem[] ProvideCompletionItems(TextPosition position) => CompletionItemProvider.Provide(this.parser, this.binder, this.Text, position);

        public string[] ProvideHover(TextPosition position) => HoverProvider.Provide(this.diagnostics, this.parser, this.binder, position);

        // Document outline: procedure declarations plus the first use of every
        // variable, grouped by the scope owning that first use.
        public IReadOnlyList<OutlineItem> GetOutlineItems() => OutlineProvider.Provide(this.parser.SyntaxTree);

        // Lines (0-based) that contain at least one emitted instruction. Debug
        // adapters use this to snap breakpoints onto executable statements.
        public IReadOnlyCollection<int> GetExecutableLines()
        {
            var lines = new HashSet<int>();
            CollectExecutableLines(this.MainModule, lines);
            foreach (BoundSubModule subModule in this.SubModules.Values)
            {
                CollectExecutableLines(subModule.Body, lines);
            }

            foreach (BoundFunction function in this.Functions.Values)
            {
                CollectExecutableLines(function.Body, lines);
            }

            return lines;

            static void CollectExecutableLines(BoundStatementBlock body, HashSet<int> target)
            {
                ModuleEmitter emitter = new ModuleEmitter(body);
                foreach (BaseInstruction instruction in emitter.Instructions)
                {
                    target.Add(instruction.Range.Start.Line);
                }
            }
        }

        // Synthetic variable that captures a compiled expression's value. It is
        // restored (or removed) by the engine after evaluation, so even the
        // unlikely collision with a user variable does not corrupt the program.
        internal const string ExpressionResultVariable = "__SmallBasicDebugExpression";

        // Compiles a single value-producing expression (for example a conditional
        // breakpoint condition) into an evaluatable form. Returns null when the
        // text is empty or does not parse/bind as an expression. Sub module
        // invocations are rejected because the evaluator cannot unwind their
        // execution frames.
        public CompiledExpression CompileExpression(string expression)
        {
            if (string.IsNullOrWhiteSpace(expression))
            {
                return null;
            }

            // The parser only understands whole statements, so wrap the
            // expression in an assignment. Newlines would terminate the statement
            // early, so collapse them into spaces first.
            string normalized = expression.Replace('\r', ' ').Replace('\n', ' ');
            string source = $"{ExpressionResultVariable} = ({normalized})";

            var expressionDiagnostics = new DiagnosticBag();
            var scanner = new Scanner(source, expressionDiagnostics);
            var parser = new Parser(scanner.Tokens, expressionDiagnostics);
            var binder = new Binder(parser.SyntaxTree, expressionDiagnostics, this.isRunningOnDesktop);

            if (expressionDiagnostics.Contents.Count > 0)
            {
                return null;
            }

            var emitter = new ModuleEmitter(binder.MainModule);
            var module = new RuntimeModule(
                "<expression>",
                RuntimeModuleKind.DebugExpression,
                Array.Empty<string>(),
                Array.Empty<string>(),
                emitter.Instructions,
                parser.SyntaxTree);
            return new CompiledExpression(module, ExpressionResultVariable);
        }
    }
}
