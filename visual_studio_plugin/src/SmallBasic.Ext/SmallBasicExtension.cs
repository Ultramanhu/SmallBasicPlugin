namespace SmallBasic.Ext
{
    using Microsoft.Extensions.DependencyInjection;
    using Microsoft.VisualStudio.Extensibility;

    [VisualStudioContribution]
    internal sealed class SmallBasicExtension : Extension
    {
        public override ExtensionConfiguration ExtensionConfiguration => new()
        {
            RequiresInProcessHosting = true,
        };

        protected override void InitializeServices(IServiceCollection serviceCollection)
        {
            base.InitializeServices(serviceCollection);
            serviceCollection.AddSingleton<SmallBasic.LanguageServices.SmallBasicLspAnalysisService>();
        }
    }
}