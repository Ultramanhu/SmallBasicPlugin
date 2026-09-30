import { afterEach, describe, expect, it } from "vitest";
import {
  Compilation,
  CompletionService,
  HoverService,
  resolveDocumentationLocale,
  setDocumentationLocale
} from "../src/index";
import { getMarkerPosition } from "../../../vendor/SmallBasicOnline/tests/compiler/helpers";

const marker = "$";

function hoverText(language: string | undefined, textWithMarker: string): string[] {
  setDocumentationLocale(resolveDocumentationLocale(language));
  const position = getMarkerPosition(textWithMarker, marker);
  const compilation = new Compilation(textWithMarker.replace(marker, ""));
  const hover = HoverService.provideHover(compilation, position);
  expect(hover).toBeDefined();
  return hover!.text;
}

function completionItem(language: string | undefined, textWithMarker: string, title: string): { description: string; insertText?: string } {
  setDocumentationLocale(resolveDocumentationLocale(language));
  const position = getMarkerPosition(textWithMarker, marker);
  const compilation = new Compilation(textWithMarker.replace(marker, ""));
  const item = CompletionService.provideCompletion(compilation, position).find((result) => result.title === title);
  expect(item).toBeDefined();
  return { description: item!.description, insertText: item!.insertText };
}

describe("documentation localization", () => {
  afterEach(() => {
    setDocumentationLocale(undefined);
  });

  it("resolves UI languages to available documentation locales", () => {
    expect(resolveDocumentationLocale("zh-cn")).toBe("zh-Hans");
    expect(resolveDocumentationLocale("zh-tw")).toBe("zh-Hant");
    expect(resolveDocumentationLocale("de")).toBe("de");
    expect(resolveDocumentationLocale("de-CH")).toBe("de");
    expect(resolveDocumentationLocale("pt-br")).toBe("pt-br");
    expect(resolveDocumentationLocale("ja")).toBe("ja");
  });

  it("leaves English and unknown languages untranslated", () => {
    expect(resolveDocumentationLocale("en")).toBeUndefined();
    expect(resolveDocumentationLocale("en-US")).toBeUndefined();
    expect(resolveDocumentationLocale(undefined)).toBeUndefined();
    expect(resolveDocumentationLocale("xx")).toBeUndefined();
    expect(resolveDocumentationLocale("zh")).toBeUndefined();
  });

  it("serves English descriptions when no locale applies", () => {
    const text = `
TextWindow.Write${marker}Line("")`;
    expect(hoverText(undefined, text)).toEqual([
      "TextWindow.WriteLine(data)",
      "Writes a string or a number to the text window on its own line.",
      "- **data**: The string or number to be written to the text window."
    ]);
  });

  it("serves Chinese descriptions for the zh-cn UI language", () => {
    const text = `
TextWindow.Write${marker}Line("")`;
    expect(hoverText("zh-cn", text)[0]).toBe("TextWindow.WriteLine(data)");
    expect(hoverText("zh-cn", text)[1]).toBe("在文本窗口中写文本或数字。一行新的字符会被附加到输出，因此下一次当新的内容写入文本窗口时会出现在新的一行中。");
  });

  it("shows parameter names in completion insert text", () => {
    const text = `
x = Math.$`;
    const item = completionItem(undefined, text, "GetRandomNumber");
    expect(item.insertText).toBe("GetRandomNumber(${1:maxNumber})");
  });

  it("localizes parameter descriptions after renaming them to match the official docs", () => {
    // The official documentation spells this parameter `value`; the metadata used
    // to call it `Index`, which hid every translation of the description.
    const text = `
x = Array.$`;
    setDocumentationLocale(resolveDocumentationLocale("zh-cn"));
    const position = getMarkerPosition(text, marker);
    const compilation = new Compilation(text.replace(marker, ""));
    const item = CompletionService.provideCompletion(compilation, position).find((result) => result.title === "ContainsValue");
    expect(item).toBeDefined();
    expect(item!.parameters).toEqual(["array", "value"]);
    expect(item!.parameterDescriptions).toEqual(["核对数组。", "核对值。"]);
    expect(item!.description).toContain("值");
  });

  it("serves Traditional Chinese descriptions for zh-tw", () => {
    const text = `
x = Math.$`;
    expect(completionItem("zh-tw", text, "Abs").description).toContain("絕對值");
  });

  it("falls back to English for keys a locale does not provide", () => {
    // Text_GetWord has no zh-Hans translation in the doc XML.
    const text = `
x = Text.$`;
    const item = completionItem("zh-cn", text, "GetWord");
    expect(item.description).toBe("Gets the word at the specified index of the given text.");
  });

  it("localizes keyword completion descriptions", () => {
    const text = `
${marker}`;
    // Without a locale the keyword snippet falls back to its title ("If").
    expect(completionItem(undefined, text, "If").description).toBe("If");
    // With a locale the description comes from the Keywords_* documentation.
    expect(completionItem("zh-cn", text, "If").description).not.toBe("If");
  });
});
