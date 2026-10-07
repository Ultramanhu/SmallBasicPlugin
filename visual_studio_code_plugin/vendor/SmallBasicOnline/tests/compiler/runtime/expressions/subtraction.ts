import "jasmine";
import { verifyRuntimeResult } from "../../helpers";

// '-' subtracts the numeric value of both sides, exactly like the C# backends:
// text that is not a plain number and arrays count as 0, so 1 - "t" is 1.
describe("Compiler.Runtime.Expressions.Subtraction", () => {
    it("computes subtraction - number minus number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7 - 4)`,
            [],
            ["3"]);
    });

    it("computes subtraction - number minus numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(7 - "2")`,
            [],
            ["5"]);
    });

    it("computes subtraction - number minus non-numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(1 - "t")`,
            [],
            ["1"]);
    });

    it("computes subtraction - number minus array", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(1 - x)`,
            [],
            ["1"]);
    });

    it("computes subtraction - numeric string minus number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("6" - 4)`,
            [],
            ["2"]);
    });

    it("computes subtraction - numeric string minus numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("1" - "7")`,
            [],
            ["-6"]);
    });

    it("computes subtraction - numeric string minus non-numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("1" - "t")`,
            [],
            ["1"]);
    });

    it("computes subtraction - numeric string minus array", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine("1" - x)`,
            [],
            ["1"]);
    });

    it("computes subtraction - non-numeric string minus number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" - 5)`,
            [],
            ["-5"]);
    });

    it("computes subtraction - non-numeric string minus numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" - "4")`,
            [],
            ["-4"]);
    });

    it("computes subtraction - non-numeric string minus non-numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" - "t")`,
            [],
            ["0"]);
    });

    it("computes subtraction - non-numeric string minus array", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine("r" - x)`,
            [],
            ["0"]);
    });

    it("computes subtraction - array minus number", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x - 5)`,
            [],
            ["-5"]);
    });

    it("computes subtraction - array minus numeric string", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x - "4")`,
            [],
            ["-4"]);
    });

    it("computes subtraction - array minus non-numeric string", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x - "t")`,
            [],
            ["0"]);
    });

    it("computes subtraction - array minus array", () => {
        verifyRuntimeResult(`
x[0] = 1
y[0] = 1
TextWindow.WriteLine(x - y)`,
            [],
            ["0"]);
    });
});
