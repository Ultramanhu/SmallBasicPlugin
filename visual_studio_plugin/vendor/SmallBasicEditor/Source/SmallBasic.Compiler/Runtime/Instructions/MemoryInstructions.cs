// <copyright file="MemoryInstructions.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Runtime
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.Linq;
    using SmallBasic.Compiler.Scanning;

    internal sealed class StoreVariableInstruction : BaseNonJumpInstruction
    {
        private readonly string variable;

        public StoreVariableInstruction(string variable, TextRange range)
            : base(range)
        {
            this.variable = variable;
        }

        protected override void Execute(SmallBasicEngine engine)
        {
            engine.GetVariableMemory(this.variable)[this.variable] = engine.EvaluationStack.Pop();
        }
    }

    internal sealed class LoadVariableInstruction : BaseNonJumpInstruction
    {
        private readonly string variable;

        public LoadVariableInstruction(string variable, TextRange range)
            : base(range)
        {
            this.variable = variable;
        }

        protected override void Execute(SmallBasicEngine engine)
        {
            if (engine.GetVariableMemory(this.variable).TryGetValue(this.variable, out BaseValue value))
            {
                engine.EvaluationStack.Push(value);
            }
            else
            {
                engine.EvaluationStack.Push(StringValue.Empty);
            }
        }
    }

    internal sealed class StoreArrayElementInstruction : BaseNonJumpInstruction
    {
        private readonly string array;
        private readonly int indicesCount;

        public StoreArrayElementInstruction(string array, int indicesCount, TextRange range)
            : base(range)
        {
            this.array = array;
            this.indicesCount = indicesCount;
        }

        protected override void Execute(SmallBasicEngine engine)
        {
            BaseValue value = engine.EvaluationStack.Pop();
            executeAux(new ArrayValue(engine.GetVariableMemory(this.array)), this.array, this.indicesCount);

            BaseValue executeAux(ArrayValue memory, string index, int remainingIndices)
            {
                if (remainingIndices == 0)
                {
                    if (string.IsNullOrEmpty(value.ToString()))
                    {
                        memory.RemoveIndex(index);
                    }
                    else
                    {
                        memory.SetIndex(index, value);
                    }
                }
                else
                {
                    ArrayValue nextMemory =
                        memory.TryGetValue(index, out BaseValue elementValue) && elementValue is ArrayValue elementArrayValue
                        ? elementArrayValue
                        : new ArrayValue();

                    string nextIndex = engine.EvaluationStack.Pop().ToString();

                    memory.SetIndex(index, executeAux(nextMemory, nextIndex, remainingIndices - 1));
                }

                return memory;
            }
        }
    }

    internal sealed class LoadArrayElementInstruction : BaseNonJumpInstruction
    {
        private readonly string array;
        private readonly int indicesCount;

        public LoadArrayElementInstruction(string array, int indicesCount, TextRange range)
            : base(range)
        {
            this.array = array;
            this.indicesCount = indicesCount;
        }

        protected override void Execute(SmallBasicEngine engine)
        {
            IReadOnlyDictionary<string, BaseValue> memory = engine.GetVariableMemory(this.array);
            string index = this.array;
            bool found = true;

            // Every index is popped, even when the array (or an intermediate level)
            // is missing or is not an array: leaving an index on the stack used to
            // leak it into the surrounding expression.
            for (int remainingIndices = this.indicesCount; remainingIndices > 0; remainingIndices--)
            {
                if (found && memory.TryGetValue(index, out BaseValue elementValue) && elementValue is ArrayValue elementArrayValue)
                {
                    memory = elementArrayValue;
                }
                else
                {
                    found = false;
                }

                index = engine.EvaluationStack.Pop().ToString();
            }

            if (!found || !memory.TryGetValue(index, out BaseValue value))
            {
                engine.EvaluationStack.Push(StringValue.Empty);
            }
            else
            {
                engine.EvaluationStack.Push(value);
            }
        }
    }

    internal sealed class PushValueInstruction : BaseNonJumpInstruction
    {
        private readonly BaseValue value;

        public PushValueInstruction(BaseValue value, TextRange range)
            : base(range)
        {
            this.value = value;
        }

        protected override void Execute(SmallBasicEngine engine)
        {
            engine.EvaluationStack.Push(this.value);
        }
    }
}
