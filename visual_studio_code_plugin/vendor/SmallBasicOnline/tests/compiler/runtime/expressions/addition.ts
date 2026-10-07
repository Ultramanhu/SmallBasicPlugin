import "jasmine";
import { verifyRuntimeResult } from "../../helpers";

// '+' adds two numbers and concatenates the text form of anything else, exactly
// like the C# backends, so an array operand becomes its "index=value;" text.
describe("Compiler.Runtime.Expressions.Addition", () => {
    it("computes addition - number plus number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(1 + 4)`,
            [],
            ["5"]);
    });

    it("computes addition - number plus numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(1 + "7")`,
            [],
            ["8"]);
    });

    it("computes addition - number plus non-numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine(1 + "t")`,
            [],
            ["1t"]);
    });

    it("computes addition - number plus array", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(1 + x)`,
            [],
            ["10=1;"]);
    });

    it("computes addition - numeric string plus number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("1" + 4)`,
            [],
            ["5"]);
    });

    it("computes addition - numeric string plus numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("1" + "7")`,
            [],
            ["8"]);
    });

    it("computes addition - numeric string plus non-numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("1" + "t")`,
            [],
            ["1t"]);
    });

    it("computes addition - numeric string plus array", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine("1" + x)`,
            [],
            ["10=1;"]);
    });

    it("computes addition - non-numeric string plus number", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" + 5)`,
            [],
            ["r5"]);
    });

    it("computes addition - non-numeric string plus numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" + "4")`,
            [],
            ["r4"]);
    });

    it("computes addition - non-numeric string plus non-numeric string", () => {
        verifyRuntimeResult(`
TextWindow.WriteLine("r" + "t")`,
            [],
            ["rt"]);
    });

    it("computes addition - non-numeric string plus array", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine("r" + x)`,
            [],
            ["r0=1;"]);
    });

    it("computes addition - array plus number", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x + 5)`,
            [],
            ["0=1;5"]);
    });

    it("computes addition - array plus numeric string", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x + "4")`,
            [],
            ["0=1;4"]);
    });

    it("computes addition - array plus non-numeric string", () => {
        verifyRuntimeResult(`
x[0] = 1
TextWindow.WriteLine(x + "t")`,
            [],
            ["0=1;t"]);
    });

    it("computes addition - array plus array", () => {
        verifyRuntimeResult(`
x[0] = 1
y[0] = 1
TextWindow.WriteLine(x + y)`,
            [],
            ["0=1;0=1;"]);
    });
});
