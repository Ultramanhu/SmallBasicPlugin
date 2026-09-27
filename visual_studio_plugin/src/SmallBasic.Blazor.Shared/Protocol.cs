namespace SmallBasic.Blazor.Shared;

public sealed class SessionDescriptor
{
    public required string Id { get; init; }

    public required string ProgramName { get; init; }

    public required string Source { get; init; }

    public bool Debug { get; init; }

    public bool StopOnEntry { get; init; }

    public bool UsesGraphics { get; init; }
}

public sealed class HostMessage
{
    public required string Type { get; init; }

    public string? Text { get; init; }

    public string? Control { get; init; }

    public int Depth { get; init; }

    public int[] Breakpoints { get; init; } = Array.Empty<int>();
}

public sealed class BrowserMessage
{
    public required string Type { get; init; }

    public string? Reason { get; init; }

    public string? Text { get; init; }

    public int Line { get; init; }

    public int ExitCode { get; init; }

    public bool NumberInput { get; init; }

    public DebugFrame[] Frames { get; init; } = Array.Empty<DebugFrame>();

    public DebugVariable[] Variables { get; init; } = Array.Empty<DebugVariable>();
}

public sealed class DebugFrame
{
    public required string Name { get; init; }

    public int Line { get; init; }
}

public sealed class DebugVariable
{
    public required string Name { get; init; }

    public required string Value { get; init; }

    public DebugVariable[] Children { get; init; } = Array.Empty<DebugVariable>();
}
