# SmallBasic for Visual Studio (Classic) / SmallBasic for Visual Studio (Extensibility)

Microsoft Small Basic language support for Visual Studio 2022/2026.

repo: https://github.com/Ultramanhu/SmallBasicPlugin/

## Attension
- **Visual Studio (Classic)**: the most feature-complete traditional integration, go through the classic VSSDK/MEF.
- **Visual Studio (Ext / LSP)**: migrates commands and tool windows to VisualStudio.Extensibility, and re-implements via an in-process LSP server to validate the new framework migration path.
- **Note: Do not install both Visual Studio plugins simultaneously, as they will conflict — choose one only.**

## Features

- `.sb` file association with syntax highlighting (MEF classifier)
- IntelliSense completions, hover quick info and code outlining (collapsible regions)
- Live diagnostics in the Error List
- Native Visual Studio navigation bar for procedures and variables
- Run programs with three backends:
  - `SmallBasic: Run with C# Backend` — bundled .NET run host; supports graphics programs (`GraphicsWindow` / `Shapes` / `Turtle`) on Windows
  - `SmallBasic: Run with JavaScript Backend` — external Node.js 20+, text-only programs
  - `SmallBasic: Run with Blazor Backend` — bundled ASP.NET Core/Blazor WebAssembly run host; graphics programs run in the browser
- Debugging with the C#, JavaScript, or Blazor backend: breakpoints, stepping, variables (with SmallBasic array expansion) and call stack
- Localized Document

## Requirements

- Visual Studio 2022 (17.0+ amd64; 17.4+ arm64) or Visual Studio 2026
- The JavaScript path requires Node.js 20+; the Blazor path requires the .NET 8 runtime

## Installation

Double-click `build\SmallBasic.Vsix.#Version#.vsix` and follow the VSIX Installer prompts.

## Usage

- **Open**: open any `.sb` file — no project system required, "Open Folder" works. 
- **Edit**: Syntax highlighting, completions, hover info, the Error List and code outlining are enabled automatically.
- **Choose a backend**: use `Tools > Small Basic` to run or debug explicitly with C#, JavaScript, or Blazor. The chosen backend remains active for subsequent standard run/debug commands in the current Visual Studio session; C# is the initial default.
- **Run**: press `Ctrl+F5` to run the current `.sb` with the active backend.
- **Debug**: set breakpoints in a `.sb` file and press `F5`. `F10`/`F11` at design time start with stop-on-entry; during a debug session `F5`/`F10`/`F11`/`Shift+F5` are forwarded to the debugger.
`launch.vs.json` (Visual Studio launch configuration file):

```jsonc
{  "type": "smallbasic",  "project": ".",  "request": "launch",  "name": "SmallBasic [CLI]: Debug current file with JavaScript backend",
  "program": "${file}",  "backend": "javascript",  "mode": "cli",  "stopOnEntry": false }

{  "type": "smallbasic",  "project": ".",  "request": "launch",  "name": "SmallBasic [CLI]: Debug current file with C# backend",
  "program": "${file}",  "backend": "csharp",  "mode": "cli",  "stopOnEntry": false }

{  "type": "smallbasic",  "project": ".",  "request": "launch",  "name": "SmallBasic [CLI]: Debug current file with Blazor backend",
  "program": "${file}",  "backend": "blazor",  "mode": "cli",  "stopOnEntry": false }
```


- The JavaScript backend does not support graphics libraries (`GraphicsWindow`, `Shapes`, `Turtle`); use the Windows C# backend or the cross-platform Blazor backend.

## License

MIT
