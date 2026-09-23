import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const appStoreMocks = vi.hoisted(() => {
  const state = {
    enableMcp: true,
    mcpToken: "test-token",
    apiKey: "test-api-key",
    local: "/tmp/downloads",
    theme: "system",
    setAppStore: vi.fn(),
  };
  const useAppStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    {
      getState: () => state,
      subscribe: vi.fn(() => () => undefined),
    },
  );
  return { state, useAppStore };
});

const mcpStatusMocks = vi.hoisted(() => ({
  status: {
    enabled: true,
    running: true,
    endpoint: "/mcp",
    error: "",
  },
}));

const sessionStoreMocks = vi.hoisted(() => ({
  state: {
    updateAvailable: false,
    updateState: {
      status: "idle",
      currentVersion: "",
      progress: 0,
      autoDownload: true,
      portable: false,
    },
  },
}));

const webAppearanceStoreMocks = vi.hoisted(() => ({
  state: {
    theme: "system",
    setTheme: vi.fn(),
  },
}));

const environmentMocks = vi.hoisted(() => ({
  isWeb: true,
  coreUrl: "http://192.168.1.20:9900",
}));

const translationMocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => key),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => translationMocks,
}));

vi.mock("swr", () => ({
  default: () => ({
    data: mcpStatusMocks.status,
    mutate: vi.fn(),
  }),
}));

vi.mock("@/services/adapter-bootstrap", () => ({
  getAdapterCoreUrl: () => environmentMocks.coreUrl,
}));

vi.mock("@/hooks/use-platform", () => ({
  usePlatform: () => ({ shell: { open: vi.fn() } }),
}));

vi.mock("@/hooks/use-config", () => ({
  useEnvPath: () => ({ envPath: null }),
}));

vi.mock("@/store/app", () => ({
  useAppStore: appStoreMocks.useAppStore,
}));

vi.mock("@/store/session", () => ({
  useSessionStore: (
    selector: (value: typeof sessionStoreMocks.state) => unknown,
  ) => selector(sessionStoreMocks.state),
}));

vi.mock("@/store/web-appearance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/web-appearance")>()),
  useWebAppearanceStore: (
    selector: (value: typeof webAppearanceStoreMocks.state) => unknown,
  ) => selector(webAppearanceStoreMocks.state),
}));

vi.mock("@/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils")>()),
  get isWeb() {
    return environmentMocks.isWeb;
  },
}));

const { SettingsFormProvider } = await import("./setting-fields");
const { BasicSettingsCard, MCPSettingsCard, MoreSettingsCard } =
  await import("./setting-sections");

beforeEach(() => {
  environmentMocks.isWeb = true;
  environmentMocks.coreUrl = "http://192.168.1.20:9900";
  translationMocks.t.mockClear();
  appStoreMocks.state.enableMcp = true;
  appStoreMocks.state.mcpToken = "test-token";
  appStoreMocks.state.apiKey = "test-api-key";
  mcpStatusMocks.status.enabled = true;
  mcpStatusMocks.status.running = true;
  mcpStatusMocks.status.error = "";
});

test("renders MCP URL and token as separate labelled read-only inputs", () => {
  const html = renderToStaticMarkup(
    createElement(SettingsFormProvider, null, createElement(MCPSettingsCard)),
  );

  expect(html).toContain('for="mcp-url"');
  expect(html).toContain('id="mcp-url"');
  expect(html).toContain('value="http://192.168.1.20:9900/mcp"');
  expect(html).toContain('for="mcp-token"');
  expect(html).toContain('id="mcp-token"');
  expect(html).toContain('value="test-token"');
  expect(html.match(/readOnly=""/g) ?? []).toHaveLength(2);
  expect(html).not.toContain("<textarea");
  expect(translationMocks.t).toHaveBeenCalledWith("mcpAgentConfigPrompt", {
    endpoint: "http://192.168.1.20:9900/mcp",
    token: "test-token",
    serverId: "mediago-downloader",
    serverName: "mediago downloader",
  });
});

