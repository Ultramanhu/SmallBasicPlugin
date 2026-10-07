import "jasmine";
import { verifyRuntimeResult } from "../../helpers";

// '*' multiplies the numeric value of both sides, exactly like the C# backends:
// text that is not a plain number and arrays count as 0, so 1 * "t" is 0.
describe("Compiler.Runtime.Expressions.Multiplication", () => {
    it("computes multiplication - number multiplied by number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(3 * 4)`,
            [],
            ["12"]);
    });

    it("computes multiplication - number multiplied by numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(4 * "2")`,
            [],
            ["8"]);
    });

    it("computes multiplication - number multiplied by non-numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(1 * "t")`,
            [],
            ["0"]);
    });

    it("computes multiplication - number multiplied by array", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(1 * x)`,
            [],
            ["0"]);
    });

    it("computes multiplication - numeric string multiplied by number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("6" * 4)`,
            [],
            ["24"]);
    });

    it("computes multiplication - numeric string multiplied by numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("1" * "7")`,
            [],
            ["7"]);
    });

    it("computes multiplication - numeric string multiplied by non-numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("1" * "t")`,
            [],
            ["0"]);
    });

    it("computes multiplication - numeric string multiplied by array", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine("1" * x)`,
            [],
            ["0"]);
    });

    it("computes multiplication - non-numeric string multiplied by number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" * 5)`,
            [],
            ["0"]);
    });

    it("computes multiplication - non-numeric string multiplied by numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" * "4")`,
            [],
            ["0"]);
    });

    it("computes multiplication - non-numeric string multiplied by non-numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" * "t")`,
            [],
            ["0"]);
    });

    it("computes multiplication - non-numeric string multiplied by array", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine("r" * x)`,
            [],
            ["0"]);
    });

    it("computes multiplication - array multiplied by number", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x * 5)`,
            [],
            ["0"]);
    });

    it("computes multiplication - array multiplied by numeric string", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x * "4")`,
            [],
            ["0"]);
    });

    it("computes multiplication - array multiplied by non-numeric string", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x * "t")`,
            [],
            ["0"]);
    });

    it("computes multiplication - array multiplied by array", () => {
        verifyRuntimeResult(`
x[0] = 1
y[0] = 1
TextWindow.WriteLine(x * y)`,
            [],
            ["0"]);
    });
});
