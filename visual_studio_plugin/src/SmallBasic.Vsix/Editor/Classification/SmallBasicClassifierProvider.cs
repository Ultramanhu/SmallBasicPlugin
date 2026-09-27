namespace SmallBasic.Vsix.Editor.Classification
{
    using System.ComponentModel.Composition;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Classification;
    using Microsoft.VisualStudio.Utilities;
    using SmallBasic.Vsix.Services;

    [Export(typeof(IClassifierProvider))]
    [ContentType("smallbasic")]
    internal sealed class SmallBasicClassifierProvider : IClassifierProvider
    {
        [Import]
        internal IClassificationTypeRegistryService ClassificationRegistry = null!;

        [Import]
        internal SmallBasicCompilationService CompilationService = null!;

        public IClassifier GetClassifier(ITextBuffer textBuffer)
        {
            return textBuffer.Properties.GetOrCreateSingletonProperty(
                () => new SmallBasicClassifier(textBuffer, this.ClassificationRegistry, this.CompilationService));
        }
    }
}
