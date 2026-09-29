namespace SmallBasic.Vsix.Services
{
    using System.Collections.Concurrent;
    using System.ComponentModel.Composition;
    using Microsoft.VisualStudio.Text;
    using SmallBasic.Compiler;

    [Export(typeof(SmallBasicCompilationService))]
    internal sealed class SmallBasicCompilationService
    {
        private readonly ConcurrentDictionary<ITextBuffer, CacheEntry> cache = new ConcurrentDictionary<ITextBuffer, CacheEntry>();

        public SmallBasicCompilation GetCompilation(ITextBuffer buffer)
        {
            ITextSnapshot snapshot = buffer.CurrentSnapshot;
            if (this.cache.TryGetValue(buffer, out CacheEntry existing) && existing.VersionNumber == snapshot.Version.VersionNumber)
            {
                return existing.Compilation;
            }

            var compilation = new SmallBasicCompilation(snapshot.GetText());
            this.cache[buffer] = new CacheEntry(snapshot.Version.VersionNumber, compilation);
            return compilation;
        }

        private sealed class CacheEntry
        {
            public CacheEntry(int versionNumber, SmallBasicCompilation compilation)
            {
                this.VersionNumber = versionNumber;
                this.Compilation = compilation;
            }

            public int VersionNumber { get; }

            public SmallBasicCompilation Compilation { get; }
        }
    }
}
