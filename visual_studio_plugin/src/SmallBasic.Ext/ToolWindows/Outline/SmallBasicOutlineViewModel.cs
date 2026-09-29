namespace SmallBasic.Ext.ToolWindows.Outline
{
    using System;
    using System.IO;
    using System.Linq;
    using System.Runtime.Serialization;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.VisualStudio.Extensibility.UI;
    using SmallBasic.LanguageServices.Outline;

    [DataContract]
    internal sealed class SmallBasicOutlineViewModel : NotifyPropertyChangedObject
    {
        private string statusText = "单击 Refresh 以加载当前 Small Basic 文档的大纲。";

        public SmallBasicOutlineViewModel()
        {
            this.Items = new ObservableList<SmallBasicOutlineEntry>();
            this.RefreshCommand = new AsyncCommand((parameter, cancellationToken) => this.RefreshAsync(cancellationToken));
        }

        [DataMember]
        public ObservableList<SmallBasicOutlineEntry> Items { get; }

        [DataMember]
        public string StatusText
        {
            get => this.statusText;
            set => this.SetProperty(ref this.statusText, value);
        }

        [DataMember]
        public AsyncCommand RefreshCommand { get; }

        public async Task RefreshAsync(CancellationToken cancellationToken)
        {
            this.StatusText = "正在加载文档大纲…";

            (string? filePath, string? sourceText, string? errorMessage) =
                await SmallBasicOutlineDocumentService.TryReadPreferredDocumentAsync(cancellationToken).ConfigureAwait(false);

            this.Items.Clear();
            if (!string.IsNullOrEmpty(errorMessage) || string.IsNullOrEmpty(filePath) || sourceText == null)
            {
                this.StatusText = errorMessage ?? "无法加载文档大纲。";
                return;
            }

            string resolvedFilePath = filePath;
            foreach (SmallBasicOutlineNodeInfo node in SmallBasicOutlineBuilder.Build(sourceText, resolvedFilePath))
            {
                this.Items.Add(this.CreateEntry(node));
            }

            string fileName = Path.GetFileName(resolvedFilePath);
            this.StatusText = this.Items.Count == 0
                ? $"{fileName} 中没有可显示的大纲项。"
                : $"已加载 {CountNodes(this.Items)} 个大纲项（{fileName}）。";
        }

        private static int CountNodes(System.Collections.Generic.IEnumerable<SmallBasicOutlineEntry> items)
        {
            return items.Sum(item => 1 + CountNodes(item.Children));
        }

        private SmallBasicOutlineEntry CreateEntry(SmallBasicOutlineNodeInfo node)
        {
            var entry = new SmallBasicOutlineEntry(node, this.NavigateToEntryAsync);
            foreach (SmallBasicOutlineNodeInfo child in node.Children)
            {
                entry.Children.Add(CreateEntry(child));
            }

            return entry;
        }

        private Task NavigateToEntryAsync(SmallBasicOutlineEntry entry, CancellationToken cancellationToken)
        {
            this.StatusText = $"跳转到 {entry.DisplayText} ({entry.LocationText})";
            return SmallBasicOutlineDocumentService.NavigateAsync(entry.FilePath, entry.Line, entry.Column, cancellationToken);
        }
    }

    [DataContract]
    internal sealed class SmallBasicOutlineEntry
    {
        public SmallBasicOutlineEntry(
            SmallBasicOutlineNodeInfo node,
            Func<SmallBasicOutlineEntry, CancellationToken, Task> navigateAsync)
        {
            this.DisplayText = node.DisplayText;
            this.FilePath = node.FilePath;
            this.Line = node.Line;
            this.Column = node.Column;
            this.LocationText = $"L{node.Line + 1}, C{node.Column + 1}";
            this.Children = new ObservableList<SmallBasicOutlineEntry>();
            this.NavigateCommand = new AsyncCommand((parameter, cancellationToken) => navigateAsync(this, cancellationToken));
        }

        [DataMember]
        public string DisplayText { get; }

        [DataMember]
        public string LocationText { get; }

        [DataMember]
        public ObservableList<SmallBasicOutlineEntry> Children { get; }

        [DataMember]
        public AsyncCommand NavigateCommand { get; }

        public string FilePath { get; }

        public int Line { get; }

        public int Column { get; }
    }
}