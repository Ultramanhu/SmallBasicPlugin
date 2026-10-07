import "jasmine";
import { verifyRuntimeResult, verifyUnhandledRuntimeError } from "../../helpers";

// Mod returns the remainder of the numeric value of both sides, exactly like the
// C# backends: text that is not a plain number and arrays count as 0.
describe("Compiler.Runtime.Expressions.Modulo", () => {
    it("computes modulo - positive numbers", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7 Mod 2)`,
            [],
            ["1"]);
    });

    it("computes modulo - remainder keeps the sign of the dividend", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(-7 Mod 2)
TextWindow.WriteLine(7 Mod -2)`,
            [],
            [
                "-1",
                "1"
            ]);
    });

    it("computes modulo - exact division", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(8 Mod 2)`,
            [],
            ["0"]);
    });

    it("computes modulo - fractional operands", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7.5 Mod 2)`,
            [],
            ["1.5"]);
    });

    it("computes modulo - zero divisor terminates with a runtime error", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(4 Mod 0)`,
            1001,
            "Divide by zero.");
    });

    it("computes modulo - number with numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7 Mod "2")`,
            [],
            ["1"]);
    });

    it("computes modulo - non-numeric string operand counts as zero", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" Mod 5)`,
            [],
            ["0"]);
    });

    it("computes modulo - array operand counts as zero", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x Mod 5)`,
            [],
            ["0"]);
    });

    it("computes modulo - binds tighter than minus but looser than Multiply", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(6 Mod 4 * 2)
TextWindow.WriteLine(8 - 3 Mod 2)`,
            [],
            [
                "6",
                "7"
            ]);
    });

    it("computes modulo - case insensitive keyword", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7 mOd 2)`,
            [],
            ["1"]);
    });
});
