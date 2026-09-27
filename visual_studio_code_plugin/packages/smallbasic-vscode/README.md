# SmallBasic for Visual Studio Code

Microsoft Small Basic language support for Visual Studio Code (VS Code 1.96+).

repo: https://github.com/Ultramanhu/SmallBasicPlugin/

## Features

- `.sb` file association with syntax highlighting (TextMate grammar + semantic tokens)
- IntelliSense completions and hover quick info
- Live diagnostics in the Problems panel
- Run programs with two backends:
  - `SmallBasic: Run` — built-in JavaScript engine, cross-platform (including VS Code for the Web), supports `TextWindow` text programs
  - `SmallBasic: Run with C# Backend` — bundled .NET run host; the Windows host supports graphics programs (`GraphicsWindow` / `Shapes` / `Turtle`), Linux/macOS use a portable command-line host
- Debugging: breakpoints, stepping, variables (with SmallBasic array expansion) and call stack, shared DAP semantics across backends
- `SmallBasic: New File` command and Explorer context-menu template
- Localized UI

## Usage

- **New file**: run `SmallBasic: New File` from the command palette, or right-click a folder in the Explorer.
- **Run**: use the play button in the editor title bar, or the command palette.
- **Debug**: set breakpoints in a `.sb` file and press F5. You can pick a backend explicitly in `launch.json`:

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Launch current file (JS debugger)",
  "program": "${file}", "backend": "javascript", "stopOnEntry": true }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic: Debug current file (C# debugger)",
  "program": "${file}", "backend": "csharp", "stopOnEntry": true }
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `smallbasic.diagnostics.debounceMs` | `150` | Delay before recomputing diagnostics after edits |
| `smallbasic.csharp.runHostPath` | `""` | Path to `SmallBasic.RunHost.exe`/`.dll`; leave empty to use the bundled host |

## Known limitations

- The JavaScript backend does not support graphics libraries (`GraphicsWindow`, `Shapes`, `Turtle`); use the Windows C# backend for graphics programs.

## License

MIT
