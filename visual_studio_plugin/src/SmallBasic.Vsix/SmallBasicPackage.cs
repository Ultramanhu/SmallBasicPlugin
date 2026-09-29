namespace SmallBasic.Vsix
{
    using System;
    using System.ComponentModel.Design;
    using System.Runtime.InteropServices;
    using System.Threading;
    using Microsoft.VisualStudio.Shell;
    using SmallBasic.Vsix.Commands;
    using SmallBasic.Vsix.Editor.NavigationBar;
    using SmallBasic.Vsix.Services;
    using Task = System.Threading.Tasks.Task;

    /// <summary>
    /// Registers explicit C#, JavaScript and Blazor run/debug commands in Visual Studio's
    /// Tools menu. The editor command filter reuses the most recently selected backend.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("SmallBasic for Visual Studio", "SmallBasic language support", SmallBasicVersion.Value)]
    // Increment this version whenever Menus.vsct changes so Visual Studio does
    // not reuse a stale command-table cache after an extension update.
    [ProvideMenuResource("Menus.ctmenu", 7)]
    [ProvideService(typeof(SmallBasicLanguageService), IsAsyncQueryable = true)]
    [ProvideLanguageService(typeof(SmallBasicLanguageService), "SmallBasic", 100, ShowDropDownOptions = true)]
    [ProvideLanguageExtension(typeof(SmallBasicLanguageService), ".sb")]
    [ProvideObject(typeof(SmallBasicLanguageService), RegisterUsing = RegistrationMethod.CodeBase)]
    [Guid(PackageGuidString)]
    public sealed class SmallBasicPackage : AsyncPackage
    {
        public const string PackageGuidString = "6E7C57A3-C7AD-4E3E-8B37-21AD5C8EC3D1";
        public const string CommandSetGuidString = "9F9C24AA-EF08-4E53-962B-C84406360C9C";

        private static readonly Guid CommandSet = new Guid(CommandSetGuidString);

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken,
            IProgress<ServiceProgressData> progress)
        {
            await base.InitializeAsync(cancellationToken, progress).ConfigureAwait(false);

            // ProvideLanguageService only writes the language-service registry
            // entries. The package must also proffer the service instance or VS
            // cannot ask it for an IVsCodeWindowManager, and AddAdornments (the
            // native navigation-bar hook) is never reached.
            this.AddService(
                typeof(SmallBasicLanguageService),
                CreateLanguageServiceAsync,
                promote: true);

            await this.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            SmallBasicDiagnostics.Write(
                $"extension {SmallBasicVersion.Value} initialized from {typeof(SmallBasicPackage).Assembly.Location}");
            if (await this.GetServiceAsync(typeof(IMenuCommandService)).ConfigureAwait(true) is OleMenuCommandService commandService)
            {
                AddCommand(commandService, 0x0100, () => SmallBasicCommandService.RunActiveDocument(SmallBasicBackend.CSharp));
                AddCommand(commandService, 0x0101, () => SmallBasicCommandService.DebugActiveDocument(SmallBasicBackend.CSharp));
                AddCommand(commandService, 0x0102, () => SmallBasicCommandService.RunActiveDocument(SmallBasicBackend.JavaScript));
                AddCommand(commandService, 0x0103, () => SmallBasicCommandService.DebugActiveDocument(SmallBasicBackend.JavaScript));
                AddCommand(commandService, 0x0105, () => SmallBasicCommandService.RunActiveDocument(SmallBasicBackend.Blazor));
                AddCommand(commandService, 0x0106, () => SmallBasicCommandService.DebugActiveDocument(SmallBasicBackend.Blazor));
            }
        }

        private static System.Threading.Tasks.Task<object?> CreateLanguageServiceAsync(
            IAsyncServiceContainer container,
            CancellationToken cancellationToken,
            Type serviceType)
        {
            SmallBasicDiagnostics.Write("language service created");
            return System.Threading.Tasks.Task.FromResult<object?>(new SmallBasicLanguageService());
        }

        private static void AddCommand(OleMenuCommandService commandService, int commandId, Action execute)
        {
            var menuCommandId = new CommandID(CommandSet, commandId);
            commandService.AddCommand(new MenuCommand((_, _) => execute(), menuCommandId));
        }
    }
}
