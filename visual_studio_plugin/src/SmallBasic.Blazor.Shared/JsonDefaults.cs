using System.Text.Json;

namespace SmallBasic.Blazor.Shared;

/// <summary>
/// The single <see cref="JsonSerializerOptions"/> of the web protocol surfaces
/// (browser transports and the hosting session), so the camelCase wire shape
/// cannot drift between them.
/// </summary>
public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
}
