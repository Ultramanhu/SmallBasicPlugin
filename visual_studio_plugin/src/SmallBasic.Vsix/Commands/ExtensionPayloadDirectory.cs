namespace SmallBasic.Vsix.Commands
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.IO;

    /// <summary>
    /// Locates the VSIX payload (run hosts and the debug adapter).
    /// </summary>
    /// <remarks>
    /// The extension assembly is not always loaded from the VSIX layout: Visual
    /// Studio also stages a minimal container next to it
    /// (<c>Extensions\&lt;random&gt;.&lt;suffix&gt;\</c>) that only carries the
    /// extension assemblies. The folder next to <see cref="System.Reflection.Assembly.Location"/>
    /// therefore cannot be trusted to contain <c>runhost\</c> or
    /// <c>debugadapter\</c>, so when the payload is missing there the deployed
    /// layout is looked up under the same experimental-instance extension root.
    /// </remarks>
    internal static class ExtensionPayloadDirectory
    {
        private static readonly string[] PayloadMarkers =
        {
            Path.Combine("runhost", "csharp", "SmallBasic.RunHost.exe"),
            Path.Combine("runhost", "javascript", "smallbasic-runhost.js"),
            Path.Combine("runhost", "blazor", "SmallBasic.Blazor.RunHost.dll"),
            Path.Combine("debugadapter", "adapter.js"),
        };

        private static string? resolved;

        /// <summary>
        /// Directory that carries the run hosts and the debug adapter. Falls back to
        /// the folder of the loaded assembly when no deployed layout is found, so the
        /// existing "reinstall the VSIX" diagnostics keep pointing at the real path.
        /// </summary>
        public static string Resolve()
        {
            if (resolved != null)
            {
                return resolved;
            }

            string loaded = Path.GetDirectoryName(typeof(ExtensionPayloadDirectory).Assembly.Location) ?? string.Empty;
            resolved = HasPayload(loaded)
                ? loaded
                : FindDeployedLayout(loaded) ?? loaded;
            return resolved;
        }

        internal static bool HasPayload(string directory)
        {
            if (string.IsNullOrEmpty(directory) || !Directory.Exists(directory))
            {
                return false;
            }

            foreach (string marker in PayloadMarkers)
            {
                if (File.Exists(Path.Combine(directory, marker)))
                {
                    return true;
                }
            }

            return false;
        }

        private static string? FindDeployedLayout(string loadedDirectory)
        {
            string? extensionsRoot = FindExtensionsRoot(loadedDirectory);
            if (extensionsRoot == null)
            {
                return null;
            }

            string loadedVersion = ReadAssemblyVersion(Path.Combine(loadedDirectory, "SmallBasic.Vsix.dll"));
            string? versionMatch = null;
            string? anyMatch = null;
            DateTime versionMatchTime = DateTime.MinValue;
            DateTime anyMatchTime = DateTime.MinValue;

            foreach (string directory in EnumerateDirectories(extensionsRoot, maxDepth: 4))
            {
                string extensionAssembly = Path.Combine(directory, "SmallBasic.Vsix.dll");
                if (!File.Exists(extensionAssembly)
                    || string.Equals(directory, loadedDirectory, StringComparison.OrdinalIgnoreCase)
                    || !HasPayload(directory))
                {
                    continue;
                }

                DateTime written = File.GetLastWriteTimeUtc(extensionAssembly);
                if (written > anyMatchTime)
                {
                    anyMatchTime = written;
                    anyMatch = directory;
                }

                if (!string.IsNullOrEmpty(loadedVersion)
                    && written > versionMatchTime
                    && string.Equals(ReadAssemblyVersion(extensionAssembly), loadedVersion, StringComparison.OrdinalIgnoreCase))
                {
                    versionMatchTime = written;
                    versionMatch = directory;
                }
            }

            return versionMatch ?? anyMatch;
        }

        private static string? FindExtensionsRoot(string directory)
        {
            for (int depth = 0; depth < 6 && !string.IsNullOrEmpty(directory); depth++)
            {
                if (string.Equals(Path.GetFileName(directory), "Extensions", StringComparison.OrdinalIgnoreCase))
                {
                    return directory;
                }

                directory = Path.GetDirectoryName(directory) ?? string.Empty;
            }

            return null;
        }

        private static IEnumerable<string> EnumerateDirectories(string root, int maxDepth)
        {
            var pending = new Queue<(string Path, int Depth)>();
            pending.Enqueue((root, 0));
            while (pending.Count > 0)
            {
                (string path, int depth) = pending.Dequeue();
                yield return path;

                if (depth >= maxDepth)
                {
                    continue;
                }

                string[] children;
                try
                {
                    children = Directory.GetDirectories(path);
                }
                catch (Exception)
                {
                    // Unreadable folders (locked or access denied) are not payloads.
                    continue;
                }

                foreach (string child in children)
                {
                    pending.Enqueue((child, depth + 1));
                }
            }
        }

        private static string ReadAssemblyVersion(string filePath)
        {
            try
            {
                if (!File.Exists(filePath))
                {
                    return string.Empty;
                }

                Version? version = System.Reflection.AssemblyName.GetAssemblyName(filePath)?.Version;
                return version != null
                    ? version.ToString()
                    : FileVersionInfo.GetVersionInfo(filePath).FileVersion ?? string.Empty;
            }
            catch (Exception)
            {
                return string.Empty;
            }
        }
    }
}
