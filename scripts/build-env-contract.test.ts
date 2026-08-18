import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createScanner, SyntaxKind } from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";
import {
  buildVerificationEnvironment,
  definesSentinelEnvironmentKey,
} from "./verify-bundle-env.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const configPaths = {
  server: path.join(projectRoot, "apps/server/tsdown.config.ts"),
  electron: path.join(projectRoot, "apps/electron/tsdown.config.ts"),
  ui: path.join(projectRoot, "apps/ui/vite.config.ts"),
} as const;

function readSource(filename: string): string {
  return fs.readFileSync(filename, "utf8");
}

type ScannedToken = {
  end: number;
  kind: SyntaxKind;
  start: number;
  text: string;
  value: string;
};

type ParsedProperty = {
  name: string;
  valueEnd: number;
  valueStart: number;
};

type ParsedConfig = {
  properties: Map<string, ParsedProperty>;
  source: string;
  tokens: ScannedToken[];
};

function scan(source: string): ScannedToken[] {
  const scanner = createScanner(true, undefined, source);
  const tokens: ScannedToken[] = [];
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  ) {
    tokens.push({
      end: scanner.getTokenEnd(),
      kind,
      start: scanner.getTokenStart(),
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
    });
  }
  return tokens;
}

function parseObjectProperties(
  tokens: ScannedToken[],
  openBraceIndex: number,
): Map<string, ParsedProperty> {
  if (tokens[openBraceIndex]?.kind !== SyntaxKind.OpenBraceToken) {
    throw new Error("Expected an object literal");
  }

  const properties = new Map<string, ParsedProperty>();
  let index = openBraceIndex + 1;
  while (index < tokens.length) {
    if (tokens[index]?.kind === SyntaxKind.CloseBraceToken) return properties;

    const nameToken = tokens[index];
    if (
      !nameToken ||
      (nameToken.kind !== SyntaxKind.Identifier &&
        nameToken.kind !== SyntaxKind.StringLiteral)
    ) {
      throw new Error(`Expected an object property at token ${index}`);
    }
    const name =
      nameToken.kind === SyntaxKind.StringLiteral
        ? nameToken.value
        : nameToken.text;
    index += 1;
    if (tokens[index]?.kind !== SyntaxKind.ColonToken) {
      throw new Error(`Expected a colon after ${name}`);
    }
    index += 1;
    const valueStart = index;
    let braceDepth = 0;
    let bracketDepth = 0;
    let parenDepth = 0;

    while (index < tokens.length) {
      const kind = tokens[index]?.kind;
      if (
        braceDepth === 0 &&
        bracketDepth === 0 &&
        parenDepth === 0 &&
        (kind === SyntaxKind.CommaToken || kind === SyntaxKind.CloseBraceToken)
      ) {
        break;
      }
      if (kind === SyntaxKind.OpenBraceToken) braceDepth += 1;
      if (kind === SyntaxKind.CloseBraceToken) braceDepth -= 1;
      if (kind === SyntaxKind.OpenBracketToken) bracketDepth += 1;
      if (kind === SyntaxKind.CloseBracketToken) bracketDepth -= 1;
      if (kind === SyntaxKind.OpenParenToken) parenDepth += 1;
      if (kind === SyntaxKind.CloseParenToken) parenDepth -= 1;
      index += 1;
    }

    properties.set(name, { name, valueEnd: index, valueStart });
    if (tokens[index]?.kind === SyntaxKind.CommaToken) index += 1;
  }
  throw new Error("Unterminated object literal");
}

function exportedConfig(filename: string): ParsedConfig {
  const source = readSource(filename);
  const tokens = scan(source);
  const exportIndex = tokens.findIndex(
    (token, index) =>
      token.kind === SyntaxKind.ExportKeyword &&
      tokens[index + 1]?.kind === SyntaxKind.DefaultKeyword &&
      tokens[index + 2]?.text === "defineConfig" &&
      tokens[index + 3]?.kind === SyntaxKind.OpenParenToken &&
      tokens[index + 4]?.kind === SyntaxKind.OpenBraceToken,
  );
  if (exportIndex < 0) {
    throw new Error(`${filename} must default-export defineConfig({...})`);
  }
  return {
    properties: parseObjectProperties(tokens, exportIndex + 4),
    source,
    tokens,
  };
}

