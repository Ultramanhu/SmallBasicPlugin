import "jasmine";
import { verifyRuntimeResult, verifyUnhandledRuntimeError } from "../../helpers";

// '/' divides the numeric value of both sides, exactly like the C# backends:
// text that is not a plain number and arrays count as 0. A zero divisor (also
// after folding "t" or an array to 0) is a runtime error that On Error can
// catch; without a handler the program terminates with code 1001.
describe("Compiler.Runtime.Expressions.Division", () => {
    it("computes division - division by zero terminates with a runtime error", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(4 / 0)`,
            1001,
            "Divide by zero.");
    });

    it("computes division - number divided by number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(8 / 4)`,
            [],
            ["2"]);
    });

    it("computes division - number divided by numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(4 / "2")`,
            [],
            ["2"]);
    });

    it("computes division - number divided by a non-numeric string divisor terminates", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine(1 / "t")`,
            1001,
            "Divide by zero.");
    });

    it("computes division - number divided by an array divisor terminates", () => {
        verifyUnhandledRuntimeError(`
x[0] = 1
TextWindow.WriteLine(1 / x)`,
            1001,
            "Divide by zero.");
    });

    it("computes division - numeric string divided by number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("6" / 4)`,
            [],
            ["1.5"]);
    });

    it("computes division - numeric string divided by numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("14" / "7")`,
            [],
            ["2"]);
    });

    it("computes division - numeric string divided by a non-numeric string divisor terminates", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine("1" / "t")`,
            1001,
            "Divide by zero.");
    });

    it("computes division - numeric string divided by an array divisor terminates", () => {
        verifyUnhandledRuntimeError(`
x[0] = 1
TextWindow.WriteLine("1" / x)`,
            1001,
            "Divide by zero.");
    });

    it("computes division - non-numeric string divided by number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" / 5)`,
            [],
            ["0"]);
    });

    it("computes division - non-numeric string divided by numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" / "4")`,
            [],
            ["0"]);
    });

    it("computes division - non-numeric string divided by a non-numeric string divisor terminates", () => {
        verifyUnhandledRuntimeError(`
TextWindow.WriteLine("r" / "t")`,
            1001,
            "Divide by zero.");
    });

    it("computes division - non-numeric string divided by an array divisor terminates", () => {
        verifyUnhandledRuntimeError(`
x[0] = 1
TextWindow.WriteLine("r" / x)`,
            1001,
            "Divide by zero.");
    });

    it("computes division - array divided by number", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x / 5)`,
            [],
            ["0"]);
    });

    it("computes division - array divided by numeric string", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x / "4")`,
            [],
            ["0"]);
    });

    it("computes division - array divided by a non-numeric string divisor terminates", () => {
        verifyUnhandledRuntimeError(`
x[0] = 1
TextWindow.WriteLine(x / "t")`,
            1001,
            "Divide by zero.");
    });

    it("computes division - array divided by an array divisor terminates", () => {
        verifyUnhandledRuntimeError(`
x[0] = 1
y[0] = 1
TextWindow.WriteLine(x / y)`,
            1001,
            "Divide by zero.");
    });
});
