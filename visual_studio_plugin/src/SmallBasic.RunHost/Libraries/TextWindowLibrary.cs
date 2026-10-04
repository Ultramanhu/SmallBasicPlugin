using System.Globalization;
using System.IO;
using SmallBasic.Compiler.Runtime;

namespace SmallBasic.RunHost.Libraries;

public sealed class TextWindowLibrary : TextWindowLibraryBase
{
    private readonly TextReader input;
    private readonly TextWriter output;

    private string backgroundColorName = "Black";
    private string foregroundColorName = "White";
    private string title = "SmallBasic";

    public TextWindowLibrary(TextReader input, TextWriter output)
    {
        this.input = input;
        this.output = output;
    }

    public override string Get_BackgroundColor() => this.backgroundColorName;

    public override void Set_BackgroundColor(string value)
    {
        if (TryNormalizeColorName(value, out var name))
        {
            this.backgroundColorName = name;
        }
    }

    public override string Get_ForegroundColor() => this.foregroundColorName;

    public override void Set_ForegroundColor(string value)
    {
        if (TryNormalizeColorName(value, out var name))
        {
            this.foregroundColorName = name;
        }
    }

    public override string Get_Title() => this.title;

    public override void Set_Title(string value) => this.title = value;

    public override void Clear()
    {
        if (ReferenceEquals(this.output, Console.Out) && !Console.IsOutputRedirected)
        {
            Console.Clear();
        }
    }

    public override async Task Write(string data)
    {
        await this.output.WriteAsync(data).ConfigureAwait(false);
        await this.output.FlushAsync().ConfigureAwait(false);
    }

    public override async Task WriteLine(string data)
    {
        await this.output.WriteLineAsync(data).ConfigureAwait(false);
        await this.output.FlushAsync().ConfigureAwait(false);
    }

    private static bool TryNormalizeColorName(string value, out string normalized)
    {
        if (decimal.TryParse(value, NumberStyles.Integer, CultureInfo.CurrentCulture, out var number)
            && TryGetColorName(number, out normalized))
        {
            return true;
        }

        normalized = value;
        return Enum.GetNames(typeof(ConsoleColor)).Any(name => string.Equals(name, value, StringComparison.OrdinalIgnoreCase));
    }

    private static bool TryGetColorName(decimal number, out string result)
    {
        switch (number)
        {
            case 0: result = "Black"; return true;
            case 1: result = "DarkBlue"; return true;
            case 2: result = "DarkGreen"; return true;
            case 3: result = "DarkCyan"; return true;
            case 4: result = "DarkRed"; return true;
            case 5: result = "DarkMagenta"; return true;
            case 6: result = "DarkYellow"; return true;
            case 7: result = "Gray"; return true;
            case 8: result = "DarkGray"; return true;
            case 9: result = "Blue"; return true;
            case 10: result = "Green"; return true;
            case 11: result = "Cyan"; return true;
            case 12: result = "Red"; return true;
            case 13: result = "Magenta"; return true;
            case 14: result = "Yellow"; return true;
            case 15: result = "White"; return true;
            default: result = string.Empty; return false;
        }
    }
}
