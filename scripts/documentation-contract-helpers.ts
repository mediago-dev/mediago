import { migratedPnpmCommandSegments } from "./shell-command-contract-helpers.ts";

interface CodeBlock {
  body: string;
  index: number;
}

const namedHtmlEntities: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&apos;": "'",
  "&gt;": ">",
  "&lt;": "<",
  "&nbsp;": " ",
  "&quot;": '"',
  "&#39;": "'",
};

export function migratedPnpmCommandsInCodeBlocks(source: string): string[] {
  return extractCodeBlocks(source).flatMap((block) =>
    migratedPnpmCommandSegments(normalizeContinuations(block.body)),
  );
}

function extractCodeBlocks(source: string): CodeBlock[] {
  const htmlBlocks = extractHtmlCodeBlocks(source);
  const markdownSource = maskRanges(
    source,
    htmlBlocks.map((block) => block.range),
  );
  return [
    ...htmlBlocks.map(({ body, index }) => ({ body, index })),
    ...extractMarkdownCodeBlocks(markdownSource),
  ].toSorted((left, right) => left.index - right.index);
}

function extractHtmlCodeBlocks(
  source: string,
): Array<CodeBlock & { range: [number, number] }> {
  const blocks: Array<CodeBlock & { range: [number, number] }> = [];
  let state: HtmlCodeState = { kind: "outside" };
  let cursor = 0;
  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart < 0) break;
    const tagEnd = source.indexOf(">", tagStart + 1);
    if (tagEnd < 0) break;
    const textBeforeTag = source.slice(cursor, tagStart);
    const tag = parseHtmlTag(source.slice(tagStart + 1, tagEnd));

    if (
      (state.kind === "awaiting-code" || state.kind === "awaiting-pre-close") &&
      textBeforeTag.trim().length > 0
    ) {
      state = { kind: "outside" };
    }

    if (tag !== undefined) {
      if (state.kind === "outside") {
        if (!tag.closing && tag.name === "pre") {
          state = { kind: "awaiting-code", preStart: tagStart };
        }
      } else if (state.kind === "awaiting-code") {
        if (!tag.closing && tag.name === "code") {
          state = {
            kind: "inside-code",
            bodyStart: tagEnd + 1,
            preStart: state.preStart,
          };
        } else if (!tag.closing && tag.name === "pre") {
          state = { kind: "awaiting-code", preStart: tagStart };
        } else {
          state = { kind: "outside" };
        }
      } else if (state.kind === "inside-code") {
        if (tag.closing && tag.name === "code") {
          state = {
            kind: "awaiting-pre-close",
            bodyEnd: tagStart,
            bodyStart: state.bodyStart,
            preStart: state.preStart,
          };
        }
      } else if (tag.closing && tag.name === "pre") {
        blocks.push({
          body: decodeHtmlEntities(
            stripHtmlTags(source.slice(state.bodyStart, state.bodyEnd)),
          ),
          index: state.preStart,
          range: [state.preStart, tagEnd + 1],
        });
        state = { kind: "outside" };
      } else if (!tag.closing && tag.name === "pre") {
        state = { kind: "awaiting-code", preStart: tagStart };
      } else {
        state = { kind: "outside" };
      }
    }
    cursor = tagEnd + 1;
  }
  return blocks;
}

function stripHtmlTags(source: string): string {
  let content = "";
  let insideTag = false;
  for (const character of source) {
    if (!insideTag && character === "<") insideTag = true;
    else if (insideTag && character === ">") insideTag = false;
    else if (!insideTag) content += character;
  }
  return content;
}

type HtmlCodeState =
  | { kind: "outside" }
  | { kind: "awaiting-code"; preStart: number }
  | { kind: "inside-code"; bodyStart: number; preStart: number }
  | {
      kind: "awaiting-pre-close";
      bodyEnd: number;
      bodyStart: number;
      preStart: number;
    };

function parseHtmlTag(
  source: string,
): { closing: boolean; name: string } | undefined {
  let index = 0;
  while (source[index] === " " || source[index] === "\t") index += 1;
  const closing = source[index] === "/";
  if (closing) index += 1;
  const nameStart = index;
  while (
    (source[index] >= "A" && source[index] <= "Z") ||
    (source[index] >= "a" && source[index] <= "z")
  ) {
    index += 1;
  }
  if (index === nameStart) return undefined;
  return { closing, name: source.slice(nameStart, index).toLowerCase() };
}

