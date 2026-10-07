export const RUN_HOST_CAPABILITIES = Object.freeze({
  protocolVersion: 2,
  capabilities: Object.freeze(["function-v1", "gosub-v1", "error-handling-v1"])
});

/**
 * All capabilities this extension requires of a (C# or JS) run host. Hosts
 * without them predate the GoSub / On Error language extension and must be
 * rejected with a clear message instead of silently misrunning programs.
 */
export const REQUIRED_HOST_CAPABILITIES: readonly string[] = Object.freeze([
  "function-v1",
  "gosub-v1",
  "error-handling-v1"
]);

export function supportsRequiredCapabilities(stdout: string, required: readonly string[] = REQUIRED_HOST_CAPABILITIES): boolean {
  try {
    const response = JSON.parse(stdout) as {
      protocolVersion?: unknown;
      capabilities?: unknown;
    };
    return response.protocolVersion === 2 &&
      Array.isArray(response.capabilities) &&
      required.every((capability) => (response.capabilities as unknown[]).includes(capability));
  } catch {
    return false;
  }
}

/** Backwards-compatible alias for the original function capability probe. */
export function supportsFunctionCapability(stdout: string): boolean {
  return supportsRequiredCapabilities(stdout, ["function-v1"]);
}
