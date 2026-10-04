/**
 * Process exit codes of the JavaScript CLI run host, mirroring the C#
 * SmallBasic.RunHost (see `SmallBasic.RunHost/Program.cs`): 0 success, 1
 * usage/compile errors, 3 unsupported library usage, 4 unexpected runtime
 * failures.
 *
 * Shared verbatim by the Node host (`main.ts`) and the browser host (`web.ts`,
 * whose exit code reaches the playground status line), so the two backends
 * cannot drift.
 */

export const EXIT_SUCCESS = 0;
export const EXIT_COMPILE_ERROR = 1;
export const EXIT_UNSUPPORTED_LIBRARY = 3;
export const EXIT_RUNTIME_ERROR = 4;
