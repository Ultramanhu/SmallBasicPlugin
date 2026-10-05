import "jasmine";
import { verifyRuntimeResult, verifyRuntimeError } from "../../helpers";
import { Diagnostic, ErrorCode } from "../../../../src/compiler/utils/diagnostics";
import { CompilerRange } from "../../../../src/compiler/syntax/ranges";

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

    it("computes integer division - zero divisor yields zero without terminating", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(4 \\ 0)
TextWindow.WriteLine("after")`,
            [],
            [
                "0",
                "after"
            ]);
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

    it("computes integer division - non-numeric string operand errors", () => {
        verifyRuntimeError(`
TextWindow.WriteLine("r" \\ 5)`,
            // TextWindow.WriteLine("r" \ 5)
            //                      ^^^^^^^
            // You cannot use the operator '\' with a string value
            new Diagnostic(ErrorCode.CannotUseOperatorWithAString, CompilerRange.fromValues(1, 21, 1, 28), "\\"));
    });

    it("computes integer division - array operand errors", () => {
        verifyRuntimeError(`
x[0] = 1
TextWindow.WriteLine(x \\ 5)`,
            // TextWindow.WriteLine(x \ 5)
            //                      ^^^^^
            // You cannot use the operator '\' with an array value
            new Diagnostic(ErrorCode.CannotUseOperatorWithAnArray, CompilerRange.fromValues(2, 21, 2, 26), "\\"));
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
