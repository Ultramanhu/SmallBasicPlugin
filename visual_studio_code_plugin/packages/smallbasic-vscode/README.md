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
- The C# path requires the .NET 8 runtime and the Blazor path requires the .NET 8 and ASP.NET Core 8 runtimes.

## Usage

- **New file/Open**: run `SmallBasic: New File` from the command palette, or open any `.sb` file — no project system required, "Open Folder" works.
- **Edit**: Syntax highlighting, completions, hover info, the Error List and code outlining are enabled automatically.
- **Run**: use the play button in the editor title bar, or the command palette.
- **Debug**: set breakpoints in a `.sb` file and press F5. You can pick a backend explicitly in `launch.json`:

CLI mode (the default; all three backends are available; the JavaScript backend support VSCode for Web, others only on desktop):

```jsonc
{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with JavaScript backend",
  "program": "${file}", "backend": "javascript", "mode": "cli", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with C# backend",
  "program": "${file}", "backend": "csharp", "mode": "cli", "stopOnEntry": false }

{ "type": "smallbasic", "request": "launch", "name": "SmallBasic [CLI]: Debug current file with Blazor backend",
  "program": "${file}", "backend": "blazor", "mode": "cli", "stopOnEntry": false }
```

Web mode (JavaScript/Blazor; supported by desktop and VS Code for the Web):

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
- The CLI debugging options are not supported in VSCode for Web.

## License

MIT
