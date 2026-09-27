using System.Diagnostics;

namespace SmallBasic.Blazor.RunHost.Hosting;

internal static class BrowserLauncher
{
    public static void Open(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true,
        });
    }
}
