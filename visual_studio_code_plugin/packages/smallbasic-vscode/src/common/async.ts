/** Resolves after `milliseconds`; the shared idle wait of the run hosts. */
export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
