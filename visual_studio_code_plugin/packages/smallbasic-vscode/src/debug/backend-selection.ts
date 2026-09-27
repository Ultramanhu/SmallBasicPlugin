export type SmallBasicDebugBackend = "javascript" | "csharp" | "blazor";

/**
 * Select the backend for a desktop F5 launch that does not explicitly name one.
 * The Windows C# host supplies GraphicsWindow/Shapes/Turtle; other platforms
 * retain the dependency-free JavaScript default.
 */
export function selectDefaultDebugBackend(
  platform: NodeJS.Platform,
  hasCSharpHost: boolean
): SmallBasicDebugBackend {
  return platform === "win32" && hasCSharpHost ? "csharp" : "javascript";
}
