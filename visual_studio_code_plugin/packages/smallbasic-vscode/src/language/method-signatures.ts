import { CompilerUtils, RuntimeLibraries } from "smallbasic-lang-core";

export interface SignatureParameter {
  name: string;
  description: string;
}

export interface MethodSignature {
  /** e.g. `Math.GetRandomNumber(maxNumber)`, spelled like the official docs. */
  label: string;
  /** Localized summary of the method. */
  description: string;
  /** Localized docs, ordered like the parameters in `label`. */
  parameters: SignatureParameter[];
  /** Zero-based index of the argument the caret sits in. */
  activeParameter: number;
}

interface EnclosingInvocation {
  library: string;
  method: string;
  activeParameter: number;
}

interface MethodMetadataLike {
  readonly methodName: string;
  readonly parameters: ReadonlyArray<string>;
  readonly displayParameterNames: ReadonlyArray<string>;
  readonly description: string;
  parameterDescription(name: string): string;
}

// Parameter hints for Small Basic follow the same convention as other
// languages: while the caret sits inside the argument list of a library call
// such as `Math.GetRandomNumber(...)`, the signature with the active
// parameter is shown. Signatures and parameter docs come from the localized
// library documentation. This module is editor-agnostic so tests can drive it
// without a VS Code instance; signature-help.ts maps the result onto the API.
export function getMethodSignature(line: string, caret: number): MethodSignature | undefined {
  const invocation = findEnclosingInvocation(line, caret);
  if (!invocation) {
    return undefined;
  }

  const method = lookupMethod(invocation.library, invocation.method);
  if (!method) {
    return undefined;
  }

  const { libraryName, methodName, metadata } = method;
  return {
    label: `${libraryName}.${methodName}(${metadata.displayParameterNames.join(", ")})`,
    description: metadata.description,
    parameters: metadata.displayParameterNames.map((name, index) => ({
      name,
      description: metadata.parameterDescription(metadata.parameters[index])
    })),
    activeParameter: Math.max(
      0,
      Math.min(invocation.activeParameter, metadata.parameters.length - 1)
    )
  };
}

function lookupMethod(libraryName: string, methodName: string):
  { libraryName: string; methodName: string; metadata: MethodMetadataLike } | undefined {
  const libraryKey = CompilerUtils.findKeyIgnoreCase(RuntimeLibraries.Metadata, libraryName);
  if (libraryKey === undefined) {
    return undefined;
  }

  const library = RuntimeLibraries.Metadata[libraryKey];
  const methodKey = CompilerUtils.findKeyIgnoreCase(library.methods, methodName);
  if (methodKey === undefined) {
    return undefined;
  }

  return { libraryName: libraryKey, methodName: methodKey, metadata: library.methods[methodKey] };
}

// Small Basic statements are single-line, so the scan never leaves the line
// containing the caret.
function findEnclosingInvocation(line: string, caret: number): EnclosingInvocation | undefined {
  const openParens: number[] = [];
  // commasPerDepth[n] counts the top-level commas inside the paren whose
  // nesting depth is n, so the count for the innermost open paren survives
  // closing a nested call.
  const commasPerDepth: number[] = [];
  let inString = false;

  const end = Math.min(caret, line.length);
  for (let index = 0; index < end; index++) {
    const character = line[index];
    if (inString) {
      if (character === '"') {
        inString = false;
      }
      continue;
    }

    switch (character) {
      case '"':
        inString = true;
        break;
      case "'":
        // A quote starts a comment that runs to the end of the line.
        return undefined;
      case "(":
        openParens.push(index);
        commasPerDepth[openParens.length] = 0;
        break;
      case ")":
        if (openParens.length === 0) {
          return undefined;
        }
        openParens.pop();
        break;
      case ",":
        if (openParens.length > 0) {
          commasPerDepth[openParens.length] += 1;
        }
        break;
      default:
        break;
    }
  }

  const openParen = openParens[openParens.length - 1];
  if (openParen === undefined || inString) {
    return undefined;
  }

  const names = matchMethodName(line, openParen);
  if (!names) {
    return undefined;
  }

  return {
    library: names.library,
    method: names.method,
    activeParameter: commasPerDepth[openParens.length] ?? 0
  };
}

function matchMethodName(line: string, openParen: number): { library: string; method: string } | undefined {
  let index = openParen - 1;
  while (index >= 0 && (line[index] === " " || line[index] === "\t")) {
    index -= 1;
  }

  const methodEnd = index + 1;
  while (index >= 0 && isIdentifierCharacter(line[index])) {
    index -= 1;
  }
  const method = line.slice(index + 1, methodEnd);

  if (!method || index < 0 || line[index] !== ".") {
    return undefined;
  }
  index -= 1;

  const libraryEnd = index + 1;
  while (index >= 0 && isIdentifierCharacter(line[index])) {
    index -= 1;
  }
  const library = line.slice(index + 1, libraryEnd);

  return library ? { library, method } : undefined;
}

function isIdentifierCharacter(character: string): boolean {
  return (
    (character >= "a" && character <= "z")
    || (character >= "A" && character <= "Z")
    || (character >= "0" && character <= "9")
    || character === "_"
  );
}
