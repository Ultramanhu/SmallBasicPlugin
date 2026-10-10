using System.Globalization;
using SmallBasic.CompiledDebugAdapter;

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;

AppDomain.CreateDomain("Debuggee").DoCallBack(static () =>
{
    CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
    CompiledDebugAdapter.RunAsync().ConfigureAwait(false).GetAwaiter().GetResult();
});
