namespace SmallBasic.Vsix.ToolWindows.Outline
{
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.VisualStudio.Extensibility.UI;

    internal sealed class SmallBasicOutlineControl : RemoteUserControl
    {
        public SmallBasicOutlineControl()
            : base(dataContext: new SmallBasicOutlineViewModel())
        {
        }

        public override async Task ControlLoadedAsync(CancellationToken cancellationToken)
        {
            await base.ControlLoadedAsync(cancellationToken).ConfigureAwait(false);

            if (this.DataContext is SmallBasicOutlineViewModel viewModel)
            {
                await viewModel.RefreshAsync(cancellationToken).ConfigureAwait(false);
            }
        }
    }
}