// <copyright file="RuntimeModule.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Runtime
{
    using System.Collections.Generic;
    using SmallBasic.Compiler.Parsing;

    public enum RuntimeModuleKind
    {
        Program,
        Sub,
        Function,
        DebugExpression,
    }

    public sealed class RuntimeModule
    {
        internal RuntimeModule(
            string name,
            RuntimeModuleKind kind,
            IReadOnlyList<string> parameters,
            IReadOnlyList<string> locals,
            IReadOnlyList<BaseInstruction> instructions,
            BaseSyntaxNode syntax)
        {
            this.Name = name;
            this.Kind = kind;
            this.Parameters = parameters;
            this.Locals = locals;
            this.Instructions = instructions;
            this.Syntax = syntax;
        }

        public string Name { get; private set; }

        public RuntimeModuleKind Kind { get; private set; }

        public IReadOnlyList<string> Parameters { get; private set; }

        public IReadOnlyList<string> Locals { get; private set; }

        internal IReadOnlyList<BaseInstruction> Instructions { get; private set; }

        internal BaseSyntaxNode Syntax { get; private set; }
    }
}
