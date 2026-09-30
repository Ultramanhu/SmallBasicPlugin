namespace SmallBasic.Blazor.Shared;

/// <summary>
/// Version of the web debug protocol shared by the browser-compatible DAP
/// adapter (<c>visual_studio_code_plugin/packages/smallbasic-vscode/src/web/debug-protocol.ts</c>,
/// <c>DEBUG_PROTOCOL_VERSION</c>) and the WebAssembly runtime. Bump both sides
/// together whenever the message shape changes incompatibly.
/// </summary>
public static class DebugProtocol
{
    public const int Version = 1;
}

public sealed class SessionDescriptor
{
    public required string Id { get; init; }

    public required string ProgramName { get; init; }

    public required string Source { get; init; }

    public bool Debug { get; init; }

    public bool StopOnEntry { get; init; }

    public bool UsesGraphics { get; init; }
}

/// <summary>
/// A command sent to the runtime. The CLI bridge (WebSocket) populates
/// <see cref="Type"/>/<see cref="Control"/>/<see cref="Breakpoints"/> only;
/// web debug commands additionally carry <see cref="ProtocolVersion"/>,
/// <see cref="SessionId"/> and, for requests that need an answer,
/// <see cref="RequestId"/>. Breakpoint lines are 0-based.
/// </summary>
public sealed class HostMessage
{
    /// <summary>Web debug protocol version; 0 for the CLI bridge.</summary>
    public int ProtocolVersion { get; init; }

    public string? SessionId { get; init; }

    public string? RequestId { get; init; }

    public required string Type { get; init; }

    public string? Text { get; init; }

    public string? Control { get; init; }

    public int Depth { get; init; }

    public int[] Breakpoints { get; init; } = Array.Empty<int>();
}

/// <summary>
/// An event published by the runtime. Types are <c>ready</c>,
/// <c>breakpointsValidated</c>, <c>output</c>, <c>stopped</c>, <c>input</c>,
/// <c>terminated</c> and <c>error</c>.
/// </summary>
public sealed class BrowserMessage
{
    /// <summary>Web debug protocol version; 0 when published by the CLI bridge.</summary>
    public int ProtocolVersion { get; set; }

    public string? SessionId { get; set; }

    /// <summary>Echoes the <see cref="HostMessage.RequestId"/> of the request being answered.</summary>
    public string? RequestId { get; init; }

    public required string Type { get; init; }

    public string? Reason { get; init; }

    public string? Text { get; init; }

    public int Line { get; init; }

    public int ExitCode { get; init; }

    public bool NumberInput { get; init; }

    /// <summary>Validated breakpoint lines (0-based), used by <c>breakpointsValidated</c>.</summary>
    public int[] Breakpoints { get; init; } = Array.Empty<int>();

    public DebugFrame[] Frames { get; init; } = Array.Empty<DebugFrame>();

    public DebugVariable[] Variables { get; init; } = Array.Empty<DebugVariable>();

    /// <summary>Human-readable detail for <c>error</c> events.</summary>
    public string? Message { get; init; }
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
