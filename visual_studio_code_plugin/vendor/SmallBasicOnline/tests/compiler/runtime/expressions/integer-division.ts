import "jasmine";
import { verifyRuntimeResult, verifyUnhandledRuntimeError } from "../../helpers";

// '\' divides the numeric value of both sides, exactly like the C# backends:
// text that is not a plain number and arrays count as 0.
describe("Compiler.Runtime.Expressions.IntegerDivision", () => {
    it("computes integer division - positive numbers", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7 \\ 2)`,
            [],
            ["3"]);
    });

    it("computes integer division - truncates toward zero for negative dividends", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(-7 \\ 2)`,
            [],
            ["-3"]);
    });

    it("computes integer division - exact quotient", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(8 \\ 2)`,
            [],
            ["4"]);
    });

    it("computes integer division - fractional operands truncate the real quotient", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7.9 \\ 2.9)`,
            [],
            ["2"]);
    });

    it("computes integer division - zero divisor terminates with a runtime error", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(4 \\ 0)`,
            1001,
            "Divide by zero.");
    });

    it("computes integer division - number divided by numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7 \\ "2")`,
            [],
            ["3"]);
    });

    it("computes integer division - numeric string divided by number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("6" \\ 4)`,
            [],
            ["1"]);
    });

    it("computes integer division - non-numeric string operand counts as zero", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" \\ 5)`,
            [],
            ["0"]);
    });

    it("computes integer division - array operand counts as zero", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x \\ 5)`,
            [],
            ["0"]);
    });

    it("computes integer division - binds tighter than Mod but looser than Multiply", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(12 \\ 4 Mod 3)
TextWindow.WriteLine(7 \\ 2 * 3)`,
            [],
            [
                "0",
                "1"
            ]);
    });

    it("computes integer division - left associative", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(8 \\ 2 \\ 2)`,
            [],
            ["2"]);
    });
});