test.each(["http://127.0.0.1:39719", "http://192.168.1.20:39719"])(
  "uses localhost in the desktop display and Agent configuration for %s",
  (coreUrl) => {
    environmentMocks.isWeb = false;
    environmentMocks.coreUrl = coreUrl;
    const html = renderToStaticMarkup(
      createElement(SettingsFormProvider, null, createElement(MCPSettingsCard)),
    );

    expect(html).toContain('value="http://localhost:39719/mcp"');
    expect(translationMocks.t).toHaveBeenCalledWith("mcpAgentConfigPrompt", {
      endpoint: "http://localhost:39719/mcp",
      token: "test-token",
      serverId: "mediago-downloader",
      serverName: "mediago downloader",
    });
  },
);

test("keeps the desktop MCP URL empty until Core is ready", () => {
  environmentMocks.isWeb = false;
  environmentMocks.coreUrl = "";
  const html = renderToStaticMarkup(
    createElement(SettingsFormProvider, null, createElement(MCPSettingsCard)),
  );

  expect(html).not.toContain("http://localhost");
  expect(html).toContain("mcpCopyRequiresRunning");
  expect(translationMocks.t).not.toHaveBeenCalledWith(
    "mcpAgentConfigPrompt",
    expect.anything(),
  );
});

test("renders the browser-local theme selector in web settings", () => {
  const html = renderToStaticMarkup(
    createElement(SettingsFormProvider, null, createElement(BasicSettingsCard)),
  );

  expect(html).toContain('for="setting-theme"');
  expect(html).toContain('id="setting-theme"');
  expect(html).toContain("downloaderTheme");
});

test("keeps regenerate and copy actions on the same full-width row", () => {
  const html = renderToStaticMarkup(
    createElement(SettingsFormProvider, null, createElement(MCPSettingsCard)),
  );
  const actions = html.match(/<div[^>]*data-mcp-actions="true"[^>]*>/)?.[0];
  const labelIndex = html.indexOf(">mcpAgentConfig</div>");
  const rowStart = html.lastIndexOf('<div role="group"', labelIndex);
  const rowOpeningTag = html.slice(rowStart, html.indexOf(">", rowStart) + 1);

  expect(actions).toBeTypeOf("string");
  expect(actions).toContain("w-full");
  expect(actions).toContain("flex-nowrap");
  expect(rowOpeningTag).toContain(
    "@min-[15rem]/settings:grid-cols-[minmax(112px,0.85fr)_minmax(0,1.15fr)]",
  );
  expect(rowOpeningTag).toContain(
    "@sm/settings:grid-cols-[minmax(140px,0.85fr)_minmax(180px,1.15fr)]",
  );
  expect(rowOpeningTag).not.toContain("@sm/settings:grid-cols-1");
});

test("disables Agent configuration copy until MCP is running", () => {
  mcpStatusMocks.status.running = false;

  const html = renderToStaticMarkup(
    createElement(SettingsFormProvider, null, createElement(MCPSettingsCard)),
  );
  const labelIndex = html.indexOf(">mcpCopyForAgent</button>");
  const buttonStart = html.lastIndexOf("<button", labelIndex);
  const buttonOpeningTag = html.slice(
    buttonStart,
    html.indexOf(">", buttonStart) + 1,
  );

  expect(buttonOpeningTag).toContain('disabled=""');
  expect(html).toContain("mcpCopyRequiresRunning");
});

test("renders a dedicated API key copy action in web settings", () => {
  const html = renderToStaticMarkup(
    createElement(MoreSettingsCard, { onCheckUpdate: vi.fn() }),
  );
  const labelIndex = html.indexOf('aria-label="copyApiKey"');
  const buttonStart = html.lastIndexOf("<button", labelIndex);
  const buttonOpeningTag = html.slice(
    buttonStart,
    html.indexOf(">", buttonStart) + 1,
  );

  expect(html).toContain('id="setting-web-api-key"');
  expect(html).toContain('value="test-api-key"');
  expect(buttonOpeningTag).toContain('title="copyApiKey"');
  expect(buttonOpeningTag).not.toContain('disabled=""');
});
