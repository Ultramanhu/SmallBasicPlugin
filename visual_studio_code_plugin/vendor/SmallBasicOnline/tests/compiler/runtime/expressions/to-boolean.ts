import "jasmine";
import { verifyRuntimeResult } from "../../helpers";

// Only the text "true" (any casing) is true, like the C# backends, and boolean
// text is normalized to "True"/"False" when it is written out.
describe("Compiler.Runtime.Expressions.ToBoolean", () => {
    const numbersTestCode = `
x = TextWindow.ReadNumber()
If x Then
    TextWindow.WriteLine("true")
Else
    TextWindow.WriteLine("false")
EndIf`;

    it("can convert variables to boolean - numbers - zero", () => {
        verifyRuntimeResult(numbersTestCode, [0], ["False"]);
    });

    it("can convert variables to boolean - numbers - positive", () => {
        verifyRuntimeResult(numbersTestCode, [1], ["False"]);
    });

    it("can convert variables to boolean - numbers - negative", () => {
        verifyRuntimeResult(numbersTestCode, [-1], ["False"]);
    });

    const stringsTestCode = `
x = TextWindow.Read()
If x Then
    TextWindow.WriteLine("true")
Else
    TextWindow.WriteLine("false")
EndIf`;

    it("can convert variables to boolean - strings - correct case True", () => {
        verifyRuntimeResult(stringsTestCode, ["True"], ["True"]);
    });

    it("can convert variables to boolean - strings - upper case TRUE", () => {
        verifyRuntimeResult(stringsTestCode, ["TRUE"], ["True"]);
    });

    it("can convert variables to boolean - strings - lower case true", () => {
        verifyRuntimeResult(stringsTestCode, ["true"], ["True"]);
    });

    it("can convert variables to boolean - strings - false", () => {
        verifyRuntimeResult(stringsTestCode, ["False"], ["False"]);
    });

    it("can convert variables to boolean - strings - anything", () => {
        verifyRuntimeResult(stringsTestCode, ["random string"], ["False"]);
    });

    it("can convert variables to boolean - arrays", () => {
        verifyRuntimeResult(`
x[0] = 1
If x Then
    TextWindow.WriteLine("true")
Else
    TextWindow.WriteLine("false")
EndIf`,
            [],
            ["False"]);
    });
});
