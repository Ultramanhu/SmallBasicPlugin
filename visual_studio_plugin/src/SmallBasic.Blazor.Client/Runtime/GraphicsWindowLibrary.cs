using System.Globalization;
using SmallBasic.Compiler.Runtime;

namespace SmallBasic.Blazor.Client.Runtime;

public sealed class GraphicsWindowLibrary : IGraphicsWindowLibrary
{
    private static readonly Random Random = new();
    private readonly RuntimeViewModel view;
    private readonly GraphicsStyle style;
    private int nextId;
    private string lastKey = string.Empty;
    private string lastText = string.Empty;
    private decimal mouseX;
    private decimal mouseY;

    public GraphicsWindowLibrary(RuntimeViewModel view, GraphicsStyle style)
    {
        this.view = view;
        this.style = style;
    }

    public event Action? KeyDown;
    public event Action? KeyUp;
    public event Action? MouseDown;
    public event Action? MouseMove;
    public event Action? MouseUp;
    public event Action? TextInput;

    internal event Action? Cleared;

    public string Get_BackgroundColor() => this.view.Graphics.BackgroundColor;
    public string Get_BrushColor() => this.style.BrushColor;
    public bool Get_FontBold() => this.style.FontBold;
    public bool Get_FontItalic() => this.style.FontItalic;
    public string Get_FontName() => this.style.FontName;
    public decimal Get_FontSize() => this.style.FontSize;
    public Task<decimal> Get_Height() => Task.FromResult(this.view.Graphics.Height);
    public string Get_LastKey() => this.lastKey;
    public string Get_LastText() => this.lastText;
    public decimal Get_MouseX() => this.mouseX;
    public decimal Get_MouseY() => this.mouseY;
    public string Get_PenColor() => this.style.PenColor;
    public decimal Get_PenWidth() => this.style.PenWidth;
    public string Get_Title() => this.view.Graphics.Title;
    public Task<decimal> Get_Width() => Task.FromResult(this.view.Graphics.Width);

    public void Set_BackgroundColor(string value) => this.Change(() => this.view.Graphics.BackgroundColor = Color(value));
    public void Set_BrushColor(string value) => this.style.BrushColor = Color(value);
    public void Set_FontBold(bool value) => this.style.FontBold = value;
    public void Set_FontItalic(bool value) => this.style.FontItalic = value;
    public void Set_FontName(string value) => this.style.FontName = string.IsNullOrWhiteSpace(value) ? "Arial" : value.Trim();
    public void Set_FontSize(decimal value) => this.style.FontSize = Math.Max(1, value);
    public Task Set_Height(decimal value) { this.Change(() => this.view.Graphics.Height = Math.Max(1, value)); return Task.CompletedTask; }
    public void Set_PenColor(string value) => this.style.PenColor = Color(value);
    public void Set_PenWidth(decimal value) => this.style.PenWidth = Math.Max(0, value);
    public void Set_Title(string value) => this.Change(() => this.view.Graphics.Title = value);
    public Task Set_Width(decimal value) { this.Change(() => this.view.Graphics.Width = Math.Max(1, value)); return Task.CompletedTask; }

    public void Clear() => this.Change(() =>
    {
        this.view.Graphics.Elements.Clear();
        this.Cleared?.Invoke();
    });

    public void DrawBoundText(decimal x, decimal y, decimal width, string text)
        => this.Add(this.NewText(x, y, text, width));

    public void DrawEllipse(decimal x, decimal y, decimal width, decimal height)
        => this.Add(this.NewElement("ellipse", x, y, width, height, "none", this.style.PenColor));

    public void DrawImage(string imageName, decimal x, decimal y)
        => this.Add(this.NewElement("image", x, y, this.view.Graphics.Width, this.view.Graphics.Height, "none", "none", href: imageName));

    public void DrawLine(decimal x1, decimal y1, decimal x2, decimal y2)
        => this.Add(this.NewElement("line", x1, y1, x2: x2, y2: y2, fill: "none", stroke: this.style.PenColor));

    public void DrawRectangle(decimal x, decimal y, decimal width, decimal height)
        => this.Add(this.NewElement("rectangle", x, y, width, height, "none", this.style.PenColor));

    public void DrawResizedImage(string imageName, decimal x, decimal y, decimal width, decimal height)
        => this.Add(this.NewElement("image", x, y, width, height, "none", "none", href: imageName));

    public void DrawText(decimal x, decimal y, string text) => this.Add(this.NewText(x, y, text, 0));

    public void DrawTriangle(decimal x1, decimal y1, decimal x2, decimal y2, decimal x3, decimal y3)
        => this.Add(this.NewElement("triangle", points: Points(x1, y1, x2, y2, x3, y3), fill: "none", stroke: this.style.PenColor));

