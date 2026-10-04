using System.Globalization;
using SmallBasic.Compiler.Runtime;

namespace SmallBasic.RunHost.Libraries;

/// <summary>
/// Shared pending-input plumbing of the <c>ITextWindowLibrary</c>
/// implementations: the queued <c>SetPendingInput</c> line consumed by
/// <c>Read</c>/<c>ReadNumber</c>. Numbers parse invariantly in every host, so
/// the console and browser runtimes cannot drift on decimal formatting.
/// Colors, the window title, clearing and writing stay host-specific.
/// </summary>
public abstract class TextWindowLibraryBase : ITextWindowLibrary
{
    private string pendingInput = string.Empty;

    public abstract string Get_BackgroundColor();

    public abstract void Set_BackgroundColor(string value);

    public abstract string Get_ForegroundColor();

    public abstract void Set_ForegroundColor(string value);

    public abstract string Get_Title();

    public abstract void Set_Title(string value);

    public abstract void Clear();

    public string Read()
    {
        string value = this.pendingInput;
        this.pendingInput = string.Empty;
        return value;
    }

    public decimal ReadNumber()
    {
        string value = this.Read();
        return decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal result)
            ? result
            : 0m;
    }

    public abstract Task Write(string data);

    public abstract Task WriteLine(string data);

    public void SetPendingInput(string value) => this.pendingInput = value;
}
