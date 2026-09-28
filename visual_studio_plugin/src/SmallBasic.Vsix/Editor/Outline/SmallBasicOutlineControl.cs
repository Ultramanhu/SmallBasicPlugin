namespace SmallBasic.Vsix.Editor.Outline
{
    using System;
    using System.Collections.Generic;
    using System.Windows;
    using System.Windows.Controls;
    using System.Windows.Input;
    using System.Windows.Threading;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.ComponentModelHost;
    using Microsoft.VisualStudio.Editor;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
    using Microsoft.VisualStudio.Text;
    using Microsoft.VisualStudio.Text.Editor;
    using Microsoft.VisualStudio.TextManager.Interop;
    using SmallBasic.Compiler.Services;
    using SmallBasic.Vsix.Services;

    /// <summary>
    /// Tree view showing the procedures and variable first uses of the active
    /// SmallBasic document. Double-clicking an entry navigates to it.
    /// </summary>
    internal sealed class SmallBasicOutlineControl : UserControl
    {
        private readonly TreeView tree = new TreeView();
        private readonly TextBlock status = new TextBlock();
        private readonly DispatcherTimer timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(900) };
        private ITextBuffer? buffer;
        private IWpfTextView? textView;
        private bool noViewLogged;

        public SmallBasicOutlineControl()
        {
            var refresh = new Button
            {
                Content = "刷新",
                Padding = new Thickness(10, 2, 10, 2),
                Margin = new Thickness(0, 0, 6, 0),
            };
            refresh.Click += (sender, args) => this.Refresh();

            this.status.VerticalAlignment = VerticalAlignment.Center;
            this.status.Margin = new Thickness(2, 0, 0, 0);
            this.status.Text = "打开一个 Small Basic (.sb) 文件以查看大纲。";

            var header = new Grid { Margin = new Thickness(6, 6, 6, 4) };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(refresh, 0);
            Grid.SetColumn(this.status, 1);
            header.Children.Add(refresh);
            header.Children.Add(this.status);

            var panel = new DockPanel { LastChildFill = true };
            DockPanel.SetDock(header, Dock.Top);
            panel.Children.Add(header);
            panel.Children.Add(this.tree);
            this.Content = panel;

            // The editor has no "active document changed" event that a tool window
            // can subscribe to directly, so poll cheaply while the window is open.
            this.timer.Tick += (sender, args) => this.SyncActiveDocument(forceRebuild: false);
            this.Loaded += (sender, args) =>
            {
                this.timer.Start();
                this.Refresh();
            };
            this.Unloaded += (sender, args) => this.timer.Stop();
        }

        /// <summary>Re-reads the active document and rebuilds the outline.</summary>
        public void Refresh()
        {
            this.SyncActiveDocument(forceRebuild: true);
        }

        private void SyncActiveDocument(bool forceRebuild)
        {
            if (!this.Dispatcher.CheckAccess())
            {
                this.Dispatcher.BeginInvoke(new Action(() => this.SyncActiveDocument(forceRebuild)));
                return;
            }

            var changed = false;
            IWpfTextView? view = TryGetActiveSmallBasicView();
            if (view == null && !this.noViewLogged)
            {
                this.noViewLogged = true;
                SmallBasicDiagnostics.Write("outline window: no active Small Basic view detected");
            }

            if (view == null)
            {
                this.noViewLogged = true;

                if (this.buffer != null)
                {
                    this.buffer.Changed -= this.OnBufferChanged;
                    this.buffer = null;
                    changed = true;
                }

                if (this.textView != null)
                {
                    this.textView = null;
                    changed = true;
                }
            }
            else
            {
                this.noViewLogged = false;
                ITextBuffer active = view.TextBuffer;
                if (!ReferenceEquals(active, this.buffer))
                {
                    if (this.buffer != null)
                    {
                        this.buffer.Changed -= this.OnBufferChanged;
                    }

                    this.buffer = active;
                    this.buffer.Changed += this.OnBufferChanged;
                    changed = true;
                }

                this.textView = view;
            }

            if (changed || forceRebuild)
            {
                this.Rebuild();
            }
        }

        private static IWpfTextView? TryGetActiveSmallBasicView()
        {
            try
            {
                var textManager = ServiceProvider.GlobalProvider.GetService(typeof(SVsTextManager)) as IVsTextManager;
                if (textManager == null
                    || textManager.GetActiveView(0, null, out IVsTextView vsView) != VSConstants.S_OK
                    || vsView == null)
                {
                    return null;
                }

                var componentModel = ServiceProvider.GlobalProvider.GetService(typeof(SComponentModel)) as IComponentModel;
                IWpfTextView? view = componentModel?.GetService<IVsEditorAdaptersFactoryService>()?.GetWpfTextView(vsView);
                if (view == null || !view.TextBuffer.ContentType.IsOfType("smallbasic"))
                {
                    return null;
                }

                return view;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static SmallBasicCompilationService? GetCompilationService()
        {
            var componentModel = ServiceProvider.GlobalProvider.GetService(typeof(SComponentModel)) as IComponentModel;
            return componentModel?.GetService<SmallBasicCompilationService>();
        }

        private void OnBufferChanged(object sender, TextContentChangedEventArgs e)
        {
            if (!this.Dispatcher.CheckAccess())
            {
                this.Dispatcher.BeginInvoke(new Action(this.Rebuild));
                return;
            }

            this.Rebuild();
        }

        private void Rebuild()
        {
            this.tree.Items.Clear();

            if (this.buffer == null)
            {
                this.status.Text = "打开一个 Small Basic (.sb) 文件以查看大纲。";
                return;
            }

            try
            {
                SmallBasicCompilationService? service = GetCompilationService();
                if (service == null)
                {
                    this.status.Text = "无法获取编译服务（诊断见 视图 > 输出 > Small Basic）。";
                    SmallBasicDiagnostics.Write("outline window: SmallBasicCompilationService unavailable");
                    return;
                }

                IReadOnlyList<OutlineItem> items = service.GetCompilation(this.buffer).GetOutlineItems();

                foreach (OutlineItem item in items)
                {
                    this.tree.Items.Add(this.CreateNode(item));
                }

                var procedures = 0;
                var variables = 0;
                CountItems(items, ref procedures, ref variables);
                this.status.Text = items.Count == 0
                    ? "当前文档没有过程或变量。"
                    : $"过程 {procedures} · 变量 {variables} · 顶级 {items.Count}";
                SmallBasicDiagnostics.Write(
                    $"outline window: procedures={procedures}, variables={variables}, topLevel={items.Count}");
            }
            catch (Exception ex)
            {
                this.status.Text = "无法生成大纲：" + ex.Message;
                SmallBasicDiagnostics.Write("outline window failed: " + ex);
            }
        }

        private static void CountItems(IReadOnlyList<OutlineItem> items, ref int procedures, ref int variables)
        {
            foreach (OutlineItem item in items)
            {
                if (item.Kind == OutlineItemKind.Procedure)
                {
                    procedures++;
                }
                else
                {
                    variables++;
                }

                CountItems(item.Children, ref procedures, ref variables);
            }
        }

        private TreeViewItem CreateNode(OutlineItem item)
        {
            bool isProcedure = item.Kind == OutlineItemKind.Procedure;
            var node = new TreeViewItem
            {
                Header = isProcedure ? $"Sub {item.Name}" : item.Name,
                Tag = item,
                IsExpanded = isProcedure,
            };

            node.MouseDoubleClick += this.OnNodeDoubleClick;
            foreach (OutlineItem child in item.Children)
            {
                node.Items.Add(this.CreateNode(child));
            }

            return node;
        }

        private void OnNodeDoubleClick(object sender, MouseButtonEventArgs e)
        {
            if (sender is TreeViewItem node && node.Tag is OutlineItem item)
            {
                this.Navigate(item);
                e.Handled = true;
            }
        }

        private void Navigate(OutlineItem item)
        {
            IWpfTextView? view = this.textView;
            if (view == null)
            {
                return;
            }

            ITextSnapshot snapshot = view.TextSnapshot;
            int lineNumber = Math.Min(item.SelectionRange.Start.Line, snapshot.LineCount - 1);
            if (lineNumber < 0)
            {
                return;
            }

            ITextSnapshotLine line = snapshot.GetLineFromLineNumber(lineNumber);
            int column = Math.Min(item.SelectionRange.Start.Column, line.Length);
            var point = new SnapshotPoint(snapshot, line.Start.Position + column);
            view.Caret.MoveTo(point);
            view.ViewScroller.EnsureSpanVisible(new SnapshotSpan(point, point.Position < snapshot.Length ? 1 : 0));
            view.VisualElement.Focus();
        }
    }
}
