using SmallBasic.Compiler.Runtime;

namespace SmallBasic.Blazor.Client.Runtime;

public sealed class TurtleLibrary : ITurtleLibrary
{
    private readonly GraphicsWindowLibrary graphics;
    private readonly GraphicElement turtle;
    private bool initialized;
    private bool penDown;
    private decimal x = 320;
    private decimal y = 240;
    private decimal angle;
    private decimal speed = 5;
    private bool added;

    public TurtleLibrary(GraphicsWindowLibrary graphics)
    {
        this.graphics = graphics;
        this.turtle = graphics.NewElement("turtle", points: "0,-18 13,14 0,8 -13,14", fill: "#22c55e", stroke: "#14532d");
        this.turtle.ZIndex = 30;
        this.turtle.Visible = false;
        this.turtle.TranslateX = this.x;
        this.turtle.TranslateY = this.y;
        this.graphics.Cleared += this.OnCleared;
    }

    public decimal Get_Angle() => this.angle;
    public void Set_Angle(decimal value) { this.angle = value; this.SyncTurtle(); }
    public decimal Get_Speed() => this.speed;
    public void Set_Speed(decimal value) => this.speed = Math.Clamp(value, 1, 10);
    public decimal Get_X() => this.x;
    public void Set_X(decimal value) { this.x = value; this.SyncTurtle(); }
    public decimal Get_Y() => this.y;
    public void Set_Y(decimal value) { this.y = value; this.SyncTurtle(); }

    public void Hide() { this.Initialize(); this.turtle.Visible = false; this.graphics.Refresh(); }

    public async Task Move(decimal distance)
    {
        this.Initialize();
        decimal radians = this.angle / 180m * (decimal)Math.PI;
        decimal newY = this.y - (decimal)((double)distance * Math.Cos((double)radians));
        decimal newX = this.x + (decimal)((double)distance * Math.Sin((double)radians));

        if (this.penDown)
        {
            GraphicElement line = this.graphics.NewElement("line", this.x, this.y, x2: newX, y2: newY, fill: "none");
            line.ZIndex = 20;
            this.graphics.Add(line);
        }

        await Task.Delay(this.Duration(Math.Abs(distance) * 320m));
        this.x = newX;
        this.y = newY;
        this.SyncTurtle();
    }

    public async Task MoveTo(decimal targetX, decimal targetY)
    {
        decimal dx = targetX - this.x;
        decimal dy = targetY - this.y;
        decimal distance = (decimal)Math.Sqrt((double)((dx * dx) + (dy * dy)));
        if (distance == 0)
        {
            return;
        }

        decimal targetAngle = (decimal)(Math.Atan2((double)dx, (double)-dy) * 180 / Math.PI);
        await this.Turn(targetAngle - this.angle);
        await this.Move(distance);
    }

    public void PenDown() { this.Initialize(); this.penDown = true; }
    public void PenUp() { this.Initialize(); this.penDown = false; }
    public void Show() { this.Initialize(); this.turtle.Visible = true; this.graphics.Refresh(); }

    public async Task Turn(decimal value)
    {
        this.Initialize();
        await Task.Delay(this.Duration(Math.Abs(value) * 200m));
        this.angle += value;
        this.SyncTurtle();
    }

    public Task TurnLeft() => this.Turn(-90);
    public Task TurnRight() => this.Turn(90);

    private int Duration(decimal numerator) => this.speed == 10 ? 5 : Math.Max(0, (int)(numerator / (this.speed * this.speed)));

    private void Initialize()
    {
        if (this.initialized)
        {
            return;
        }

        this.initialized = true;
        this.penDown = true;
        this.turtle.Visible = true;
        if (!this.added)
        {
            this.added = true;
            this.graphics.Add(this.turtle);
            return;
        }

        this.graphics.Refresh();
    }

    private void SyncTurtle()
    {
        this.turtle.TranslateX = this.x;
        this.turtle.TranslateY = this.y;
        this.turtle.Angle = this.angle;
        this.graphics.Refresh();
    }

    private void OnCleared()
    {
        this.added = false;
        this.initialized = false;
        this.penDown = false;
        this.turtle.Visible = false;
    }
}
