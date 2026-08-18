const migratedRootPnpmScripts = new Set([
  "dev",
  "dev:all",
  "dev:web",
  "dev:server",
  "dev:electron",
  "check",
  "test",
  "build",
  "build:web",
  "build:server",
  "build:electron",
  "build:docker",
  "pack:electron",
  "release",
  "release:electron",
  "deps:download",
]);

const pnpmNoArgumentOptions = new Set(["--silent"]);
const pnpmDirectoryOptions = new Set(["-C", "--dir"]);

export function migratedPnpmCommandSegments(source: string): string[] {
  return shellCommandSegments(source)
    .filter((segment) => isMigratedPnpmInvocation(shellTokens(segment)))
    .map((segment) => segment.trim());
}

function shellCommandSegments(source: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      current += character;
      if (character === quote) quote = undefined;
      else if (
        character === "\\" &&
        quote === '"' &&
        index + 1 < source.length
      ) {
        current += source[index + 1];
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "\\" && index + 1 < source.length) {
      current += character + source[index + 1];
      index += 1;
      continue;
    }
    if (
      character === "#" &&
      (current.length === 0 || /\s/.test(current.at(-1) ?? ""))
    ) {
      while (index + 1 < source.length && source[index + 1] !== "\n")
        index += 1;
      continue;
    }
    const pairedSeparator =
      (character === "&" || character === "|") &&
      source[index + 1] === character;
    if (
      character === "\n" ||
      character === ";" ||
      character === "|" ||
      character === "&"
    ) {
      pushSegment(segments, current);
      current = "";
      if (pairedSeparator) index += 1;
      continue;
    }
    current += character;
  }
  pushSegment(segments, current);
  return segments;
}

function pushSegment(segments: string[], candidate: string): void {
  const segment = candidate.trim();
  if (segment.length > 0) segments.push(segment);
}

function shellTokens(source: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else if (
        character === "\\" &&
        quote === '"' &&
        index + 1 < source.length
      ) {
        current += source[index + 1];
        index += 1;
      } else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character ?? "")) {
      pushToken(tokens, current);
      current = "";
      continue;
    }
    if (character === "\\" && index + 1 < source.length) {
      current += source[index + 1];
      index += 1;
      continue;
    }
    current += character;
  }
  pushToken(tokens, current);
  return tokens;
}

function pushToken(tokens: string[], candidate: string): void {
  if (candidate.length > 0) tokens.push(candidate);
}

function isMigratedPnpmInvocation(tokens: string[]): boolean {
  let index = skipEnvironmentAssignments(tokens, 0);
  if (tokens[index] === "env") {
    index = skipEnvironmentAssignments(tokens, index + 1);
  }
  const executable = tokens[index]?.toLowerCase();
  if (executable !== "pnpm" && executable !== "pnpm.exe") return false;
  index += 1;

  while (index < tokens.length) {
    const argument = tokens[index];
    if (argument === undefined) return false;
    if (
      argument === "--filter" ||
      argument === "-F" ||
      argument.startsWith("--filter=")
    ) {
      return false;
    }
    if (pnpmNoArgumentOptions.has(argument)) {
      index += 1;
      continue;
    }
    if (pnpmDirectoryOptions.has(argument)) {
      if (tokens[index + 1] === undefined) return false;
      index += 2;
      continue;
    }
    if (argument.startsWith("--dir=")) {
      index += 1;
      continue;
    }
    break;
  }

  if (tokens[index] === "run") index += 1;
  const scriptName = tokens[index]?.replace(/:raw$/, "");
  return scriptName !== undefined && migratedRootPnpmScripts.has(scriptName);
}

function skipEnvironmentAssignments(tokens: string[], start: number): number {
  let index = start;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) index += 1;
  return index;
}
