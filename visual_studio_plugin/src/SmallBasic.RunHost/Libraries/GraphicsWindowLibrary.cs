using System.Reflection;
using Microsoft.SmallBasic.Library;
using Microsoft.SmallBasic.Library.Internal;
using SmallBasic.Compiler.Runtime;
using OfficialGraphicsWindow = Microsoft.SmallBasic.Library.GraphicsWindow;

namespace SmallBasic.RunHost.Libraries;

/// <summary>
/// Adapts the compiler runtime contract to Microsoft's official Small Basic
/// desktop library. Rendering, window lifetime, input and shape storage stay
/// inside SmallBasicLibrary.dll; this class only converts values and queues UI
/// callbacks onto the interpreter thread.
/// </summary>
public sealed class GraphicsWindowLibrary : IGraphicsWindowLibrary, IDisposable
{
    private readonly SmallBasicCallback keyDownHandler;
    private readonly SmallBasicCallback keyUpHandler;
    private readonly SmallBasicCallback mouseDownHandler;
    private readonly SmallBasicCallback mouseMoveHandler;
    private readonly SmallBasicCallback mouseUpHandler;
    private readonly SmallBasicCallback textInputHandler;
    private bool disposed;

    private static readonly Func<bool>? HasShutdownAccessor = CreateHasShutdownAccessor();

    /// <summary>
    /// True once the official library has shut its WPF dispatcher down, e.g. the
    /// user closed the graphics window. The debug adapter polls this to end the
    /// session gracefully instead of crashing on the next graphics call. The
    /// library only exposes this state internally, hence the reflection.
    /// </summary>
    public static bool HasShutdown => HasShutdownAccessor?.Invoke() == true;

    public GraphicsWindowLibrary()
    {
        SmallBasicApplication.BeginProgram();

        // The engine queues callbacks at instruction boundaries, so these WPF
        // dispatcher events can be forwarded immediately without touching the
        // interpreter's execution stack from the UI thread.
        this.keyDownHandler = () => this.KeyDown?.Invoke();
        this.keyUpHandler = () => this.KeyUp?.Invoke();
        this.mouseDownHandler = () => this.MouseDown?.Invoke();
        this.mouseMoveHandler = () => this.MouseMove?.Invoke();
        this.mouseUpHandler = () => this.MouseUp?.Invoke();
        this.textInputHandler = () => this.TextInput?.Invoke();

        OfficialGraphicsWindow.KeyDown += this.keyDownHandler;
        OfficialGraphicsWindow.KeyUp += this.keyUpHandler;
        OfficialGraphicsWindow.MouseDown += this.mouseDownHandler;
        OfficialGraphicsWindow.MouseMove += this.mouseMoveHandler;
        OfficialGraphicsWindow.MouseUp += this.mouseUpHandler;
        OfficialGraphicsWindow.TextInput += this.textInputHandler;
    }

    public event Action? KeyDown;
    public event Action? KeyUp;
    public event Action? MouseDown;
    public event Action? MouseMove;
    public event Action? MouseUp;
    public event Action? TextInput;

    public string Get_BackgroundColor() => OfficialGraphicsWindow.BackgroundColor;

    public void Set_BackgroundColor(string value) => OfficialGraphicsWindow.BackgroundColor = value;

    public string Get_BrushColor() => OfficialGraphicsWindow.BrushColor;

    public void Set_BrushColor(string value) => OfficialGraphicsWindow.BrushColor = value;

    public bool Get_FontBold() => OfficialGraphicsWindow.FontBold;

    public void Set_FontBold(bool value) => OfficialGraphicsWindow.FontBold = value;

    public bool Get_FontItalic() => OfficialGraphicsWindow.FontItalic;

    public void Set_FontItalic(bool value) => OfficialGraphicsWindow.FontItalic = value;

    public string Get_FontName() => OfficialGraphicsWindow.FontName;

    public void Set_FontName(string value) => OfficialGraphicsWindow.FontName = value;

    public decimal Get_FontSize() => ToDecimal(OfficialGraphicsWindow.FontSize);

    public void Set_FontSize(decimal value) => OfficialGraphicsWindow.FontSize = ToPrimitive(value);

    public Task<decimal> Get_Height() => Task.FromResult(ToDecimal(OfficialGraphicsWindow.Height));

    public Task Set_Height(decimal value)
    {
        OfficialGraphicsWindow.Height = ToPrimitive(value);
        return Task.CompletedTask;
    }

    public string Get_LastKey() => OfficialGraphicsWindow.LastKey;

    public string Get_LastText() => OfficialGraphicsWindow.LastText;

    public decimal Get_MouseX() => ToDecimal(OfficialGraphicsWindow.MouseX);

    public decimal Get_MouseY() => ToDecimal(OfficialGraphicsWindow.MouseY);

    public string Get_PenColor() => OfficialGraphicsWindow.PenColor;

    public void Set_PenColor(string value) => OfficialGraphicsWindow.PenColor = value;

    public decimal Get_PenWidth() => ToDecimal(OfficialGraphicsWindow.PenWidth);

    public void Set_PenWidth(decimal value) => OfficialGraphicsWindow.PenWidth = ToPrimitive(value);

