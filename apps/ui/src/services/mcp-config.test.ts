import {
  BASE_I18N_OPTIONS,
  i18nResources,
  type ResolvedAppLanguage,
} from "@mediago/common";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { buildMCPAgentConfig, buildMCPEndpoint } from "./mcp-config";

describe("buildMCPEndpoint", () => {
  it.each([
    ["http://127.0.0.1:9900", "http://127.0.0.1:9900/mcp"],
    ["http://192.168.1.10:39719/", "http://192.168.1.10:39719/mcp"],
    ["https://media.example/settings", "https://media.example/mcp"],
  ])("joins %s to the backend MCP route", (coreUrl, endpoint) => {
    expect(buildMCPEndpoint(coreUrl)).toBe(endpoint);
  });

  it.each([
    ["http://127.0.0.1:39719", "http://localhost:39719/mcp"],
    ["http://127.0.0.1:9900/", "http://localhost:9900/mcp"],
    ["http://192.168.1.20:9900", "http://localhost:9900/mcp"],
    ["http://localhost:39719", "http://localhost:39719/mcp"],
    ["http://[::1]:39719", "http://localhost:39719/mcp"],
    ["  http://127.0.0.1:8899/settings  ", "http://localhost:8899/mcp"],
  ])("uses localhost for desktop Core URL %s", (coreUrl, endpoint) => {
    expect(buildMCPEndpoint(coreUrl, "desktop")).toBe(endpoint);
    expect(
      buildMCPAgentConfig(coreUrl, "secret", undefined, "desktop"),
    ).toContain(`URL: ${endpoint}`);
  });

  it("does not guess an endpoint before the backend URL is ready", () => {
    expect(buildMCPEndpoint("  ")).toBe("");
    expect(buildMCPEndpoint("  ", "desktop")).toBe("");
    expect(buildMCPAgentConfig("", "secret")).toBe("");
    expect(buildMCPAgentConfig("", "secret", undefined, "desktop")).toBe("");
    expect(buildMCPAgentConfig("http://127.0.0.1:9900", "  ")).toBe("");
  });
});

it("builds the copied agent configuration", () => {
  const config = buildMCPAgentConfig("http://server:8899", "secret");

  expect(config).toContain('"mediago-downloader"');
  expect(config).toContain('"mediago downloader"');
  expect(config).toContain("Transport: Streamable HTTP");
  expect(config).toContain("URL: http://server:8899/mcp");
  expect(config).toContain("Authorization: Bearer secret");
  expect(config).toContain("same machine as MediaGo");
  expect(config).toContain("health_check");
});

const localizedAgentConfigCases = [
  ["zh", "请在当前 Agent 客户端中配置"],
  ["en", "Configure an MCP server"],
  ["it", "Configura un server MCP"],
] as const satisfies ReadonlyArray<readonly [ResolvedAppLanguage, string]>;

describe.each(["desktop", "web"] as const)(
  "%s Agent configuration",
  (target) => {
    it.each(localizedAgentConfigCases)(
      "builds the copied Agent instruction in %s",
      async (language, expectedText) => {
        const i18n = createInstance();
        await i18n.init({
          ...BASE_I18N_OPTIONS,
          lng: language,
          resources: {
            [language]: { translation: i18nResources[language] },
          },
        });

        const config = buildMCPAgentConfig(
          "http://192.168.1.20:9900",
          "secret",
          (values) => i18n.t("mcpAgentConfigPrompt", values),
          target,
        );

        expect(config).toContain(expectedText);
        expect(config).toContain(
          target === "desktop"
            ? "http://localhost:9900/mcp"
            : "http://192.168.1.20:9900/mcp",
        );
        expect(config).toContain("mediago-downloader");
        expect(config).toContain("mediago downloader");
        expect(config).toContain("Authorization: Bearer secret");
        expect(config).not.toContain("{{");
      },
    );
  },
);
