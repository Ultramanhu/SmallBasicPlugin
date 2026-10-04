/**
 * User-facing message templates shared by the desktop and Web extension hosts.
 *
 * The backend messages take a `scenario` so the run command, the launch
 * configuration check and the debug adapter factory all report the same text;
 * they only differ in 运行/调试 (run/debug).
 */

/** Warning shown when a Small Basic command is invoked without an .sb editor. */
export const OPEN_SB_FILE_WARNING = "请先打开一个 SmallBasic (.sb) 文件。";

/** Warning shown when saving the document before a run failed. */
export const SAVE_BEFORE_RUN_WARNING = "运行前需要先保存当前文件。";

/** Error body for a program file path that cannot be found. */
export function programFileNotFound(filePath: string): string {
  return `找不到 SmallBasic 程序文件：${filePath}`;
}

/** The local C# RunHost artifact could not be resolved. */
export function csharpHostMissing(scenario: "运行" | "调试"): string {
  return `未找到可用的 SmallBasic C# ${scenario}宿主。请在设置中配置 smallbasic.csharp.runHostPath，` +
    "或安装 .NET 8 后重新安装完整的扩展包。";
}

/** The local C# RunHost is too old for the Function/Dim/Return extension. */
export function csharpHostMissingFunctions(scenario: "运行" | "调试"): string {
  return `当前 SmallBasic C# ${scenario}宿主不支持 Function/Dim/Return。` +
    "请升级扩展内置宿主，或更新 smallbasic.csharp.runHostPath 指向的自定义宿主。";
}

/** The local Blazor RunHost artifact could not be resolved. */
export function blazorHostMissing(scenario: "运行" | "调试"): string {
  return `未找到 Small Basic Blazor ${scenario}宿主。请安装 .NET 8 / ASP.NET Core 8 Runtime、重新安装完整扩展，` +
    "或在 smallbasic.blazor.runHostPath 中指定宿主路径。";
}

/** Seed content of `smallbasic.newFile` (and of the playground's new file). */
export const NEW_PROGRAM_TEMPLATE = "' My first Small Basic program\nTextWindow.WriteLine(\"Hello World\")\n";
