namespace SmallBasic.Vsix.Editor.Outlining
{
    using System.ComponentModel.Composition;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Tagging;
    using Microsoft.VisualStudio.Utilities;
    using SmallBasic.Vsix.Services;

    [Export(typeof(ITaggerProvider))]
    [ContentType("smallbasic")]
    [TagType(typeof(IStructureTag))]
    internal sealed class SmallBasicOutliningTaggerProvider : ITaggerProvider
    {
        [Import]
        internal SmallBasicCompilationService CompilationService = null!;

        public ITagger<T> CreateTagger<T>(ITextBuffer buffer)
            where T : ITag
        {
            return buffer.Properties.GetOrCreateSingletonProperty(
                () => new SmallBasicStructureTagger(buffer, this.CompilationService)) as ITagger<T>;
        }
    }
}
