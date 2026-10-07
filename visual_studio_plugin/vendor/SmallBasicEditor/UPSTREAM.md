# UPSTREAM

- Source repository: `sb/smallbasic-editor`
- Local source path used for copy: `official_repo/editor/Source`
- Copied into this workspace on: 2026-09-25
- Copied subsets:
  - `Directory.Build.props`
  - `stylecop.json`
  - `SmallBasic.Analyzers`
  - `SmallBasic.Compiler`
  - `SmallBasic.Utilities`
  - `SmallBasic.Tests`
  - `SmallBasic.Editor/Libraries`
- Purpose:
  - Keep Visual Studio plugin self-contained without direct project or source references to `official_repo`

## Local modifications

This tree is the behavior reference for the TypeScript runtime
(`visual_studio_code_plugin/vendor/SmallBasicOnline`); see
`docs/design/06-运行时库与宿主集成.md` §1.1. Re-apply these when syncing upstream:

- `Source/SmallBasic.Compiler/Runtime/Values/NumberValue.cs` - `ToDisplayString` uses the
  invariant culture and drops a trailing fraction of zeros (`5.0` prints as `5`, `2.50` as
  `2.5`), which also makes the text-based equality agree with the JavaScript backend.
- `Source/SmallBasic.Compiler/Runtime/Instructions/MemoryInstructions.cs` -
  `LoadArrayElementInstruction` pops every index even when the array or an intermediate level is
  missing; previously the index leaked into the surrounding expression.
- `Source/SmallBasic.Editor/Libraries/MathLibrary.cs` - double results are converted through the
  shortest round-trip text (framework independent, so .NET Framework prints the same digits as
  .NET), NaN/infinity/values outside the decimal range become 0, and `SquareRoot` of a negative
  number is 0 instead of throwing.
- `Source/SmallBasic.Tests/Runtime/LibrariesTests.cs` - `Math.Pi` expectation updated to the
  round-trippable value `3.141592653589793`.
