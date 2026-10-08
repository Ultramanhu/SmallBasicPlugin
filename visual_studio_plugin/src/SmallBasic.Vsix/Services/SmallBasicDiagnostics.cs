namespace SmallBasic.Vsix.Services
{
    using System;
    using System.Globalization;
    using System.IO;
    using System.Runtime.InteropServices;
    using Microsoft.VisualStudio;
    using Microsoft.VisualStudio.Imaging;
    using Microsoft.VisualStudio.Imaging.Interop;
    using Microsoft.VisualStudio.Shell;
    using Microsoft.VisualStudio.Shell.Interop;
    using Microsoft.Win32;

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

        /// <summary>
        /// Reports whether the .sb file icon chain works: the moniker string used
        /// by SmallBasicIcons.pkgdef has to parse, the WPF resource referenced by
        /// SmallBasicIcons.imagemanifest has to be loadable, and the shell has to
        /// report that same moniker for a .sb file.
        /// </summary>
        public static void ProbeFileIconMoniker()
        {
            string monikerText = FileIconGuid.ToString("D") + ":" + FileIconId.ToString(CultureInfo.InvariantCulture);
            try
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                var imageService = Package.GetGlobalService(typeof(SVsImageService)) as IVsImageService2;
                if (imageService == null)
                {
                    Write("[probe] IVsImageService2 unavailable");
                }
                else
                {
                    bool parsedOk = imageService.TryParseImageMoniker(monikerText, out ImageMoniker parsed);
                    Write($"[probe] TryParseImageMoniker(\"{monikerText}\") -> {parsedOk} guid={parsed.Guid} id={parsed.Id}");

                    string probeFile = Path.Combine(Path.GetTempPath(), "smallbasic-icon-probe.sb");
                    try
                    {
                        File.WriteAllText(probeFile, "TextWindow.WriteLine(\"probe\")");
                        ImageMoniker fileMoniker = imageService.GetImageMonikerForFile(probeFile);
                        Write($"[probe] GetImageMonikerForFile(.sb) -> guid={fileMoniker.Guid} id={fileMoniker.Id}");
                    }
                    catch (Exception ex)
                    {
                        Write("[probe] GetImageMonikerForFile failed: " + ex.GetType().Name + ": " + ex.Message);
                    }
                    finally
                    {
                        try
                        {
                            File.Delete(probeFile);
                        }
                        catch (Exception)
                        {
                        }
                    }
                }

                ProbeResource("/SmallBasic.Vsix;Component/Icons/SmallBasicFileIcon.16.16.png");
                ProbeResource("/SmallBasic.Vsix;Component/Icons/SmallBasicFileIcon.32.32.png");
            }
            catch (Exception ex)
            {
                Write("[probe] image service failed: " + ex.GetType().Name + ": " + ex.Message);
            }
        }

        /// <summary>
        /// Reports which language nodes the shell sees under
        /// Tools &gt; Options &gt; Text Editor. The tree is built from
        /// AutomationProperties\TextEditor, which pkgdef merging writes into the
        /// instance's private registry hive; VSRegistry is the only API that
        /// exposes that hive to in-process code.
        /// </summary>
        public static void ProbeEditorOptions(IServiceProvider serviceProvider)
        {
            foreach (__VsLocalRegistryType registryType in new[]
            {
                __VsLocalRegistryType.RegType_Configuration,
                __VsLocalRegistryType.RegType_UserSettings,
            })
            {
                try
                {
                    RegistryKey root = VSRegistry.RegistryRoot(serviceProvider, registryType, false);
                    if (root == null)
                    {
                        Write($"[probe] RegistryRoot({registryType}) = null");
                        continue;
                    }

                    Write($"[probe] RegistryRoot({registryType}) = {root.Name}");
                    using (RegistryKey textEditor = root.OpenSubKey(@"AutomationProperties\TextEditor"))
                    {
                        if (textEditor == null)
                        {
                            Write($"[probe] {registryType}: no AutomationProperties\\TextEditor");
                        }
                        else
                        {
                            Write($"[probe] {registryType}: TextEditor = [{string.Join(", ", textEditor.GetSubKeyNames())}]");
                            using (RegistryKey smallBasic = textEditor.OpenSubKey("SmallBasic"))
                            {
                                Write(smallBasic == null
                                    ? $"[probe] {registryType}: SmallBasic node MISSING"
                                    : $"[probe] {registryType}: SmallBasic node OK [{string.Join(", ", smallBasic.GetValueNames())}]");
                            }
                        }
                    }

                    using (RegistryKey smallBasicLanguage = root.OpenSubKey(@"Languages\Language Services\SmallBasic"))
                    {
                        Write(smallBasicLanguage == null
                            ? $"[probe] {registryType}: Languages\\Language Services\\SmallBasic MISSING"
                            : $"[probe] {registryType}: language service OK [{string.Join(", ", smallBasicLanguage.GetValueNames())}]");
                    }
                }
                catch (Exception ex)
                {
                    Write($"[probe] RegistryRoot({registryType}) failed: {ex.GetType().Name}: {ex.Message}");
                }
            }

            LogTextEditorNodes(Registry.CurrentUser, "HKCU");
        }

        private static readonly Guid FileIconGuid = new Guid("57c89fbb-6dd2-49b1-ad07-e02f072f65b9");

        private const int FileIconId = 1;

        /// <summary>
        /// Loads one of the image manifest resources through the very WPF pack URI
        /// the image service uses, which is the part that silently fails when a
        /// bitmap source has no usable size metadata.
        /// </summary>
        private static void ProbeResource(string componentUri)
        {
            try
            {
                var uri = new Uri("pack://application:,,,/" + componentUri.TrimStart('/'), UriKind.Absolute);
                var image = new System.Windows.Media.Imaging.BitmapImage();
                image.BeginInit();
                image.UriSource = uri;
                image.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                image.EndInit();
                Write($"[probe] pack {componentUri} -> {image.PixelWidth}x{image.PixelHeight}");
            }
            catch (Exception ex)
            {
                Write($"[probe] pack {componentUri} -> FAILED {ex.GetType().Name}: {ex.Message}");
            }
        }

        private static void LogTextEditorNodes(RegistryKey root, string label)
        {
            try
            {
                using (RegistryKey visualStudio = root.OpenSubKey(@"Software\Microsoft\VisualStudio"))
                {
                    if (visualStudio == null)
                    {
                        Write($"[probe] {label}: Software\\Microsoft\\VisualStudio missing");
                        return;
                    }

                    Write($"[probe] {label}: instances = [{string.Join(", ", visualStudio.GetSubKeyNames())}]");
                }
            }
            catch (Exception ex)
            {
                Write($"[probe] {label} registry read failed: {ex.GetType().Name}: {ex.Message}");
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
