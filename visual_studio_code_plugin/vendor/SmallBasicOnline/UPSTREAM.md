# UPSTREAM

- Source repository: `sb/SmallBasic-Online`
- Local source path used for copy: `official_repo/online`
- Copied into this workspace on: 2026-09-25
- Copied subsets:
  - `src/compiler`
  - `src/strings`
  - `tests/compiler`
- Purpose:
  - Keep VS Code plugin self-contained without direct source references to `official_repo`

## Local modifications

Behavior is aligned with the C# implementation (`visual_studio_plugin/vendor/SmallBasicEditor`,
which is the official `SmallBasic.Compiler`); see `docs/design/06-运行时库与宿主集成.md` §1.1.
Re-apply these when syncing upstream:

- `src/compiler/syntax/command-parser.ts` - unary minus binds tighter than every binary
  operator (its operand is the next unary expression), so `-1 + 5` is 4 and `-1 < 0` is True.
- `src/compiler/runtime/values/string-value.ts` - `StringValue.Create` (plain decimal text and
  `True`/`False` become numbers/booleans, mirroring the C# `StringValue.Create`) and
  `StringValue.Fold`; `toNumber()` returns 0 for text that is not a plain number.
- `src/compiler/runtime/values/base-value.ts` - value API reduced to
  `toBoolean/toDebuggerString/toValueString/toNumber/tryConvertToNumber`; the operator methods
  (and `isEqualTo/isLessThan/isGreaterThan`) moved into the instructions, like the C# runtime.
- `src/compiler/runtime/values/number-value.ts` - value type only (no operator overrides).
- `src/compiler/runtime/values/array-value.ts` - storage is a `Map` (insertion order, like the
  C# `Dictionary`) with `keys`/`count`; `toValueString()` renders `index=value;` with `;`, `=`
  and `\` escaped in values, matching the C# `ArrayValue.ToDisplayString`.
- `src/compiler/execution-engine.ts` - every value pushed on the evaluation stack is folded
  through `StringValue.Fold`, which is the single place that mirrors the C# `StringValue.Create`
  calls in the generated library bindings and the module emitter.
- `src/compiler/emitting/instructions.ts` - operator, comparison and negation semantics mirror
  the C# instruction classes (`+` adds two numbers and concatenates otherwise; `- * / \ Mod`
  and `< > <= >=` use `toNumber()` with `/\` treating a zero divisor as 1 and `\`/`Mod` as 0;
  `=`/`<>` compare the text form); array reads never create entries and pop every index; any
  value works as an array index via its text form; storing empty text removes the element.
- `src/compiler/runtime/libraries/math.ts` - `Math.Round` rounds half to even, `Math.Log` uses
  `Math.log10`, `Math.GetRandomNumber(n)` includes the upper bound, `Math.Remainder` with a zero
  divisor is 0, and results without a decimal representation (NaN, infinity) are 0.
- `tests/compiler/**` - expectations updated for the aligned semantics (capitalized `True`/`False`,
  `index=value;` array text, numeric operands of the operators, `Math.Pi`, the unary minus
  diagnostic, and one test that compared the wrong variable in `libraries/math.ts`).