function objectProperty(config: ParsedConfig, name: string): ParsedConfig {
  const property = config.properties.get(name);
  if (
    !property ||
    config.tokens[property.valueStart]?.kind !== SyntaxKind.OpenBraceToken
  ) {
    throw new Error(`Expected ${name} to be an object literal`);
  }
  return {
    properties: parseObjectProperties(config.tokens, property.valueStart),
    source: config.source,
    tokens: config.tokens,
  };
}

function initializerText(
  config: ParsedConfig,
  name: string,
): string | undefined {
  const property = config.properties.get(name);
  if (!property || property.valueStart === property.valueEnd) return undefined;
  const start = config.tokens[property.valueStart]?.start;
  const end = config.tokens[property.valueEnd - 1]?.end;
  return start === undefined || end === undefined
    ? undefined
    : config.source.slice(start, end);
}

function definitionNames(object: ParsedConfig): string[] {
  return [...object.properties.keys()].toSorted();
}

function assertNoSecretDefinitions(definitions: string[]): void {
  const forbidden = definitions.filter((definition) => {
    const normalized = definition.toUpperCase();
    return (
      normalized.includes("TOKEN") ||
      normalized.includes("SIGN") ||
      normalized.includes("CSC") ||
      normalized.includes("OSS") ||
      normalized.endsWith("APP_ID") ||
      normalized.endsWith("APP_COPYRIGHT")
    );
  });
  expect(forbidden).toEqual([]);
}

describe("build environment contract", () => {
  it("classifies Turbo environment variables exactly", () => {
    const turbo = JSON.parse(
      readSource(path.join(projectRoot, "turbo.json")),
    ) as {
      globalEnv?: string[];
      globalPassThroughEnv?: string[];
      tasks?: { dev?: { passThroughEnv?: string[] } };
    };

    expect(turbo.globalEnv).toEqual([
      "APP_TARGET",
      "NODE_ENV",
      "MEDIAGO_PROFILE",
      "APP_VERSION",
      "APP_NAME",
      "APP_TD_APPID",
    ]);
    expect(turbo.globalPassThroughEnv).toEqual([
      "MEDIAGO_DEPS_ROOT",
      "MEDIAGO_DEPS_DIR",
      "MEDIAGO_CORE_BIN",
    ]);
    expect(turbo.tasks?.dev?.passThroughEnv).toEqual(["OPEN_DEVTOOLS"]);
  });

  it("limits server compile-time environment values to NODE_ENV and server target", () => {
    const config = exportedConfig(configPaths.server);
    const definitions = objectProperty(config, "define");

    expect(config.properties.has("env")).toBe(false);
    expect(definitionNames(definitions)).toEqual([
      "process.env.APP_TARGET",
      "process.env.NODE_ENV",
    ]);
    expect(initializerText(definitions, "process.env.APP_TARGET")).toBe(
      'JSON.stringify("server")',
    );
    assertNoSecretDefinitions(definitionNames(definitions));
    expect(
      readSource(path.join(projectRoot, "apps/server/src/index.ts")),
    ).toContain("process.env.APP_NAME");
  });

  it("limits Electron compile-time environment values to its four-item allowlist", () => {
    const config = exportedConfig(configPaths.electron);
    const definitions = objectProperty(config, "define");

    expect(config.properties.has("env")).toBe(false);
    expect(definitionNames(definitions)).toEqual([
      "process.env.APP_NAME",
      "process.env.APP_TARGET",
      "process.env.APP_VERSION",
      "process.env.NODE_ENV",
    ]);
    assertNoSecretDefinitions(definitionNames(definitions));
  });

  it("exposes only the three approved values to the UI bundle", () => {
    const config = exportedConfig(configPaths.ui);
    const definitions = objectProperty(config, "define");

    expect(initializerText(config, "envPrefix")).toBe("[]");
    expect(definitionNames(definitions)).toEqual([
      "import.meta.env.APP_TARGET",
      "import.meta.env.APP_TD_APPID",
      "import.meta.env.APP_VERSION",
    ]);
    assertNoSecretDefinitions(definitionNames(definitions));
  });

  it("resolves the UI config without exposing prefixed process variables", async () => {
    const previousSecret = process.env.VITE_UNAPPROVED_SECRET;
    process.env.VITE_UNAPPROVED_SECRET = "must-not-reach-the-client";
    try {
      const uiRequire = createRequire(
        path.join(projectRoot, "apps/ui/package.json"),
      );
      const vite = await import(pathToFileURL(uiRequire.resolve("vite")).href);
      const resolved = await vite.resolveConfig(
        {
          configFile: configPaths.ui,
          logLevel: "silent",
          mode: "production",
        },
        "build",
      );

      expect(vite.resolveEnvPrefix(resolved)).toEqual([]);
      expect(resolved.env).not.toHaveProperty("VITE_UNAPPROVED_SECRET");
      expect(Object.keys(resolved.define).toSorted()).toEqual([
        "import.meta.env.APP_TARGET",
        "import.meta.env.APP_TD_APPID",
        "import.meta.env.APP_VERSION",
      ]);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.VITE_UNAPPROVED_SECRET;
      } else {
        process.env.VITE_UNAPPROVED_SECRET = previousSecret;
      }
    }
  });

  it.each([configPaths.server, configPaths.electron])(
    "loads the selected profile before deriving development mode in %s",
    (filename) => {
      const source = readSource(filename);
      expect(source.indexOf("loadProfileEnv(projectRoot)")).toBeLessThan(
        source.indexOf('const isDev = process.env.NODE_ENV === "development"'),
      );
    },
  );

  it("uses the shared profile loader in every Node-side environment consumer", () => {
    for (const [filename, importSpecifier] of [
      [configPaths.server, "../../scripts/load-profile-env.ts"],
      [
        path.join(projectRoot, "apps/server/src/index.ts"),
        "../../../scripts/load-profile-env.ts",
      ],
      [configPaths.electron, "../../scripts/load-profile-env.ts"],
      [
        path.join(projectRoot, "apps/electron/scripts/build.ts"),
        "../../../scripts/load-profile-env.ts",
      ],
      [configPaths.ui, "../../scripts/load-profile-env.ts"],
    ] as const) {
      const source = readSource(filename);
      expect(source).toContain(`from "${importSpecifier}"`);
      expect(source).toContain("loadProfileEnv(projectRoot)");
      expect(source).not.toContain("dotenvFlow.config");
    }
  });
});

