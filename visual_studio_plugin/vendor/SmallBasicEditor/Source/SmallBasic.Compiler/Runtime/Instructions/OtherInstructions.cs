// <copyright file="OtherInstructions.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Runtime
{
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    using SmallBasic.Compiler.Scanning;

    internal sealed class InvokeSubModuleInstruction : BaseNonJumpInstruction
    {
        private readonly string subModuleName;
        private readonly int argumentCount;
        private readonly bool returnsValue;

        public InvokeSubModuleInstruction(string subModuleName, int argumentCount, bool returnsValue, TextRange range)
            : base(range)
        {
            this.subModuleName = subModuleName;
            this.argumentCount = argumentCount;
            this.returnsValue = returnsValue;
        }

        protected override void Execute(SmallBasicEngine engine)
        {
            var arguments = new BaseValue[this.argumentCount];
            for (int index = this.argumentCount - 1; index >= 0; index--)
            {
                arguments[index] = engine.EvaluationStack.Pop();
            }

            engine.PushProcedure(this.subModuleName, arguments, this.returnsValue);
        }
    }

    internal sealed class ReturnValueInstruction : BaseNonJumpInstruction
    {
        public ReturnValueInstruction(TextRange range)
            : base(range)
        {
        }

        protected override void Execute(SmallBasicEngine engine)
        {
            engine.ReturnFromFunction(engine.EvaluationStack.Pop());
        }
    }

    internal sealed class OnErrorInstruction : BaseNonJumpInstruction
    {
        private readonly OnErrorAction action;
        private readonly string handlerNameOpt;

        public OnErrorInstruction(OnErrorAction action, string handlerNameOpt, TextRange range)
            : base(range)
        {
            this.action = action;
            this.handlerNameOpt = handlerNameOpt;
        }

        protected override void Execute(SmallBasicEngine engine)
        {
            engine.ConfigureErrorHandling(this.action, this.handlerNameOpt);
        }
    }

    internal sealed class MethodInvocationInstruction : BaseAsyncNonJumpInstruction
    {
        private readonly string library;
        private readonly string method;

        public MethodInvocationInstruction(string library, string method, TextRange range)
            : base(range)
        {
            this.library = library;
            this.method = method;
        }

        protected override Task Execute(SmallBasicEngine engine)
        {
            return Libraries.Types[this.library].Methods[this.method].Execute(engine);
        }
    }

    internal sealed class StorePropertyInstruction : BaseAsyncNonJumpInstruction
    {
        private readonly string library;
        private readonly string property;

        public StorePropertyInstruction(string library, string property, TextRange range)
            : base(range)
        {
            this.library = library;
            this.property = property;
        }

        protected override Task Execute(SmallBasicEngine engine)
        {
            return Libraries.Types[this.library].Properties[this.property].Setter(engine);
        }
    }

    internal sealed class LoadPropertyInstruction : BaseAsyncNonJumpInstruction
    {
        private readonly string library;
        private readonly string property;

        public LoadPropertyInstruction(string library, string property, TextRange range)
            : base(range)
        {
            this.library = library;
            this.property = property;
        }

        protected override Task Execute(SmallBasicEngine engine)
        {
            return Libraries.Types[this.library].Properties[this.property].Getter(engine);
        }
    }

    internal sealed class SetEventCallBackInstruction : BaseNonJumpInstruction
    {
        private readonly string library;
        private readonly string eventName;
        private readonly string subModule;

        public SetEventCallBackInstruction(string library, string eventName, string subModule, TextRange range)
            : base(range)
        {
            this.library = library;
            this.eventName = eventName;
            this.subModule = subModule;
        }

        protected override void Execute(SmallBasicEngine engine)
        {
            engine.SetEventCallback(this.library, this.eventName, this.subModule);
        }
    }
}