    public void FillEllipse(decimal x, decimal y, decimal width, decimal height)
        => this.Add(this.NewElement("ellipse", x, y, width, height, this.style.BrushColor, "none"));

    public void FillRectangle(decimal x, decimal y, decimal width, decimal height)
        => this.Add(this.NewElement("rectangle", x, y, width, height, this.style.BrushColor, "none"));

    public void FillTriangle(decimal x1, decimal y1, decimal x2, decimal y2, decimal x3, decimal y3)
        => this.Add(this.NewElement("triangle", points: Points(x1, y1, x2, y2, x3, y3), fill: this.style.BrushColor, stroke: "none"));

    public string GetColorFromRGB(decimal red, decimal green, decimal blue)
        => $"#{Clamp(red):X2}{Clamp(green):X2}{Clamp(blue):X2}";

    public string GetRandomColor() => $"#{Random.Next(0x1000000):X6}";

    public void Hide() => this.Change(() => this.view.Graphics.Visible = false);

    public void SetPixel(decimal x, decimal y, string color)
        => this.Add(this.NewElement("line", x, y, x2: x + 1, y2: y, fill: "none", stroke: Color(color), strokeWidth: 1));

    public void Show() => this.Change(() => this.view.Graphics.Visible = true);

    public Task ShowMessage(string text, string title)
    {
        this.view.AppendText($"[{title}] {text}{Environment.NewLine}");
        return Task.CompletedTask;
    }

    public void HandleKeyDown(string key)
    {
        this.lastKey = key;
        this.KeyDown?.Invoke();
        if (key.Length == 1)
        {
            this.lastText = key;
            this.TextInput?.Invoke();
        }
    }

    public void HandleKeyUp(string key)
    {
        this.lastKey = key;
        this.KeyUp?.Invoke();
    }

    public void HandleMouseMove(decimal x, decimal y) { this.mouseX = x; this.mouseY = y; this.MouseMove?.Invoke(); }
    public void HandleMouseDown(decimal x, decimal y) { this.mouseX = x; this.mouseY = y; this.MouseDown?.Invoke(); }
    public void HandleMouseUp(decimal x, decimal y) { this.mouseX = x; this.mouseY = y; this.MouseUp?.Invoke(); }

    internal GraphicElement NewElement(
        string kind,
        decimal x = 0,
        decimal y = 0,
        decimal width = 0,
        decimal height = 0,
        string? fill = null,
        string? stroke = null,
        decimal x2 = 0,
        decimal y2 = 0,
        string points = "",
        string href = "",
        decimal? strokeWidth = null)
        => new()
        {
            Id = $"graphic-{++this.nextId}", Kind = kind, X = x, Y = y, X2 = x2, Y2 = y2,
            Width = width, Height = height, Points = points, Href = href,
            Fill = fill ?? this.style.BrushColor, Stroke = stroke ?? this.style.PenColor,
            StrokeWidth = strokeWidth ?? this.style.PenWidth, FontName = this.style.FontName,
            FontSize = this.style.FontSize, FontBold = this.style.FontBold, FontItalic = this.style.FontItalic,
        };

    internal GraphicElement NewText(decimal x, decimal y, string text, decimal width)
    {
        GraphicElement element = this.NewElement("text", x, y, width, fill: this.style.BrushColor, stroke: "none");
        element.Text = text;
        return element;
    }

    internal void Add(GraphicElement element) => this.Change(() => this.view.Graphics.Elements.Add(element));

    internal void Remove(GraphicElement element) => this.Change(() => this.view.Graphics.Elements.Remove(element));

    internal void Refresh() => this.Change(() => { });

    private static string Points(params decimal[] values) => string.Join(" ", values.Chunk(2).Select(pair => string.Join(",", pair.Select(value => value.ToString(CultureInfo.InvariantCulture)))));
    private static int Clamp(decimal value) => (int)Math.Clamp(value, 0, 255);

    private static string Color(string value)
    {
        string trimmed = value.Trim();
        return KnownColors.TryGetValue(trimmed, out string? color) ? color : trimmed;
    }

    private static readonly IReadOnlyDictionary<string, string> KnownColors = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["Transparent"] = "transparent", ["Black"] = "#000000", ["White"] = "#ffffff", ["Red"] = "#ff0000",
        ["Green"] = "#008000", ["Blue"] = "#0000ff", ["Yellow"] = "#ffff00", ["Orange"] = "#ffa500",
        ["Purple"] = "#800080", ["Pink"] = "#ffc0cb", ["Gray"] = "#808080", ["Grey"] = "#808080",
        ["Cyan"] = "#00ffff", ["Magenta"] = "#ff00ff", ["Brown"] = "#a52a2a", ["Lime"] = "#00ff00",
    };

    private void Change(Action update)
    {
        update();
        this.view.Graphics.Visible = true;
        this.view.NotifyChanged();
    }
}