function maskRanges(source: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return source;
  const pieces: string[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    pieces.push(source.slice(cursor, start));
    pieces.push(source.slice(start, end).replace(/[^\r\n]/g, " "));
    cursor = end;
  }
  pieces.push(source.slice(cursor));
  return pieces.join("");
}

function extractMarkdownCodeBlocks(source: string): CodeBlock[] {
  const lines = sourceLines(source);
  const blocks: CodeBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const fence = openingFence(line.text);
    if (fence !== undefined) {
      const body: string[] = [];
      const blockIndex = line.index;
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index];
        if (candidate === undefined) break;
        if (isClosingFence(candidate.text, fence)) break;
        body.push(candidate.text);
        index += 1;
      }
      blocks.push({ body: body.join("\n"), index: blockIndex });
      continue;
    }

    const firstIndentedLine = deindentCodeLine(line.text);
    if (firstIndentedLine === undefined) continue;
    const body = [firstIndentedLine];
    const blockIndex = line.index;
    while (index + 1 < lines.length) {
      const candidate = lines[index + 1];
      if (candidate === undefined) break;
      const deindented = deindentCodeLine(candidate.text);
      if (deindented !== undefined) {
        body.push(deindented);
        index += 1;
        continue;
      }
      if (candidate.text.trim().length === 0) {
        body.push("");
        index += 1;
        continue;
      }
      break;
    }
    blocks.push({ body: body.join("\n"), index: blockIndex });
  }
  return blocks;
}

function sourceLines(source: string): Array<{ index: number; text: string }> {
  const lines: Array<{ index: number; text: string }> = [];
  let offset = 0;
  for (const rawLine of source.split("\n")) {
    const text = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    lines.push({ index: offset, text });
    offset += rawLine.length + 1;
  }
  return lines;
}

interface Fence {
  character: "`" | "~";
  length: number;
}

function openingFence(line: string): Fence | undefined {
  const indentation = leadingSpaces(line);
  if (indentation > 3) return undefined;
  const content = line.slice(indentation);
  const character = content[0];
  if (character !== "`" && character !== "~") return undefined;
  const length = markerLength(content, character);
  return length >= 3 ? { character, length } : undefined;
}

function isClosingFence(line: string, fence: Fence): boolean {
  const indentation = leadingSpaces(line);
  if (indentation > 3) return false;
  const content = line.slice(indentation);
  const length = markerLength(content, fence.character);
  return length >= fence.length && content.slice(length).trim().length === 0;
}

function markerLength(source: string, character: string): number {
  let length = 0;
  while (source[length] === character) length += 1;
  return length;
}

function leadingSpaces(source: string): number {
  let length = 0;
  while (source[length] === " ") length += 1;
  return length;
}

function deindentCodeLine(line: string): string | undefined {
  if (line.startsWith("\t")) return line.slice(1);
  return line.startsWith("    ") ? line.slice(4) : undefined;
}

function decodeHtmlEntities(source: string): string {
  return source.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#39|#x[0-9a-f]{1,6}|#[0-9]{1,7});/gi,
    (entity) => {
      const normalized = entity.toLowerCase();
      const named = namedHtmlEntities[normalized];
      if (named !== undefined) return named;
      const hexadecimal = normalized.startsWith("&#x");
      const digits = normalized.slice(hexadecimal ? 3 : 2, -1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      return Number.isSafeInteger(codePoint) &&
        codePoint <= 0x10ffff &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

function normalizeContinuations(source: string): string {
  let normalized = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (
      (character === "\\" || character === "`" || character === "^") &&
      (source[index + 1] === "\n" ||
        (source[index + 1] === "\r" && source[index + 2] === "\n"))
    ) {
      index += source[index + 1] === "\r" ? 2 : 1;
      while (source[index + 1] === " " || source[index + 1] === "\t") {
        index += 1;
      }
      continue;
    }
    normalized += character;
  }
  return normalized;
}
