namespace SmallBasic.Vsix
{
    using System;
    using System.ComponentModel.Design;
    using System.Runtime.InteropServices;
    using System.Threading;
    using Microsoft.VisualStudio.Shell;
    using SmallBasic.Vsix.Commands;
    using Task = System.Threading.Tasks.Task;

    /// <summary>
    /// Registers explicit C# and JavaScript run/debug commands in Visual Studio's
    /// Tools menu. The editor command filter keeps F5/Ctrl+F5 on the C# backend.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("SmallBasic for Visual Studio", "SmallBasic language support", "0.1.1")]
    // Increment this version whenever Menus.vsct changes so Visual Studio does
    // not reuse a stale command-table cache after an extension update.
    [ProvideMenuResource("Menus.ctmenu", 2)]
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
            await this.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            if (await this.GetServiceAsync(typeof(IMenuCommandService)) is OleMenuCommandService commandService)
            {
                AddCommand(commandService, 0x0100, () => SmallBasicCommandService.RunActiveDocument(SmallBasicBackend.CSharp));
                AddCommand(commandService, 0x0101, () => SmallBasicCommandService.DebugActiveDocument(SmallBasicBackend.CSharp));
                AddCommand(commandService, 0x0102, () => SmallBasicCommandService.RunActiveDocument(SmallBasicBackend.JavaScript));
                AddCommand(commandService, 0x0103, () => SmallBasicCommandService.DebugActiveDocument(SmallBasicBackend.JavaScript));
            }
        }

        private static void AddCommand(OleMenuCommandService commandService, int commandId, Action execute)
        {
            var menuCommandId = new CommandID(CommandSet, commandId);
            commandService.AddCommand(new MenuCommand((_, _) => execute(), menuCommandId));
        }
    }
}
