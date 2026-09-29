# SmallBasic for Visual Studio Code

Microsoft Small Basic language support for Visual Studio Code (VS Code 1.96+).

repo: https://github.com/Ultramanhu/SmallBasicPlugin/

## Features

- `.sb` file association with syntax highlighting (TextMate grammar + semantic tokens)
- IntelliSense completions, hover quick info and code outlining (collapsible regions)
- Live diagnostics in the Problems panel
- Navigation bar and outline view for procedures and variables
- Run programs with three backends in CLI mode, plus JavaScript and Blazor in Web mode:
  - `SmallBasic: Run with JavaScript Backend` — CLI mode uses the built-in JavaScript engine and terminal; Web mode runs `TextWindow` inside a browser Webview
  - `SmallBasic: Run with C# Backend` — bundled .NET run host; CLI mode only, with Windows graphics support (`GraphicsWindow` / `Shapes` / `Turtle`)
  - `SmallBasic: Run with Blazor Backend` — CLI mode uses the cross-platform host; Web mode runs Blazor WASM in a Webview with SVG graphics
- Debugging: breakpoints, stepping, variables (with SmallBasic array expansion) and call stack, shared DAP semantics across backends
- `SmallBasic: New File` command and Explorer context-menu template
- Localized Document

## Requirements
- The C# path requires the .NET 8 runtime and the Blazor path requires the .NET 8 and ASP.NET Core 8 runtimes.

## Usage

- **New file/Open**: run `SmallBasic: New File` from the command palette, or open any `.sb` file — no project system required, "Open Folder" works.
- **Edit**: Syntax highlighting, completions, hover info, the Error List and code outlining are enabled automatically.
- **Run**: use the play button in the editor title bar, or the command palette.
- **Debug**: set breakpoints in a `.sb` file and press F5. You can pick a backend explicitly in `launch.json`:

CLI mode (the default; all three backends are available):

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with JavaScript backend",
  "program": "${file}", "backend": "javascript", "mode": "cli", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with C# backend",
  "program": "${file}", "backend": "csharp", "mode": "cli", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with Blazor backend",
  "program": "${file}", "backend": "blazor", "mode": "cli", "stopOnEntry": false }
```

Web mode (JavaScript/Blazor; run with Ctrl+F5 on desktop):

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [Web]: Run current file with JavaScript backend",
  "program": "${file}", "backend": "javascript", "mode": "web", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [Web]: Run current file with Blazor backend",
  "program": "${file}", "backend": "blazor", "mode": "web", "stopOnEntry": false }
```

`mode` accepts `cli` or `web`. On desktop, `cli` is the default; choose `web` and use
Run Without Debugging (Ctrl+F5) to run either the JavaScript or Blazor backend in the
browser Webview. VS Code for the Web always uses `web` mode. JavaScript can still be
debugged with F5; Blazor Web mode currently supports running only.

## Settings

| Setting | Default | Description |
|---|---|---|
| `smallbasic.diagnostics.debounceMs` | `150` | Delay before recomputing diagnostics after edits |
| `smallbasic.csharp.runHostPath` | `""` | Path to `SmallBasic.RunHost.exe`/`.dll`; leave empty to use the bundled host |
| `smallbasic.blazor.runHostPath` | `""` | Path to `SmallBasic.Blazor.RunHost.dll`/executable; leave empty to use the bundled host |

## Known limitations

- The CLI JavaScript backend does not support graphics libraries (`GraphicsWindow`, `Shapes`, `Turtle`); use Web mode with Blazor or the Windows C# backend.
- Blazor Web mode does not support Debugging, only Running; JavaScript Web mode can still use the JavaScript DAP when started with F5.

## License

MIT
