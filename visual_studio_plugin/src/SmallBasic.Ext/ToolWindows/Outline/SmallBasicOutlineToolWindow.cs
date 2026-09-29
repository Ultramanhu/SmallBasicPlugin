namespace SmallBasic.Ext.ToolWindows.Outline
{
    using System;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.VisualStudio.Extensibility;
    using Microsoft.VisualStudio.Extensibility.ToolWindows;
    using Microsoft.VisualStudio.RpcContracts.RemoteUI;

    [VisualStudioContribution]
    internal sealed class SmallBasicOutlineToolWindow : ToolWindow
    {
        private readonly SmallBasicOutlineControl content = new SmallBasicOutlineControl();

        public SmallBasicOutlineToolWindow(VisualStudioExtensibility extensibility)
            : base(extensibility)
        {
            this.Title = "Small Basic Document Outline";
        }

        public override ToolWindowConfiguration ToolWindowConfiguration => new()
        {
            Placement = ToolWindowPlacement.Floating,
            DockDirection = Dock.Right,
            AllowAutoCreation = false,
        };

        public override Task InitializeAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public override Task<IRemoteUserControl> GetContentAsync(CancellationToken cancellationToken)
            => Task.FromResult<IRemoteUserControl>(this.content);

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                this.content.Dispose();
            }

            base.Dispose(disposing);
        }
    }
}