    public string Get_Title() => OfficialGraphicsWindow.Title;

    public void Set_Title(string value) => OfficialGraphicsWindow.Title = value;

    public Task<decimal> Get_Width() => Task.FromResult(ToDecimal(OfficialGraphicsWindow.Width));

    public Task Set_Width(decimal value)
    {
        OfficialGraphicsWindow.Width = ToPrimitive(value);
        return Task.CompletedTask;
    }

    public void Clear() => OfficialGraphicsWindow.Clear();

    public void DrawBoundText(decimal x, decimal y, decimal width, string text)
        => OfficialGraphicsWindow.DrawBoundText(ToPrimitive(x), ToPrimitive(y), ToPrimitive(width), text);

    public void DrawEllipse(decimal x, decimal y, decimal width, decimal height)
        => OfficialGraphicsWindow.DrawEllipse(ToPrimitive(x), ToPrimitive(y), ToPrimitive(width), ToPrimitive(height));

    public void DrawImage(string imageName, decimal x, decimal y)
        => OfficialGraphicsWindow.DrawImage(imageName, ToPrimitive(x), ToPrimitive(y));

    public void DrawLine(decimal x1, decimal y1, decimal x2, decimal y2)
        => OfficialGraphicsWindow.DrawLine(ToPrimitive(x1), ToPrimitive(y1), ToPrimitive(x2), ToPrimitive(y2));

    public void DrawRectangle(decimal x, decimal y, decimal width, decimal height)
        => OfficialGraphicsWindow.DrawRectangle(ToPrimitive(x), ToPrimitive(y), ToPrimitive(width), ToPrimitive(height));

    public void DrawResizedImage(string imageName, decimal x, decimal y, decimal width, decimal height)
        => OfficialGraphicsWindow.DrawResizedImage(imageName, ToPrimitive(x), ToPrimitive(y), ToPrimitive(width), ToPrimitive(height));

    public void DrawText(decimal x, decimal y, string text)
        => OfficialGraphicsWindow.DrawText(ToPrimitive(x), ToPrimitive(y), text);

    public void DrawTriangle(decimal x1, decimal y1, decimal x2, decimal y2, decimal x3, decimal y3)
        => OfficialGraphicsWindow.DrawTriangle(ToPrimitive(x1), ToPrimitive(y1), ToPrimitive(x2), ToPrimitive(y2), ToPrimitive(x3), ToPrimitive(y3));

    public void FillEllipse(decimal x, decimal y, decimal width, decimal height)
        => OfficialGraphicsWindow.FillEllipse(ToPrimitive(x), ToPrimitive(y), ToPrimitive(width), ToPrimitive(height));

    public void FillRectangle(decimal x, decimal y, decimal width, decimal height)
        => OfficialGraphicsWindow.FillRectangle(ToPrimitive(x), ToPrimitive(y), ToPrimitive(width), ToPrimitive(height));

    public void FillTriangle(decimal x1, decimal y1, decimal x2, decimal y2, decimal x3, decimal y3)
        => OfficialGraphicsWindow.FillTriangle(ToPrimitive(x1), ToPrimitive(y1), ToPrimitive(x2), ToPrimitive(y2), ToPrimitive(x3), ToPrimitive(y3));

    public string GetColorFromRGB(decimal red, decimal green, decimal blue)
        => OfficialGraphicsWindow.GetColorFromRGB(ToPrimitive(red), ToPrimitive(green), ToPrimitive(blue));

    public string GetRandomColor() => OfficialGraphicsWindow.GetRandomColor();

    public void Hide() => OfficialGraphicsWindow.Hide();

    public void SetPixel(decimal x, decimal y, string color)
        => OfficialGraphicsWindow.SetPixel(ToPrimitive(x), ToPrimitive(y), color);

    public void Show() => OfficialGraphicsWindow.Show();

    public Task ShowMessage(string text, string title)
    {
        OfficialGraphicsWindow.ShowMessage(text, title);
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        if (this.disposed)
        {
            return;
        }

        this.disposed = true;
        OfficialGraphicsWindow.KeyDown -= this.keyDownHandler;
        OfficialGraphicsWindow.KeyUp -= this.keyUpHandler;
        OfficialGraphicsWindow.MouseDown -= this.mouseDownHandler;
        OfficialGraphicsWindow.MouseMove -= this.mouseMoveHandler;
        OfficialGraphicsWindow.MouseUp -= this.mouseUpHandler;
        OfficialGraphicsWindow.TextInput -= this.textInputHandler;
        SmallBasicApplication.EndProgram();
    }

    internal static Primitive ToPrimitive(decimal value) => new(value);

    internal static decimal ToDecimal(Primitive value) => Convert.ToDecimal((double)value);

    private static Func<bool>? CreateHasShutdownAccessor()
    {
        PropertyInfo? property = typeof(SmallBasicApplication).GetProperty("HasShutdown", BindingFlags.Static | BindingFlags.NonPublic);
        System.Reflection.MethodInfo? getter = property?.GetGetMethod(nonPublic: true);
        return getter is null ? null : (Func<bool>)Delegate.CreateDelegate(typeof(Func<bool>), getter);
    }
}
