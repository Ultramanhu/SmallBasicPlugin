namespace SmallBasic.Vsix
{
    using System;
    using System.Runtime.InteropServices;
    using System.Threading;
    using Microsoft.VisualStudio.Shell;
    using SmallBasic.Vsix.Editor.NavigationBar;
    using SmallBasic.Vsix.Services;
    using Task = System.Threading.Tasks.Task;

    /// <summary>
    /// In-proc compatibility package of the hybrid extension. It provides the legacy
    /// language-service registration chain (the native navigation bar depends on it)
    /// while menus, commands, the outline tool window and LSP language features are
    /// served through VisualStudio.Extensibility.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("SmallBasic for Visual Studio", "SmallBasic language support", SmallBasicVersion.Value)]
    [ProvideBindingPath]
    [ProvideService(typeof(SmallBasicLanguageService), IsAsyncQueryable = true)]
    [ProvideLanguageService(typeof(SmallBasicLanguageService), "SmallBasic", 100, ShowDropDownOptions = true)]
    [ProvideLanguageExtension(typeof(SmallBasicLanguageService), ".sb")]
    [ProvideObject(typeof(SmallBasicLanguageService), RegisterUsing = RegistrationMethod.CodeBase)]
    [Guid(PackageGuidString)]
    public sealed class SmallBasicPackage : AsyncPackage
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
                $"package {SmallBasicVersion.Value} initialized from {typeof(SmallBasicPackage).Assembly.Location}");

            // Both the .sb file icon and the "Text Editor" options node are pure
            // registry registrations, so verify from inside the running instance
            // that the shell really sees them.
            SmallBasicDiagnostics.ProbeFileIconMoniker();
            SmallBasicDiagnostics.ProbeEditorOptions(this);
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