import "jasmine";
import { verifyRuntimeResult, verifyRuntimeError } from "../../helpers";
import { Diagnostic, ErrorCode } from "../../../../src/compiler/utils/diagnostics";
import { CompilerRange } from "../../../../src/compiler/syntax/ranges";

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

    it("computes modulo - zero divisor yields zero without terminating", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(4 Mod 0)
TextWindow.WriteLine("after")`,
            [],
            [
                "0",
                "after"
            ]);
    });

    it("computes modulo - number with numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7 Mod "2")`,
            [],
            ["1"]);
    });

    it("computes modulo - non-numeric string operand errors", () => {
        verifyRuntimeError(`
TextWindow.WriteLine("r" Mod 5)`,
            // TextWindow.WriteLine("r" Mod 5)
            //                      ^^^^^^^^^
            // You cannot use the operator 'Mod' with a string value
            new Diagnostic(ErrorCode.CannotUseOperatorWithAString, CompilerRange.fromValues(1, 21, 1, 30), "Mod"));
    });

    it("computes modulo - array operand errors", () => {
        verifyRuntimeError(`
x[0] = 1
TextWindow.WriteLine(x Mod 5)`,
            // TextWindow.WriteLine(x Mod 5)
            //                      ^^^^^^^
            // You cannot use the operator 'Mod' with an array value
            new Diagnostic(ErrorCode.CannotUseOperatorWithAnArray, CompilerRange.fromValues(2, 21, 2, 28), "Mod"));
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
