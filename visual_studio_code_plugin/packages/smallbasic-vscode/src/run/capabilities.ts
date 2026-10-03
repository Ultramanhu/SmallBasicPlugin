export const RUN_HOST_CAPABILITIES = Object.freeze({
  protocolVersion: 2,
  capabilities: Object.freeze(["function-v1"])
});

export function supportsFunctionCapability(stdout: string): boolean {
  try {
    const response = JSON.parse(stdout) as {
      protocolVersion?: unknown;
      capabilities?: unknown;
    };
    return response.protocolVersion === 2 &&
      Array.isArray(response.capabilities) &&
      response.capabilities.includes("function-v1");
  } catch {
    return false;
  }
}
