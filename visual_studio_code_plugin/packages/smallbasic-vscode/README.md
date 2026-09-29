# SmallBasic for Visual Studio Code

Microsoft Small Basic language support for Visual Studio Code (VS Code 1.96+).

The Blazor backend requires the .NET 8 and ASP.NET Core 8 runtimes.

repo: https://github.com/Ultramanhu/SmallBasicPlugin/

## Features

- `.sb` file association with syntax highlighting (TextMate grammar + semantic tokens)
- IntelliSense completions, hover quick info and code outlining (collapsible regions)
- Live diagnostics in the Problems panel
- Navigation bar and outline view for procedures and variables
- Run programs with three backends:
  - `SmallBasic: Run with JavaScript Backend` — built-in JavaScript engine, cross-platform (including VS Code for the Web), supports `TextWindow` text programs
  - `SmallBasic: Run with C# Backend` — bundled .NET run host; the Windows host supports graphics programs (`GraphicsWindow` / `Shapes` / `Turtle`), Linux/macOS use a portable command-line host
  - `SmallBasic: Run with Blazor Backend` — cross-platform hybrid host; text programs stay in the terminal and only graphics programs open the Blazor WebAssembly SVG window
- Debugging: breakpoints, stepping, variables (with SmallBasic array expansion) and call stack, shared DAP semantics across backends
- `SmallBasic: New File` command and Explorer context-menu template
- Localized Document

## Usage

- **New file/Open**: run `SmallBasic: New File` from the command palette, or open any `.sb` file — no project system required, "Open Folder" works.
- **Edit**: Syntax highlighting, completions, hover info, the Error List and code outlining are enabled automatically.
- **Run**: use the play button in the editor title bar, or the command palette.
- **Debug**: set breakpoints in a `.sb` file and press F5. You can pick a backend explicitly in `launch.json`:

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Debug current file (JavaScript debugger)",
  "program": "${file}", "backend": "javascript", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Debug current file (C# debugger)",
  "program": "${file}", "backend": "csharp", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Debug current file (Blazor debugger)",
  "program": "${file}", "backend": "blazor", "stopOnEntry": false }
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `smallbasic.diagnostics.debounceMs` | `150` | Delay before recomputing diagnostics after edits |
| `smallbasic.csharp.runHostPath` | `""` | Path to `SmallBasic.RunHost.exe`/`.dll`; leave empty to use the bundled host |
| `smallbasic.blazor.runHostPath` | `""` | Path to `SmallBasic.Blazor.RunHost.dll`/executable; leave empty to use the bundled host |

## Known limitations

- The JavaScript backend does not support graphics libraries (`GraphicsWindow`, `Shapes`, `Turtle`); use the Windows C# backend or the cross-platform Blazor backend.

## License

MIT
