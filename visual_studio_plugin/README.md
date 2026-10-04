# SmallBasic for Visual Studio

Microsoft Small Basic language support for Visual Studio 2022/2026.

repo: https://github.com/Ultramanhu/SmallBasicPlugin/

## Features

- `.sb` file association with syntax highlighting
- IntelliSense completions, hover quick info, live diagnostics and document outline powered by a built-in language server (LSP)
- Code outlining (collapsible regions)
- Native Visual Studio navigation bar for procedures and variables
- Run programs with three backends:
  - `SmallBasic: Run with C# Backend` — bundled .NET run host; supports graphics programs (`GraphicsWindow` / `Shapes` / `Turtle`) on Windows
  - `SmallBasic: Run with JavaScript Backend` — external Node.js 20+, text-only programs
  - `SmallBasic: Run with Blazor Backend` — bundled ASP.NET Core/Blazor WebAssembly run host; graphics programs run in the browser
- Debugging with the C#, JavaScript, or Blazor backend: breakpoints, stepping, variables (with SmallBasic array expansion) and call stack
- Localized Document

## Language extension: `Function`, `Sub` parameters, `Dim` and `Return`

Beyond classic Small Basic, the language core (C# and TypeScript implementations kept behavior-identical) adds procedural programming. All three run backends (JavaScript / C# / Blazor) support it:

- **`Function Name(A, B) … EndFunction`** — a value-returning procedure. `Return expression` exits immediately; reaching `EndFunction` without `Return` yields the empty string. Calls work anywhere a value is expected, including recursion and mutual calls.
- **`Sub Name(A, B) … EndSub`** — classic Subs now accept parameters, with the argument count checked exactly.
- **Local scope** — parameters and `Dim`-declared variables live in a per-call frame (recursion-safe, may shadow globals); undeclared names keep the classic global behavior.
- **Parameterless procedures** — declared as `Sub F` ≡ `Sub F()`; called as `F` ≡ `F()` and `Answer = F` ≡ `Answer = F()`. Procedures with parameters require parentheses and an exact argument count.
- **Editor & debugger** — keyword coloring and folding, Function snippets and completions with parameter placeholders, signature help, outline/navigation bar with full signatures, and per-frame Locals (parameters + `Dim`) beside the shared Globals while debugging.

Sample (`test/hello/accumulate.sb`):

```smallbasic
Total = 0                          ' undeclared names stay global

Sub Accumulate(Value)              ' Subs accept parameters too
  Total = Total + Value            ' no Dim here -> this is the global Total
EndSub

Function Factorial(N)
  If N <= 1 Then
    Return 1
  EndIf
  Return N * Factorial(N - 1)      ' recursion
EndFunction

Accumulate(3)
TextWindow.WriteLine(Factorial(5)) ' prints 120
```

## Requirements

- Visual Studio 2022 (17.14+, amd64 / arm64) or Visual Studio 2026
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
