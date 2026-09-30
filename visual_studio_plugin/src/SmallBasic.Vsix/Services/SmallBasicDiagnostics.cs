namespace SmallBasic.Vsix.Services
{
    using System;
    using System.Globalization;
    using System.IO;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;

    /// <summary>
    /// Writes integration diagnostics to the "Small Basic" pane of the Output
    /// window (View &gt; Output) and to <see cref="LogPath"/>.
    /// </summary>
    /// <remarks>
    /// The navigation bar can only be verified inside a real Visual Studio
    /// instance, so every decision point reports what it saw.
    /// </remarks>
    internal static class SmallBasicDiagnostics
    {
        private static readonly Guid PaneGuid = new Guid("2C6D9F31-4B7A-4E28-9A5D-7F3B1C8E0A44");
        private static readonly object SyncRoot = new object();
        private static IVsOutputWindowPane outputPane;

        public static string LogPath { get; } =
            Path.Combine(Path.GetTempPath(), "SmallBasicVsix.log");

        public static void Write(string message)
        {
            string line = string.Format(
                CultureInfo.InvariantCulture,
                "{0:yyyy-MM-dd HH:mm:ss.fff}  {1}",
                DateTime.Now,
                message);

            lock (SyncRoot)
            {
                try
                {
                    File.AppendAllText(LogPath, line + Environment.NewLine);
                }
                catch (Exception)
                {
                }

                try
                {
                    IVsOutputWindowPane pane = GetOutputPane();
                    pane?.OutputStringThreadSafe(line + Environment.NewLine);
                }
                catch (Exception)
                {
                }
            }
        }

        private static IVsOutputWindowPane GetOutputPane()
        {
            if (outputPane != null)
            {
                return outputPane;
            }

            ThreadHelper.ThrowIfNotOnUIThread();
            var outputWindow = Package.GetGlobalService(typeof(SVsOutputWindow)) as IVsOutputWindow;
            if (outputWindow == null)
            {
                return null;
            }

            Guid paneGuid = PaneGuid;
            outputWindow.CreatePane(ref paneGuid, "Small Basic", 1, 1);
            if (outputWindow.GetPane(ref paneGuid, out IVsOutputWindowPane pane) == VSConstants.S_OK)
            {
                outputPane = pane;
            }

            return outputPane;
        }
    }
}
