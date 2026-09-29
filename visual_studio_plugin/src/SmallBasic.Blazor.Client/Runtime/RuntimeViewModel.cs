namespace SmallBasic.Blazor.Client.Runtime;

public sealed class RuntimeViewModel
{
    private TaskCompletionSource<string> input = NewInput();

    public event Action? Changed;

    public GraphicsScene Graphics { get; } = new();

    public string ConsoleText { get; private set; } = string.Empty;

    public bool WaitingForInput { get; private set; }

    public bool WaitingForNumber { get; private set; }

    public string Status { get; private set; } = "Starting";

    public void AppendText(string value)
    {
        this.ConsoleText += value;
        this.NotifyChanged();
    }

    public void ClearText()
    {
        this.ConsoleText = string.Empty;
        this.NotifyChanged();
    }

    public void SetStatus(string value)
    {
        this.Status = value;
        this.NotifyChanged();
    }

    public Task<string> RequestInputAsync(bool number)
    {
        this.WaitingForInput = true;
        this.WaitingForNumber = number;
        this.NotifyChanged();
        return this.input.Task;
    }

    public void SubmitInput(string value)
    {
        if (!this.WaitingForInput)
        {
            return;
        }

        this.WaitingForInput = false;
        this.AppendText(value + Environment.NewLine);
        this.input.TrySetResult(value);
    }

    /// <summary>
    /// Drops console text, graphics and pending input so that the view can host a
    /// fresh session. Used by the web shell, which reuses one page for every run.
    /// </summary>
    public void Reset()
    {
        TaskCompletionSource<string> pending = this.input;
        this.input = NewInput();
        this.WaitingForInput = false;
        this.WaitingForNumber = false;
        this.ConsoleText = string.Empty;
        this.Status = "Ready";
        this.Graphics.Elements.Clear();
        this.Graphics.Visible = false;
        this.Graphics.Width = 640;
        this.Graphics.Height = 480;
        this.Graphics.Title = "Small Basic GraphicsWindow";
        this.Graphics.BackgroundColor = "#ffffff";

        // Releases a previous run that is still blocked on Read/ReadNumber.
        pending.TrySetResult(string.Empty);
        this.NotifyChanged();
    }

    public void NotifyChanged() => this.Changed?.Invoke();

    private static TaskCompletionSource<string> NewInput()
        => new(TaskCreationOptions.RunContinuationsAsynchronously);
}

public sealed class GraphicsScene
{
    public decimal Width { get; set; } = 640;

    public decimal Height { get; set; } = 480;

    public bool Visible { get; set; }

    public string Title { get; set; } = "Small Basic GraphicsWindow";

    public string BackgroundColor { get; set; } = "#ffffff";

    public List<GraphicElement> Elements { get; } = new();
}

public sealed class GraphicElement
{
    public required string Id { get; init; }

    public required string Kind { get; init; }

    public decimal X { get; set; }

    public decimal Y { get; set; }

    public decimal X2 { get; set; }

    public decimal Y2 { get; set; }

    public decimal Width { get; set; }

    public decimal Height { get; set; }

    public string Points { get; set; } = string.Empty;

    public string Text { get; set; } = string.Empty;

    public string Href { get; set; } = string.Empty;

    public string Stroke { get; set; } = "#000000";

    public string Fill { get; set; } = "none";

    public decimal StrokeWidth { get; set; } = 2;

    public string FontName { get; set; } = "Arial";

    public decimal FontSize { get; set; } = 12;

    public bool FontBold { get; set; }

    public bool FontItalic { get; set; }

    public decimal TranslateX { get; set; }

    public decimal TranslateY { get; set; }

    public decimal Angle { get; set; }

    public decimal ScaleX { get; set; } = 1;

    public decimal ScaleY { get; set; } = 1;

    public decimal Opacity { get; set; } = 100;

    public bool Visible { get; set; } = true;

    public int ZIndex { get; set; }

    public string Transform => $"translate({this.TranslateX} {this.TranslateY}) rotate({this.Angle}) scale({this.ScaleX} {this.ScaleY})";
}

public sealed class GraphicsStyle
{
    public string PenColor { get; set; } = "#000000";

    public decimal PenWidth { get; set; } = 2;

    public string BrushColor { get; set; } = "#4169e1";

    public string FontName { get; set; } = "Arial";

    public decimal FontSize { get; set; } = 12;

    public bool FontBold { get; set; }

    public bool FontItalic { get; set; }
}
