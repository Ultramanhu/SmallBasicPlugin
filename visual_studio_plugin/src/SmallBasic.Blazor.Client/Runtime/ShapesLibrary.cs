using SmallBasic.Compiler.Runtime;

namespace SmallBasic.Blazor.Client.Runtime;

public sealed class ShapesLibrary : IShapesLibrary
{
    private readonly GraphicsWindowLibrary graphics;
    private readonly Dictionary<string, GraphicElement> shapes = new(StringComparer.OrdinalIgnoreCase);
    private int nextId;

    public ShapesLibrary(GraphicsWindowLibrary graphics)
    {
        this.graphics = graphics;
        this.graphics.Cleared += this.shapes.Clear;
    }

    public string AddEllipse(decimal width, decimal height)
        => this.Add("Ellipse", this.graphics.NewElement("ellipse", width: width, height: height));

    public string AddImage(string imageName)
        => this.Add("Image", this.graphics.NewElement("image", width: 100, height: 100, href: imageName, stroke: "none"));

    public string AddLine(decimal x1, decimal y1, decimal x2, decimal y2)
        => this.Add("Line", this.graphics.NewElement("line", x1, y1, x2: x2, y2: y2, fill: "none"));

    public string AddRectangle(decimal width, decimal height)
        => this.Add("Rectangle", this.graphics.NewElement("rectangle", width: width, height: height));

    public string AddText(string text)
        => this.Add("Text", this.graphics.NewText(0, 0, text, 0));

    public string AddTriangle(decimal x1, decimal y1, decimal x2, decimal y2, decimal x3, decimal y3)
        => this.Add("Triangle", this.graphics.NewElement("triangle", points: $"{x1},{y1} {x2},{y2} {x3},{y3}"));

    public async Task Animate(string shapeName, decimal x, decimal y, decimal duration)
    {
        if (this.shapes.TryGetValue(shapeName, out GraphicElement? shape))
        {
            await Task.Delay(Math.Max(0, (int)duration));
            shape.TranslateX = x;
            shape.TranslateY = y;
            this.graphics.Refresh();
        }
    }

    public decimal GetLeft(string shapeName) => this.Find(shapeName)?.TranslateX ?? 0;
    public decimal GetOpacity(string shapeName) => this.Find(shapeName)?.Opacity ?? 0;
    public decimal GetTop(string shapeName) => this.Find(shapeName)?.TranslateY ?? 0;

    public void HideShape(string shapeName) => this.Update(shapeName, shape => shape.Visible = false);

    public void Move(string shapeName, decimal x, decimal y) => this.Update(shapeName, shape =>
    {
        shape.TranslateX = x;
        shape.TranslateY = y;
    });

    public void Remove(string shapeName)
    {
        if (this.shapes.Remove(shapeName, out GraphicElement? shape))
        {
            this.graphics.Remove(shape);
        }
    }

    public void Rotate(string shapeName, decimal angle) => this.Update(shapeName, shape => shape.Angle = angle % 360);
    public void SetOpacity(string shapeName, decimal level) => this.Update(shapeName, shape => shape.Opacity = Math.Clamp(level, 0, 100));
    public void SetText(string shapeName, string text) => this.Update(shapeName, shape => shape.Text = text);
    public void ShowShape(string shapeName) => this.Update(shapeName, shape => shape.Visible = true);

    public void Zoom(string shapeName, decimal scaleX, decimal scaleY) => this.Update(shapeName, shape =>
    {
        shape.ScaleX = Math.Clamp(scaleX, 0.1m, 20m);
        shape.ScaleY = Math.Clamp(scaleY, 0.1m, 20m);
    });

    private string Add(string prefix, GraphicElement element)
    {
        string name = $"{prefix}{++this.nextId}";
        element.ZIndex = 10;
        this.shapes.Add(name, element);
        this.graphics.Add(element);
        return name;
    }

    private GraphicElement? Find(string name) => this.shapes.TryGetValue(name, out GraphicElement? shape) ? shape : null;

    private void Update(string name, Action<GraphicElement> update)
    {
        if (this.shapes.TryGetValue(name, out GraphicElement? shape))
        {
            update(shape);
            this.graphics.Refresh();
        }
    }
}
