import io
import re

base = r"J:\projs\SmallBasicPlugin\visual_studio_code_plugin\vendor\SmallBasicOnline\tests\compiler"


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


def write(path, src):
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)


def replace_error_case(src, old_name, new_name, code, message):
    """Replace a verifyRuntimeResult division test with a verifyUnhandledRuntimeError test."""
    start_marker = 'it("computes division - ' + old_name + '"'
    start = src.find(start_marker)
    assert start != -1, old_name
    # Back up to the indentation before it(
    line_start = src.rfind("\n", 0, start) + 1
    end = src.find("    });", start)
    assert end != -1, old_name
    end += len("    });")
    block = src[line_start:end]
    # Extract the template body between the backticks.
    tick_start = block.find("`")
    tick_end = block.rfind("`")
    body = block[tick_start + 1:tick_end]
    replacement = (
        'it("computes division - ' + new_name + '", () => {\n'
        "        verifyUnhandledRuntimeError(`" + body + "`,\n"
        "            " + str(code) + ',\n'
        '            "' + message + '");\n'
        "    });"
    )
    return src[:line_start] + replacement + src[end:]


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

divisor_error_cases = [
    ("number divided by non-numeric string", "number divided by a non-numeric string divisor terminates"),
    ("number divided by array", "number divided by an array divisor terminates"),
    ("numeric string divided by non-numeric string", "numeric string divided by a non-numeric string divisor terminates"),
    ("numeric string divided by array", "numeric string divided by an array divisor terminates"),
    ("non-numeric string divided by non-numeric string", "non-numeric string divided by a non-numeric string divisor terminates"),
    ("non-numeric string divided by array", "non-numeric string divided by an array divisor terminates"),
    ("array divided by non-numeric string", "array divided by a non-numeric string divisor terminates"),
    ("array divided by array", "array divided by an array divisor terminates"),
]

for old_name, new_name in divisor_error_cases:
    src = replace_error_case(src, old_name, new_name, 1001, "Divide by zero.")

write(path, src)
print("division.ts done")
