using System.Globalization;
using SmallBasic.Compiler.Runtime;
using SmallBasic.Editor.Libraries;
using SmallBasic.RunHost.Libraries;

namespace SmallBasic.Blazor.Client.Runtime;

public sealed class BrowserLibraries : IEngineLibraries, IDisposable
{
    private readonly ArrayLibrary array = new();
    private readonly ClockLibrary clock = new();
    private readonly UnsupportedControlsLibrary controls = new();
    private readonly UnsupportedDesktopLibrary desktop = new();
    private readonly DictionaryLibrary dictionary = new();
    private readonly UnsupportedFileLibrary file = new();
    private readonly UnsupportedFlickrLibrary flickr = new();
    private readonly BrowserImageListLibrary imageList = new();
    private readonly MathLibrary math = new();
    private readonly BrowserMouseLibrary mouse;
    private readonly UnsupportedNetworkLibrary network = new();
    private readonly BrowserProgramLibrary program = new();
    private readonly UnsupportedSoundLibrary sound = new();
    private readonly StackLibrary stack = new();
    private readonly TextLibrary text = new();
    private readonly TimerLibrary timer = new();

    public BrowserLibraries(RuntimeViewModel view)
    {
        var style = new GraphicsStyle();
        this.GraphicsWindow = new GraphicsWindowLibrary(view, style);
        this.Shapes = new ShapesLibrary(this.GraphicsWindow);
        this.Turtle = new TurtleLibrary(this.GraphicsWindow);
        this.TextWindow = new BrowserTextWindowLibrary(view);
        this.mouse = new BrowserMouseLibrary(this.GraphicsWindow);
    }

    public GraphicsWindowLibrary GraphicsWindow { get; }

    public ShapesLibrary Shapes { get; }

    public TurtleLibrary Turtle { get; }

    public BrowserTextWindowLibrary TextWindow { get; }

    IArrayLibrary IEngineLibraries.Array => this.array;
    IClockLibrary IEngineLibraries.Clock => this.clock;
    IControlsLibrary IEngineLibraries.Controls => this.controls;
    IDesktopLibrary IEngineLibraries.Desktop => this.desktop;
    IDictionaryLibrary IEngineLibraries.Dictionary => this.dictionary;
    IFileLibrary IEngineLibraries.File => this.file;
    IFlickrLibrary IEngineLibraries.Flickr => this.flickr;
    IGraphicsWindowLibrary IEngineLibraries.GraphicsWindow => this.GraphicsWindow;
    IImageListLibrary IEngineLibraries.ImageList => this.imageList;
    IMathLibrary IEngineLibraries.Math => this.math;
    IMouseLibrary IEngineLibraries.Mouse => this.mouse;
    INetworkLibrary IEngineLibraries.Network => this.network;
    IProgramLibrary IEngineLibraries.Program => this.program;
    IShapesLibrary IEngineLibraries.Shapes => this.Shapes;
    ISoundLibrary IEngineLibraries.Sound => this.sound;
    IStackLibrary IEngineLibraries.Stack => this.stack;
    ITextLibrary IEngineLibraries.Text => this.text;
    ITextWindowLibrary IEngineLibraries.TextWindow => this.TextWindow;
    ITimerLibrary IEngineLibraries.Timer => this.timer;
    ITurtleLibrary IEngineLibraries.Turtle => this.Turtle;

    public void Dispose() => this.timer.Dispose();
}

public sealed class BrowserProgramLibrary : IProgramLibrary
{
    public Task Delay(decimal milliSeconds) => Task.Delay(Math.Max(0, (int)milliSeconds));
    public void End() => throw new InvalidOperationException("Program.End is lowered by the compiler.");
    public void Pause() => throw new InvalidOperationException("Program.Pause is lowered by the compiler.");
}

public sealed class BrowserTextWindowLibrary : ITextWindowLibrary
{
    private readonly RuntimeViewModel view;
    private string backgroundColor = "Black";
    private string foregroundColor = "White";
    private string title = "Small Basic";
    private string pendingInput = string.Empty;

    public BrowserTextWindowLibrary(RuntimeViewModel view)
    {
        this.view = view;
    }

    public event Action<string>? Output;

    public string Get_BackgroundColor() => this.backgroundColor;
    public void Set_BackgroundColor(string value) => this.backgroundColor = value;
    public string Get_ForegroundColor() => this.foregroundColor;
    public void Set_ForegroundColor(string value) => this.foregroundColor = value;
    public string Get_Title() => this.title;
    public void Set_Title(string value) => this.title = value;
    public void Clear() => this.view.ClearText();

    public string Read()
    {
        string result = this.pendingInput;
        this.pendingInput = string.Empty;
        return result;
    }

    public decimal ReadNumber()
    {
        string value = this.Read();
        return decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal result) ? result : 0;
    }

    public Task Write(string data) { this.view.AppendText(data); this.Output?.Invoke(data); return Task.CompletedTask; }
    public Task WriteLine(string data) { string line = data + Environment.NewLine; this.view.AppendText(line); this.Output?.Invoke(line); return Task.CompletedTask; }
    public void SetPendingInput(string value) => this.pendingInput = value;
}

public sealed class BrowserImageListLibrary : IImageListLibrary
{
    public decimal GetHeightOfImage(string imageName) => 100;
    public decimal GetWidthOfImage(string imageName) => 100;
    public Task<string> LoadImage(string fileNameOrUrl) => Task.FromResult(fileNameOrUrl);
}

public sealed class BrowserMouseLibrary : IMouseLibrary
{
    private readonly GraphicsWindowLibrary graphics;

    public BrowserMouseLibrary(GraphicsWindowLibrary graphics)
    {
        this.graphics = graphics;
    }

    public bool Get_IsLeftButtonDown() => false;
    public bool Get_IsRightButtonDown() => false;
    public decimal Get_MouseX() => this.graphics.Get_MouseX();
    public decimal Get_MouseY() => this.graphics.Get_MouseY();
    public void HideCursor() { }
    public void ShowCursor() { }
}
