import io
import re

base = r"J:\projs\SmallBasicPlugin\visual_studio_code_plugin\vendor\SmallBasicOnline\tests\compiler"


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


def write(path, src):
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)


# --- division.ts ---
path = base + r"\runtime\expressions\division.ts"
src = read(path)

src = src.replace(
    'import { verifyRuntimeResult } from "../../helpers";',
    'import { verifyRuntimeResult, verifyUnhandledRuntimeError } from "../../helpers";',
)

src = src.replace(
    """// '/' divides the numeric value of both sides, exactly like the C# backends:
// text that is not a plain number and arrays count as 0, and a zero divisor is
// treated as 1 (so 4 / 0 is 4 and 1 / "t" is 1).""",
    """// '/' divides the numeric value of both sides, exactly like the C# backends:
// text that is not a plain number and arrays count as 0. A zero divisor (also
// after folding "t" or an array to 0) is a runtime error that On Error can
// catch; without a handler the program terminates with code 1001.""",
)

src = src.replace(
    """    it("computes division - division by zero treats the divisor as one", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(4 / 0)`,
            [],
            ["4"]);
    });""",
    """    it("computes division - division by zero terminates with a runtime error", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(4 / 0)`,
            1001,
            "Divide by zero.");
    });""",
)

# Divisor folds to 0 -> runtime error 1001.
divisor_error_cases = [
    ("number divided by non-numeric string", "number divided by a non-numeric string divisor terminates", '1 / "t"'),
    ("number divided by array", "number divided by an array divisor terminates", "1 / x"),
    ("numeric string divided by non-numeric string", "numeric string divided by a non-numeric string divisor terminates", '"1" / "t"'),
    ("numeric string divided by array", "numeric string divided by an array divisor terminates", '"1" / x'),
    ("non-numeric string divided by non-numeric string", "non-numeric string divided by a non-numeric string divisor terminates", '"r" / "t"'),
    ("non-numeric string divided by array", "non-numeric string divided by an array divisor terminates", '"r" / x'),
    ("array divided by non-numeric string", "array divided by a non-numeric string divisor terminates", 'x / "t"'),
    ("array divided by array", "array divided by an array divisor terminates", "x / y"),
]

for old_name, new_name, _expr in divisor_error_cases:
    pattern = re.compile(
        r'    it\("computes division - ' + re.escape(old_name) + r'", \(\) => \{\n'
        r"        verifyRuntimeResult\(`\n"
        r"((?:.*\n)*?)`,\n"
        r"            \[\],\n"
        r'            \["0"\]\);\n'
        r"    \});",
        re.M,
    )
    m = pattern.search(src)
    assert m, old_name
    body = m.group(1)
    replacement = (
        '    it("computes division - ' + new_name + '", () => {\n'
        "        verifyUnhandledRuntimeError(`\n" + body + "`,\n"
        "            1001,\n"
        '            "Divide by zero.");\n'
        "    });"
    )
    src = src[: m.start()] + replacement + src[m.end():]

write(path, src)
print("division.ts done")

# --- integer-division.ts ---
path = base + r"\runtime\expressions\integer-division.ts"
src = read(path)
src = src.replace(
    'import { verifyRuntimeResult } from "../../helpers";',
    'import { verifyRuntimeResult, verifyUnhandledRuntimeError } from "../../helpers";',
)
src = src.replace(
    """    it("computes integer division - zero divisor yields zero without terminating", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(4 \\\\ 0)
TextWindow.WriteLine("after")`,
            [],
            [
                "0",
                "after"
            ]);
    });""",
    """    it("computes integer division - zero divisor terminates with a runtime error", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(4 \\\\ 0)`,
            1001,
            "Divide by zero.");
    });""",
)
write(path, src)
print("integer-division.ts done")

# --- modulo.ts ---
path = base + r"\runtime\expressions\modulo.ts"
src = read(path)
src = src.replace(
    'import { verifyRuntimeResult } from "../../helpers";',
    'import { verifyRuntimeResult, verifyUnhandledRuntimeError } from "../../helpers";',
)
src = src.replace(
    """    it("computes modulo - zero divisor yields zero without terminating", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(4 Mod 0)
TextWindow.WriteLine("after")`,
            [],
            [
                "0",
                "after"
            ]);
    });""",
    """    it("computes modulo - zero divisor terminates with a runtime error", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(4 Mod 0)`,
            1001,
            "Divide by zero.");
    });""",
)
write(path, src)
print("modulo.ts done")

# --- libraries/math.ts ---
path = base + r"\runtime\libraries\math.ts"
src = read(path)
src = src.replace(
    'import { verifyRuntimeResult } from "../../helpers";',
    'import { verifyRuntimeResult, verifyUnhandledRuntimeError } from "../../helpers";',
)
src = src.replace(
    """    it("returns zero from Math.Remainder with zero divisor", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(Math.Remainder(9, 0))
TextWindow.WriteLine("after")`,
            [],
            [
                "0",
                "after"
            ]);
    });""",
    """    it("terminates with a runtime error from Math.Remainder with zero divisor", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(Math.Remainder(9, 0))`,
            1001,
            "Divide by zero.");
    });""",
)
src = src.replace(
    """    it("returns zero from Math.Div with zero divisor", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(Math.Div(9, 0))
TextWindow.WriteLine("after")`,
            [],
            [
                "0",
                "after"
            ]);
    });""",
    """    it("terminates with a runtime error from Math.Div with zero divisor", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(Math.Div(9, 0))`,
            1001,
            "Divide by zero.");
    });""",
)
src = src.replace(
    """    it("returns zero from Math.Mod with zero divisor", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(Math.Mod(9, 0))
TextWindow.WriteLine("after")`,
            [],
            [
                "0",
                "after"
            ]);
    });""",
    """    it("terminates with a runtime error from Math.Mod with zero divisor", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(Math.Mod(9, 0))`,
            1001,
            "Divide by zero.");
    });""",
)
src = src.replace(
    """    it("can get square-root", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(Math.SquareRoot(-5))
TextWindow.WriteLine(Math.SquareRoot(0))
TextWindow.WriteLine(Math.SquareRoot(16))`,
            [],
            [
                "0",
                "0",
                "4"
            ]);
    });""",
    """    it("can get square-root", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(Math.SquareRoot(0))
TextWindow.WriteLine(Math.SquareRoot(16))`,
            [],
            [
                "0",
                "4"
            ]);
    });

    it("terminates with a runtime error for the square-root of a negative number", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(Math.SquareRoot(-5))`,
            1002,
            "Invalid math operation.");
    });""",
)
write(path, src)
print("libraries/math.ts done")

# --- libraries/stack.ts ---
path = base + r"\runtime\libraries\stack.ts"
src = read(path)
src = src.replace(
    'import { verifyRuntimeResult, verifyRuntimeError } from "../../helpers";',
    'import { verifyRuntimeResult, verifyUnhandledRuntimeError } from "../../helpers";',
)
src = src.replace(
    """    it("popping an empty stack produces an error", () => {
        verifyRuntimeError(`
Stack.PopValue("x")`,
            // Stack.PopValue("x")
            // ^^^^^^^^^^^^^^^^^^^
            // This stack has no elements to be popped
            new Diagnostic(ErrorCode.PoppingAnEmptyStack, CompilerRange.fromValues(1, 0, 1, 19)));
    });""",
    """    it("popping an empty stack produces an error", () => {
        verifyUnhandledRuntimeError(`
Stack.PopValue("x")`,
            1101,
            "This stack has no elements to be popped.");
    });""",
)
write(path, src)
print("libraries/stack.ts done")
