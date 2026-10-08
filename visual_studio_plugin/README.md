# SmallBasic for Visual Studio

Microsoft Small Basic language support for Visual Studio 2022/2026.

repo: https://github.com/Ultramanhu/SmallBasicPlugin/

## Features

- `.sb` file association with the Small Basic logo file icon and syntax highlighting
- IntelliSense completions, hover quick info, live diagnostics and document outline powered by a built-in language server (LSP)
- Code outlining (collapsible regions)
- Native Visual Studio navigation bar for procedures and variables
- Run programs with three backends:
  - `SmallBasic: Run with C# Backend` — bundled .NET run host; supports graphics programs (`GraphicsWindow` / `Shapes` / `Turtle`) on Windows
  - `SmallBasic: Run with JavaScript Backend` — external Node.js 20+, text-only programs
  - `SmallBasic: Run with Blazor Backend` — bundled ASP.NET Core/Blazor WebAssembly run host; graphics programs run in the browser
- Debugging with the C#, JavaScript, or Blazor backend: breakpoints, stepping, variables (with SmallBasic array expansion) and call stack
- Localized Document

## Language extension: procedures, loop control, integer division and modulo

Beyond classic Small Basic, the language core (C# and TypeScript implementations kept behavior-identical) adds procedural programming. All three run backends (JavaScript / C# / Blazor) support it:

- **`Function Name(A, B) … EndFunction`** — a value-returning procedure. `Return expression` exits immediately; reaching `EndFunction` without `Return` yields the empty string. Calls work anywhere a value is expected, including recursion and mutual calls.
- **`Sub Name(A, B) … EndSub`** — classic Subs now accept parameters, with the argument count checked exactly.
- **Local scope** — parameters and `Dim`-declared variables live in a per-call frame (recursion-safe, may shadow globals); undeclared names keep the classic global behavior.
- **Parameterless procedures** — declared as `Sub F` ≡ `Sub F()`; called as `F` ≡ `F()` and `Answer = F` ≡ `Answer = F()`. Procedures with parameters require parentheses and an exact argument count.
- **Loop control** — `Break` leaves the innermost `While` / `For`; `Continue` moves on to that loop's next iteration. A `Continue` inside a `For` **still runs the step-increment and the bound check**. Both only affect the innermost loop, and using either outside a loop reports `BreakOutsideLoop` / `ContinueOutsideLoop`.
- **Integer division and modulo** — `A \ B` truncates the quotient toward zero, while `A Mod B` returns a remainder with the dividend's sign. `Math.Div(A, B)` and `Math.Mod(A, B)` are exact method equivalents. A zero divisor returns `0` and execution continues.
- **Precedence** — the VB-style ladder is `* /` > `\` > `Mod` > `+ -`, with left associativity at each level. `Mod` is case-insensitive and reserved.
- **Editor & debugger** — coloring, completion, signature help and hover distinguish the `Mod` operator from the `Math.Mod` method. Arithmetic statements support breakpoints and stepping, and the new expressions work in conditional breakpoints, Watch and the Debug Console.

Sample (`sample/hello/accumulate.sb`):

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

Loop control:

```smallbasic
Sum = 0
For I = 1 To 5
  If I = 3 Then
    Continue                       ' skips only this iteration, the increment still runs
  EndIf
  If I = 5 Then
    Break                          ' leaves the loop before Sum grows again
  EndIf
  Sum = Sum + I
EndFor
TextWindow.WriteLine(Sum)          ' prints 7 (1 + 2 + 4)
```

Integer division and modulo:

```smallbasic
Whole = 17 \ 5                    ' 3
Rest = 17 Mod 5                   ' 2
TextWindow.WriteLine(Math.Div(-7, 2)) ' -3
TextWindow.WriteLine(Math.Mod(-7, 2)) ' -1
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
`launch.vs.json` (Visual Studio launch configuration file). `project` must name an existing `.sb` file in the workspace, and profiles for that file must use distinct `projectTarget` values because Visual Studio uses `project + projectTarget` as the target identity. `program` can still use `${file}` to debug the active document:

```jsonc
{  "type": "smallbasic",  "project": "hello/hello.sb",  "projectTarget": "javascript",  "request": "launch",  "name": "SmallBasic [CLI]: Debug current file with JavaScript backend",
  "program": "${file}",  "backend": "javascript",  "mode": "cli",  "stopOnEntry": false }

{  "type": "smallbasic",  "project": "hello/hello.sb",  "projectTarget": "csharp",  "request": "launch",  "name": "SmallBasic [CLI]: Debug current file with C# backend",
  "program": "${file}",  "backend": "csharp",  "mode": "cli",  "stopOnEntry": false }

{  "type": "smallbasic",  "project": "hello/hello.sb",  "projectTarget": "blazor",  "request": "launch",  "name": "SmallBasic [CLI]: Debug current file with Blazor backend",
  "program": "${file}",  "backend": "blazor",  "mode": "cli",  "stopOnEntry": false }
```

- The JavaScript backend does not support graphics libraries (`GraphicsWindow`, `Shapes`, `Turtle`); use the Windows C# backend or the cross-platform Blazor backend.

## License

MIT
