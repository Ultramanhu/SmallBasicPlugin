// <copyright file="Frame.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Runtime
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.Threading;

    public sealed class Frame
    {
        private static long nextId;
        private int index = 0;

        internal Frame(
            RuntimeModule module,
            IReadOnlyList<BaseValue> arguments,
            int evaluationStackBase,
            Dictionary<string, BaseValue> inheritedLocals = null,
            bool isErrorHandler = false)
        {
            this.Module = module;
            this.FrameId = Interlocked.Increment(ref nextId);
            this.EvaluationStackBase = evaluationStackBase;
            this.LocalMemory = inheritedLocals ?? new Dictionary<string, BaseValue>(StringComparer.OrdinalIgnoreCase);
            this.IsErrorHandler = isErrorHandler;

            foreach (string local in module.Locals)
            {
                this.LocalMemory[local] = StringValue.Empty;
            }

            if (arguments.Count != module.Parameters.Count)
            {
                throw new InvalidOperationException($"Procedure '{module.Name}' expected {module.Parameters.Count} arguments but received {arguments.Count}.");
            }

            for (int argumentIndex = 0; argumentIndex < arguments.Count; argumentIndex++)
            {
                this.LocalMemory[module.Parameters[argumentIndex]] = arguments[argumentIndex];
            }
        }

        public RuntimeModule Module { get; private set; }

        public long FrameId { get; private set; }

        public IReadOnlyDictionary<string, BaseValue> Locals => this.LocalMemory;

        internal Dictionary<string, BaseValue> LocalMemory { get; private set; }

        internal int EvaluationStackBase { get; private set; }

        /// <summary>True while this frame runs an `On Error GoSub` handler, which must be non-reentrant.</summary>
        internal bool IsErrorHandler { get; private set; }

        public int InstructionIndex
        {
            get
            {
                return this.index;
            }

            internal set
            {
                Debug.Assert(value >= 0 && value <= this.Module.Instructions.Count, "Value should be within the module length");
                this.index = value;
            }
        }

        public int CurrentSourceLine
        {
            get
            {
                if (this.index < this.Module.Instructions.Count)
                {
                    return this.Module.Instructions[this.index].Range.Start.Line;
                }
                else
                {
                    return this.Module.Syntax.Range.End.Line;
                }
            }
        }
    }
}
