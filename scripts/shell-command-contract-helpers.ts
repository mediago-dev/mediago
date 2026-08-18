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
const pnpmRepositoryOptions = new Set(["-w", "--workspace-root"]);
const shellCommandWrappers = new Set(["command", "env", "sudo"]);

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
  let index = skipInvocationPrefixes(tokens);
  const executable = tokens[index]?.toLowerCase();
  if (executable !== "pnpm" && executable !== "pnpm.exe") return false;
  index += 1;

  let packageScoped = false;
  let componentDirectory = false;
  let repositoryRootForced = false;

  while (index < tokens.length) {
    const argument = tokens[index];
    if (argument === undefined) return false;
    if (argument === "--filter" || argument === "-F") {
      if (tokens[index + 1] === undefined) return false;
      packageScoped = true;
      index += 2;
      continue;
    }
    if (argument.startsWith("--filter=")) {
      if (argument.length === "--filter=".length) return false;
      packageScoped = true;
      index += 1;
      continue;
    }
    if (pnpmNoArgumentOptions.has(argument)) {
      index += 1;
      continue;
    }
    if (pnpmRepositoryOptions.has(argument)) {
      repositoryRootForced = true;
      index += 1;
      continue;
    }
    if (pnpmDirectoryOptions.has(argument)) {
      const directory = tokens[index + 1];
      if (directory === undefined) return false;
      componentDirectory ||= !isLexicalRepositoryRoot(directory);
      index += 2;
      continue;
    }
    if (argument.startsWith("--dir=")) {
      const directory = argument.slice("--dir=".length);
      if (directory.length === 0) return false;
      componentDirectory ||= !isLexicalRepositoryRoot(directory);
      index += 1;
      continue;
    }
    break;
  }

  if (tokens[index] === "run") index += 1;
  const scriptName = tokens[index]?.replace(/:raw$/, "");
  const componentScoped =
    packageScoped || (componentDirectory && !repositoryRootForced);
  return (
    !componentScoped &&
    scriptName !== undefined &&
    migratedRootPnpmScripts.has(scriptName)
  );
}

function skipInvocationPrefixes(tokens: string[]): number {
  let index = skipEnvironmentAssignments(tokens, 0);
  while (shellCommandWrappers.has(tokens[index] ?? "")) {
    index = skipEnvironmentAssignments(tokens, index + 1);
  }
  return index;
}

function isLexicalRepositoryRoot(directory: string): boolean {
  // Documentation is untrusted input: classify only literal dot path segments
  // instead of resolving paths against the checkout or the filesystem.
  const segments = directory
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
  return segments.length > 0 && segments.every((segment) => segment === ".");
}

function skipEnvironmentAssignments(tokens: string[], start: number): number {
  let index = start;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) index += 1;
  return index;
}