describe("bundle environment verifier", () => {
  it("removes inherited runtime hooks and the sentinel from a cloned environment", () => {
    const input: NodeJS.ProcessEnv = {
      KEEP_ME: "preserved",
      MEDIAGO_PROFILE: "test",
      MEDIAGO_TEST_SENTINEL_SECRET: "caller-value",
      NODE_OPTIONS: "--import=tsx",
    };

    const environment = buildVerificationEnvironment(input);

    expect(environment).toEqual({
      KEEP_ME: "preserved",
      MEDIAGO_PROFILE: "production",
    });
    expect(input).toEqual({
      KEEP_ME: "preserved",
      MEDIAGO_PROFILE: "test",
      MEDIAGO_TEST_SENTINEL_SECRET: "caller-value",
      NODE_OPTIONS: "--import=tsx",
    });
  });

  it.each([
    ["plain assignment", "MEDIAGO_TEST_SENTINEL_SECRET=value", true],
    ["leading whitespace", " \tMEDIAGO_TEST_SENTINEL_SECRET = value", true],
    ["export assignment", "export MEDIAGO_TEST_SENTINEL_SECRET=value", true],
    ["dotenv colon syntax", "MEDIAGO_TEST_SENTINEL_SECRET: value", true],
    ["comment", "  # MEDIAGO_TEST_SENTINEL_SECRET=value", false],
    ["prefixed key", "OTHER_MEDIAGO_TEST_SENTINEL_SECRET=value", false],
    ["value reference", "OTHER=MEDIAGO_TEST_SENTINEL_SECRET=value", false],
  ] as const)("classifies a %s", (_name, contents, expected) => {
    expect(definesSentinelEnvironmentKey(contents)).toBe(expected);
  });
});
