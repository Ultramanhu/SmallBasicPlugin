// <copyright file="SmallBasicEngine.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.Linq;
    using System.Threading.Tasks;
    using SmallBasic.Compiler.Binding;
    using SmallBasic.Compiler.Runtime;
    using SmallBasic.Utilities;

    public enum ExecutionMode
    {
        RunToEnd,
        Debug,
        NextLine
    }

    public enum ExecutionState
    {
        Running,
        Paused,
        BlockedOnStringInput,
        BlockedOnNumberInput,
        Terminated,
    }

    public sealed class SmallBasicEngine
    {
        private readonly SmallBasicCompilation compilation;
        private readonly ConcurrentDictionary<string, string> eventCallbacks;
        private readonly ConcurrentQueue<string> pendingEventCallbacks;

        public SmallBasicEngine(SmallBasicCompilation compilation, IEngineLibraries libraries)
        {
            Debug.Assert(!compilation.Diagnostics.Any(), "Cannot execute a compilation with errors.");

            this.compilation = compilation;
            this.eventCallbacks = new ConcurrentDictionary<string, string>(StringComparer.CurrentCultureIgnoreCase);
            this.pendingEventCallbacks = new ConcurrentQueue<string>();

            this.CurrentSourceLine = 0;

            this.Mode = ExecutionMode.RunToEnd;
            this.State = ExecutionState.Running;
            this.ExecutionStack = new LinkedList<Frame>();
            this.EvaluationStack = new Stack<BaseValue>();
            this.Memory = new Dictionary<string, BaseValue>();
            this.Modules = new Dictionary<string, RuntimeModule>();
            this.Libraries = libraries;

            this.Libraries.SetEventCallbacks(this);

            RuntimeModule mainModule = this.EmitAndSaveModule("Program", compilation.MainModule);
            foreach (BoundSubModule subModule in compilation.SubModules.Values)
            {
                this.EmitAndSaveModule(subModule.Name, subModule.Body);
            }

            this.ExecutionStack.AddLast(new Frame(mainModule));
        }

        public ExecutionMode Mode { get; set; }

        public ExecutionState State { get; private set; }

        public int CurrentSourceLine { get; private set; }

        internal LinkedList<Frame> ExecutionStack { get; private set; }

        internal Stack<BaseValue> EvaluationStack { get; private set; }

        internal Dictionary<string, BaseValue> Memory { get; private set; }

        internal Dictionary<string, RuntimeModule> Modules { get; private set; }

        internal IEngineLibraries Libraries { get; private set; }

        public DebuggerSnapshot GetSnapshot()
        {
            return new DebuggerSnapshot(this.CurrentSourceLine, this.ExecutionStack, this.Memory);
        }

        public async Task Execute()
        {
            Debug.Assert(this.State == ExecutionState.Running || this.State == ExecutionState.Paused, "Engine is not in a executable state.");

            while (this.State == ExecutionState.Running)
            {
                this.DispatchPendingEvents();

                if (this.ExecutionStack.Count == 0)
                {
                    if (!this.compilation.Analysis.ListensToEvents)
                    {
                        this.Terminate();
                    }

                    break;
                }

                Frame frame = this.ExecutionStack.Last();
                if (frame.InstructionIndex == frame.Module.Instructions.Count)
                {
                    this.ExecutionStack.RemoveLast();
                    continue;
                }

                BaseInstruction instruction = frame.Module.Instructions[frame.InstructionIndex];
                int instructionLine = instruction.Range.Start.Line;

                bool shouldPause = this.Mode == ExecutionMode.NextLine && this.CurrentSourceLine != instructionLine;
                this.CurrentSourceLine = instructionLine;

                if (shouldPause)
                {
                    this.Pause();
                    return;
                }
                else
                {
                    await instruction.Execute(this, frame).ConfigureAwait(false);
                }
            }
        }

        // Evaluates a compiled expression (for example a conditional breakpoint
        // condition) against the current memory. The execution stack, evaluation
        // stack and engine state are restored afterwards, so the paused program is
        // left untouched. Returns null when the expression cannot be evaluated.
        public async Task<bool?> EvaluateConditionAsync(CompiledExpression expression)
        {
            BaseValue result = await this.EvaluateExpressionAsync(expression).ConfigureAwait(false);
            return result?.ToBoolean();
        }

        private async Task<BaseValue> EvaluateExpressionAsync(CompiledExpression expression)
        {
            RuntimeModule module = expression.Module;
            ExecutionState savedState = this.State;
            int savedLine = this.CurrentSourceLine;
            bool hadPrevious = this.Memory.TryGetValue(expression.ResultVariable, out BaseValue previous);

            var frame = new Frame(module);
            this.ExecutionStack.AddLast(frame);
            int targetDepth = this.ExecutionStack.Count;

            try
            {
                // Bounds the loop in case a library method blocks on input without
                // advancing the frame pointer.
                int steps = 0;
                int maxSteps = (module.Instructions.Count * 1000) + 1000;

                while (this.ExecutionStack.Count >= targetDepth)
                {
                    Frame current = this.ExecutionStack.Last();
                    if (current.InstructionIndex >= current.Module.Instructions.Count)
                    {
                        if (this.ExecutionStack.Count == targetDepth)
                        {
                            break;
                        }

                        this.ExecutionStack.RemoveLast();
                        continue;
                    }

                    if (++steps > maxSteps)
                    {
                        return null;
                    }

                    await current.Module.Instructions[current.InstructionIndex].Execute(this, current).ConfigureAwait(false);

                    if (this.State == ExecutionState.Terminated)
                    {
                        return null;
                    }
                }

                return this.Memory.TryGetValue(expression.ResultVariable, out BaseValue result) ? result : null;
            }
            finally
            {
                while (this.ExecutionStack.Count > targetDepth - 1)
                {
                    this.ExecutionStack.RemoveLast();
                }

                if (hadPrevious)
                {
                    this.Memory[expression.ResultVariable] = previous;
                }
                else
                {
                    this.Memory.Remove(expression.ResultVariable);
                }

                this.EvaluationStack.Clear();
                this.State = savedState;
                this.CurrentSourceLine = savedLine;
            }
        }

        public void InputReceived()
        {
            switch (this.State)
            {
                case ExecutionState.BlockedOnNumberInput:
                case ExecutionState.BlockedOnStringInput:
                    this.State = ExecutionState.Running;
                    break;
                default:
                    throw ExceptionUtilities.UnexpectedValue(this.State);
            }
        }

        public void Pause()
        {
            if (this.Mode != ExecutionMode.RunToEnd)
            {
                this.State = ExecutionState.Paused;
            }
        }

        public void Continue()
        {
            if (this.Mode != ExecutionMode.RunToEnd)
            {
                this.State = ExecutionState.Running;
            }
        }

        public void Terminate()
        {
            this.State = ExecutionState.Terminated;
            this.ExecutionStack.Clear();
        }

        internal void SetEventCallback(string library, string eventName, string subModule)
        {
            this.eventCallbacks[$"{library}.{eventName}"] = subModule;
        }

        internal void RaiseEvent(string library, string eventName)
        {
            if (this.eventCallbacks.TryGetValue($"{library}.{eventName}", out string subModule))
            {
                // Library events can originate on a WPF dispatcher or timer
                // thread. Mutating the execution stack from those threads can
                // corrupt the interpreter, so only queue the callback here.
                this.pendingEventCallbacks.Enqueue(subModule);
            }
        }

        internal void BlockOnStringInput()
        {
            this.State = ExecutionState.BlockedOnStringInput;
        }

        internal void BlockOnNumberInput()
        {
            this.State = ExecutionState.BlockedOnNumberInput;
        }

        private void DispatchPendingEvents()
        {
            // Only process events that were pending at this instruction
            // boundary. A continuously firing timer must not starve normal
            // program instructions.
            int pendingCount = this.pendingEventCallbacks.Count;
            for (int i = 0; i < pendingCount && this.pendingEventCallbacks.TryDequeue(out string subModule); i++)
            {
                var existing = this.ExecutionStack.Take(this.ExecutionStack.Count - 1).FirstOrDefault(frame => frame.Module.Name == subModule);
                if (!existing.IsDefault())
                {
                    this.ExecutionStack.Remove(existing);
                }

                // The last frame is the active frame. Event callbacks must be
                // pushed on top of it so they can interrupt a long-running main
                // loop (for example GraphicsWindow.KeyDown in Tetris).
                this.ExecutionStack.AddLast(new Frame(this.Modules[subModule]));
            }
        }

        private RuntimeModule EmitAndSaveModule(string name, BoundStatementBlock body)
        {
            ModuleEmitter emitter = new ModuleEmitter(body);
            RuntimeModule module = new RuntimeModule(name, emitter.Instructions, body.Syntax);

            this.Modules.Add(module.Name, module);
            return module;
        }
    }
}
