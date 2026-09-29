namespace SmallBasic.Ext
{
    using System;
    using System.Runtime.InteropServices;
    using System.Threading;
    using Microsoft.VisualStudio.Shell;
    using SmallBasic.Vsix;
    using SmallBasic.Vsix.Editor.NavigationBar;
    using SmallBasic.Vsix.Services;
    using Task = System.Threading.Tasks.Task;

    /// <summary>
    /// Minimal in-proc compatibility package. It keeps the legacy language-service
    /// registration, editor MEF parts, and Open Folder debug plumbing alive while
    /// menus and tool windows move to VisualStudio.Extensibility.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("SmallBasic for Visual Studio (Extensibility)", "SmallBasic language support", SmallBasicVersion.Value)]
    [ProvideService(typeof(SmallBasicLanguageService), IsAsyncQueryable = true)]
    [ProvideLanguageService(typeof(SmallBasicLanguageService), "SmallBasic", 100, ShowDropDownOptions = true)]
    [ProvideLanguageExtension(typeof(SmallBasicLanguageService), ".sb")]
    [ProvideObject(typeof(SmallBasicLanguageService), RegisterUsing = RegistrationMethod.CodeBase)]
    [Guid(PackageGuidString)]
    public sealed class SmallBasicExtPackage : AsyncPackage
    {
        public const string PackageGuidString = "B2A8F1D6-8F88-4E90-9A34-487561F94801";

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken,
            IProgress<ServiceProgressData> progress)
        {
            await base.InitializeAsync(cancellationToken, progress).ConfigureAwait(false);

            this.AddService(
                typeof(SmallBasicLanguageService),
                CreateLanguageServiceAsync,
                promote: true);

            await this.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            SmallBasicDiagnostics.Write(
                $"extensibility package {SmallBasicVersion.Value} initialized from {typeof(SmallBasicExtPackage).Assembly.Location}");
        }

        private static System.Threading.Tasks.Task<object?> CreateLanguageServiceAsync(
            IAsyncServiceContainer container,
            CancellationToken cancellationToken,
            Type serviceType)
        {
            return System.Threading.Tasks.Task.FromResult<object?>(new SmallBasicLanguageService());
        }
    }
}