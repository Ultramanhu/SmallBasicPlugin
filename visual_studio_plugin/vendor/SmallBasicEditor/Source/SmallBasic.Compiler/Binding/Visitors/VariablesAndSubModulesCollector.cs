// <copyright file="VariablesAndSubModulesCollector.cs" company="MIT License">
// Licensed under the MIT License. See LICENSE file in the project root for license information.
// </copyright>

namespace SmallBasic.Compiler.Binding
{
    using System;
    using System.Collections.Generic;
    using System.Linq;

    internal sealed class VariablesAndSubModulesCollector : BaseBoundNodeVisitor
    {
        private readonly HashSet<string> names = new HashSet<string>();
        private HashSet<string> currentLocals = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public VariablesAndSubModulesCollector(Binder binder)
        {
            this.Visit(binder.MainModule);
            foreach (var subModule in binder.SubModules.Values)
            {
                var subModuleLocals = new List<string>(
                    subModule.Syntax.Parameters.Select(parameter => parameter.IdentifierToken.Text));
                subModuleLocals.AddRange(subModule.Locals);
                this.VisitProcedure(subModule.Body, subModuleLocals);
            }

            foreach (var function in binder.Functions.Values)
            {
                var locals = new List<string>(function.Parameters);
                locals.AddRange(function.Locals);
                this.VisitProcedure(function.Body, locals);
            }
        }

        public IReadOnlyCollection<string> Names => this.names;

        private protected override void VisitArrayAssignmentStatement(BoundArrayAssignmentStatement node)
        {
            this.AddVariable(node.Array.Name);
            base.VisitArrayAssignmentStatement(node);
        }

        private protected override void VisitVariableAssignmentStatement(BoundVariableAssignmentStatement node)
        {
            this.AddVariable(node.Variable.Name);
            base.VisitVariableAssignmentStatement(node);
        }

        private protected override void VisitSubModule(BoundSubModule node)
        {
            base.VisitSubModule(node);
        }

        private protected override void VisitFunction(BoundFunction node)
        {
            base.VisitFunction(node);
        }

        private void AddVariable(string name)
        {
            if (!this.currentLocals.Contains(name))
            {
                this.names.Add(name);
            }
        }

        private void VisitProcedure(BoundStatementBlock body, IReadOnlyList<string> locals)
        {
            HashSet<string> previous = this.currentLocals;
            this.currentLocals = new HashSet<string>(locals, StringComparer.OrdinalIgnoreCase);
            this.Visit(body);
            this.currentLocals = previous;
        }
    }
}
