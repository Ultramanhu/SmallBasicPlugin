# SmallBasic for Visual Studio

Microsoft Small Basic language support for Visual Studio 2022/2026.

repo: https://github.com/Ultramanhu/SmallBasicPlugin/

## Features

- `.sb` file association with syntax highlighting (MEF classifier)
- IntelliSense completions and hover quick info
- Live diagnostics in the Error List
- Code outlining (collapsible regions)
- Run programs with two backends:
  - `Run with C# Backend` — bundled .NET run host; supports graphics programs (`GraphicsWindow` / `Shapes` / `Turtle`) on Windows
  - `Run with JavaScript Backend` — external Node.js 20+, text-only programs
- Debugging with the C# backend: breakpoints, stepping, variables (with SmallBasic array expansion) and call stack, including graphics programs

## Requirements

- Visual Studio 2022 (17.0+ amd64; 17.4+ arm64) or Visual Studio 2026
- The C# run/debug path does not require Node.js; the JavaScript run path requires Node.js 20+

## Installation

Double-click `build\SmallBasic.Vsix.#Version#.vsix` and follow the VSIX Installer prompts.

## Usage

- **Editing**: open any `.sb` file — no project system required, "Open Folder" works. Syntax highlighting, completions, hover info, the Error List and code outlining are enabled automatically.
- **Run**: press `Ctrl+F5` to run the current `.sb` with the bundled net48 C# run host (supports graphics programs), or use `Tools > Small Basic` to pick a backend explicitly.
- **Debug**: set breakpoints in a `.sb` file and press `F5`. Debugging uses the C# backend and supports breakpoints (snapped to the nearest executable line), step over/into/out, variables (including SmallBasic array expansion) and the call stack. `F10`/`F11` at design time start with stop-on-entry; during a debug session `F5`/`F10`/`F11`/`Shift+F5` are forwarded to the debugger.

## License

MIT
