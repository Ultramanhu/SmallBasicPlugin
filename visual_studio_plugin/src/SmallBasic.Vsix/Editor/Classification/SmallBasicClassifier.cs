namespace SmallBasic.Vsix.Editor.Classification
{
    using System;
    using System.Collections.Generic;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Classification;
    using SmallBasic.Compiler.Services;
    using SmallBasic.Vsix.Services;

    internal sealed class SmallBasicClassifier : IClassifier
    {
        private readonly ITextBuffer buffer;
        private readonly SmallBasicCompilationService compilationService;
        private readonly IDictionary<string, IClassificationType> classificationTypes;
        private readonly IClassificationType functionType;
        private int cachedVersionNumber = -1;
        private HashSet<string> cachedProcedureNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public SmallBasicClassifier(
            ITextBuffer buffer,
            IClassificationTypeRegistryService registry,
            SmallBasicCompilationService compilationService)
        {
            this.buffer = buffer;
            this.compilationService = compilationService;
            this.functionType = registry.GetClassificationType(SmallBasicClassificationNames.Function);
            this.classificationTypes = new Dictionary<string, IClassificationType>(StringComparer.Ordinal)
            {
                [SmallBasicClassificationNames.Keyword] = registry.GetClassificationType(SmallBasicClassificationNames.Keyword),
                [SmallBasicClassificationNames.String] = registry.GetClassificationType(SmallBasicClassificationNames.String),
                [SmallBasicClassificationNames.Number] = registry.GetClassificationType(SmallBasicClassificationNames.Number),
                [SmallBasicClassificationNames.Comment] = registry.GetClassificationType(SmallBasicClassificationNames.Comment),
                [SmallBasicClassificationNames.Library] = registry.GetClassificationType(SmallBasicClassificationNames.Library),
            };

            this.buffer.Changed += (sender, args) =>
            {
                this.ClassificationChanged?.Invoke(this, new ClassificationChangedEventArgs(new SnapshotSpan(args.After, 0, args.After.Length)));
            };
        }

        public event EventHandler<ClassificationChangedEventArgs>? ClassificationChanged;

        public IList<ClassificationSpan> GetClassificationSpans(SnapshotSpan span)
        {
            var results = new List<ClassificationSpan>();
            HashSet<string> procedureNames = this.GetProcedureNames();

            foreach (SmallBasicTokenSpan token in SmallBasicSimpleLexer.Scan(span.Snapshot))
            {
                var tokenSpan = new SnapshotSpan(span.Snapshot, token.Start, token.Length);
                if (!tokenSpan.IntersectsWith(span))
                {
                    continue;
                }

                if (token.ClassificationName == SmallBasicClassificationNames.Identifier)
                {
                    // Procedure names — both the `Sub Foo` declaration and every
                    // `Foo()` call — use the function colour, matching the
                    // "function" semantic token of the VS Code extension.
                    if (this.functionType != null
                        && procedureNames.Contains(span.Snapshot.GetText(token.Start, token.Length)))
                    {
                        results.Add(new ClassificationSpan(tokenSpan, this.functionType));
                    }

                    continue;
                }

                if (this.classificationTypes.TryGetValue(token.ClassificationName, out IClassificationType classificationType))
                {
                    results.Add(new ClassificationSpan(tokenSpan, classificationType));
                }
            }

            return results;
        }

        private HashSet<string> GetProcedureNames()
        {
            int versionNumber = this.buffer.CurrentSnapshot.Version.VersionNumber;
            if (this.cachedVersionNumber == versionNumber)
            {
                return this.cachedProcedureNames;
            }

            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                foreach (OutlineItem item in this.compilationService.GetCompilation(this.buffer).GetOutlineItems())
                {
                    if (item.Kind == OutlineItemKind.Procedure)
                    {
                        names.Add(item.Name);
                    }
                }
            }
            catch (Exception)
            {
                // Classification must never throw; fall back to "no procedures".
                names.Clear();
            }

            this.cachedVersionNumber = versionNumber;
            this.cachedProcedureNames = names;
            return names;
        }
    }
}
