// <copyright file="CompiledExpression.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler
{
    using SmallBasic.Compiler.Runtime;

    /// <summary>
    /// A single Small Basic expression compiled for evaluation against a paused
    /// <see cref="SmallBasicEngine"/>. Produced by
    /// <see cref="SmallBasicCompilation.CompileExpression(string)"/> so debug
    /// adapters can evaluate conditional breakpoints using the real interpreter
    /// semantics instead of a separate expression parser.
    /// </summary>
    public sealed class CompiledExpression
    {
        internal CompiledExpression(RuntimeModule module, string resultVariable)
        {
            this.Module = module;
            this.ResultVariable = resultVariable;
        }

        internal RuntimeModule Module { get; private set; }

        internal string ResultVariable { get; private set; }
    }
}
