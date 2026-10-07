import "jasmine";
import { verifyRuntimeResult } from "../../helpers";

// Unary minus negates the numeric value of its operand, exactly like the C#
// backends: text that is not a plain number and arrays count as 0.
describe("Compiler.Runtime.Expressions.Negation", () => {
    it("can negate variables - numbers", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(-2)`,
            [],
            ["-2"]);
    });

    it("can negate variables - non-numeric strings", () => {
        verifyRuntimeResult(`
x = "a"
TextWindow.WriteLine(-x)`,
            [],
            ["0"]);
    });

    it("can negate variables - numeric strings", () => {
        verifyRuntimeResult(`
x = "5"
TextWindow.WriteLine(-x)`,
            [],
            ["-5"]);
    });

    it("can negate variables - arrays", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(-x)`,
            [],
            ["0"]);
    });
});
