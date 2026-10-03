import { describe, expect, it } from "vitest";
import { Compilation } from "smallbasic-lang-core";
import { getMethodSignature } from "../src/language/method-signatures";

describe("method signatures (parameter hints)", () => {
  it("shows the signature right after the opening paren", () => {
    const signature = getMethodSignature("x = Math.GetRandomNumber(", "x = Math.GetRandomNumber(".length);
    expect(signature).toBeDefined();
    expect(signature!.label).toBe("Math.GetRandomNumber(maxNumber)");
    expect(signature!.activeParameter).toBe(0);
    expect(signature!.parameters[0].name).toBe("maxNumber");
  });

  it("marks the active parameter while typing arguments", () => {
    const signature = getMethodSignature(
      "Shapes.Move(shape, 10, ",
      "Shapes.Move(shape, 10, ".length
    );
    expect(signature).toBeDefined();
    expect(signature!.label).toBe("Shapes.Move(shapeName, x, y)");
    expect(signature!.activeParameter).toBe(2);
  });

  it("marks the parameter after a nested call closes", () => {
    const signature = getMethodSignature(
      "Shapes.Move(s, Math.Max(1, 2), ",
      "Shapes.Move(s, Math.Max(1, 2), ".length
    );
    expect(signature).toBeDefined();
    expect(signature!.activeParameter).toBe(2);
  });

  it("is case-insensitive on the library and method names", () => {
    const signature = getMethodSignature("math.getrandomnumber(", "math.getrandomnumber(".length);
    expect(signature).toBeDefined();
    expect(signature!.label).toBe("Math.GetRandomNumber(maxNumber)");
  });

  it("ignores commas and parens inside string literals", () => {
    const signature = getMethodSignature(
      'Shapes.Move("a, b(c", ',
      'Shapes.Move("a, b(c", '.length
    );
    expect(signature).toBeDefined();
    expect(signature!.label).toBe("Shapes.Move(shapeName, x, y)");
    expect(signature!.activeParameter).toBe(1);
  });

  it("clamps the active parameter to the last one when trailing commas exist", () => {
    const signature = getMethodSignature(
      "TextWindow.Write(\"done\", ",
      'TextWindow.Write("done", '.length
    );
    expect(signature).toBeDefined();
    expect(signature!.activeParameter).toBe(0);
  });

  it("returns nothing outside an argument list", () => {
    expect(getMethodSignature("x = Math.GetRandomNumber(5)", 28)).toBeUndefined();
    expect(getMethodSignature("x = 1, 2", "x = 1, 2".length)).toBeUndefined();
  });

  it("returns nothing for calls that are not library members", () => {
    expect(getMethodSignature("DoWork(", "DoWork(".length)).toBeUndefined();
  });

  it("returns nothing inside a comment", () => {
    expect(getMethodSignature("' Math.GetRandomNumber(", "' Math.GetRandomNumber(".length)).toBeUndefined();
  });

  it("shows user Function parameters", () => {
    const compilation = new Compilation([
      "Function Add(Left, Right)",
      "  Return Left + Right",
      "EndFunction",
      "answer = Add(1, "
    ].join("\n"));
    const signature = getMethodSignature("answer = Add(1, ", "answer = Add(1, ".length, compilation);

    expect(signature?.label).toBe("Add(Left, Right)");
    expect(signature?.activeParameter).toBe(1);
    expect(signature?.parameters.map((parameter) => parameter.name)).toEqual(["Left", "Right"]);
  });
});
