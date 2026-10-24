import i18next, { type i18n } from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { resources } from "../i18n/resources";
import type {
  ExtensionLanguage,
  ExtensionSettings,
  InvocationMode,
  LocalizedMessage,
  ServerStatus,
} from "../shared/types";
import * as optionsApp from "./App";

interface OptionsViewProps {
  settings: ExtensionSettings | null;
  draft: {
    mode: InvocationMode;
    serverUrl: string;
    apiKey: string;
  };
  loading: boolean;
  loadError: LocalizedMessage | string | null;
  testing: boolean;
  savingConnection: boolean;
  savingPreference: boolean;
  lastStatus: ServerStatus | null;
  version: string;
  onRetry: () => void;
  onModeChange: (mode: InvocationMode) => void;
  onServerUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onTest: () => void;
  onSaveConnection: () => void;
  onDownloadNowChange: (checked: boolean) => void;
  onPageQuickActionEnabledChange: (checked: boolean) => void;
  onLanguageChange: (language: ExtensionLanguage) => void;
}

type OptionsViewComponent = (props: OptionsViewProps) => React.ReactNode;

type ResolveExtensionVersion = (manifest: {
  version: string;
  version_name?: string;
}) => string;

const settings: ExtensionSettings = {
  mode: "desktop-http",
  serverUrl: "",
  apiKey: "",
  downloadNow: false,
  language: "en",
  pageQuickActionEnabled: true,
};

const actions = {
  onRetry: vi.fn(),
  onModeChange: vi.fn(),
  onServerUrlChange: vi.fn(),
  onApiKeyChange: vi.fn(),
  onTest: vi.fn(),
  onSaveConnection: vi.fn(),
  onDownloadNowChange: vi.fn(),
  onPageQuickActionEnabledChange: vi.fn(),
  onLanguageChange: vi.fn(),
};

let testI18n: i18n;

beforeAll(async () => {
  testI18n = i18next.createInstance();
  await testI18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
  });
});

function optionsView(): OptionsViewComponent {
  const View = (
    optionsApp as typeof optionsApp & {
      OptionsView?: OptionsViewComponent;
    }
  ).OptionsView;
  expect(View).toBeTypeOf("function");
  if (!View) throw new Error("OptionsView is not available");
  return View;
}

function extensionVersionResolver(): ResolveExtensionVersion {
  const resolver = (
    optionsApp as typeof optionsApp & {
      resolveExtensionVersion?: ResolveExtensionVersion;
    }
  ).resolveExtensionVersion;
  expect(resolver).toBeTypeOf("function");
  if (!resolver) throw new Error("Extension version resolver is not available");
  return resolver;
}

function renderOptions(overrides: Partial<OptionsViewProps> = {}): string {
  const View = optionsView();
  const props: OptionsViewProps = {
    settings,
    draft: {
      mode: "desktop-http",
      serverUrl: "",
      apiKey: "",
    },
    loading: false,
    loadError: null,
    testing: false,
    savingConnection: false,
    savingPreference: false,
    lastStatus: null,
    version: "0.1.0",
    ...actions,
    ...overrides,
  };

  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: testI18n },
      createElement(View, props),
    ),
  );
}

describe("OptionsView workspace", () => {
  it("renders a compact branded header and responsive desktop settings grid", () => {
    const html = renderOptions();

    expect(html).toContain('data-options-header="brand"');
    expect(html).toContain('src="/public/icons/mediago-32.png"');
    expect(html).toContain("MediaGo Extension Settings");
    expect(html).toContain('data-options-grid="workspace"');
    expect(html).toMatch(
      /md:grid-cols-\[minmax\(0,1\.3fr\)_minmax\(280px,0\.7fr\)\]/,
    );
    expect(html).toContain('data-card="connection"');
    expect(html).toContain('data-card="import-behaviour"');
    expect(html).toContain('data-card="page-quick-action"');
    expect(html).toContain('data-card="language"');
    expect(html).toContain('data-card="rules"');
  });

  it("uses the text-safe brand token for compact branded labels", () => {
    const html = renderOptions();

    expect(classForText(html, "MediaGo / Extension")).toContain(
      "text-brand-foreground",
    );
    expect(classForText(html, "MediaGo / Extension")).not.toContain(
      "text-primary",
    );
    expect(classForText(html, "Connection")).toContain("text-brand-foreground");
    expect(classForText(html, "Connection")).not.toContain("text-primary");
  });

  it("renders a busy loading skeleton instead of editable controls", () => {
    const html = renderOptions({ settings: null, loading: true });

    expect(html).toContain('data-options-state="loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading settings");
    expect(html).not.toContain('data-card="connection"');
  });

  it("offers retry when initial settings cannot be loaded", () => {
    const html = renderOptions({
      settings: null,
      loadError: "Unexpected settings response",
    });

    expect(html).toContain('data-options-state="load-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not load settings");
    expect(html).toContain("Unexpected settings response");
    expect(html).toContain('data-action="retry"');
  });

  it.each([
    ["desktop-schema", "Desktop / Schema protocol"],
    ["desktop-http", "Desktop / HTTP local"],
    ["docker-http", "Docker / Self-hosted / HTTP"],
  ] as const)("renders the %s dispatch option", (mode, label) => {
    const html = renderOptions({ draft: { ...settings, mode } });

    expect(html).toContain("<fieldset");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain(`value="${mode}"`);
    expect(html).toContain(label);
  });

  it("shows labelled Docker credentials and connection actions", () => {
    const html = renderOptions({
      draft: {
        mode: "docker-http",
        serverUrl: "https://mediago.example.test",
        apiKey: "secret",
      },
    });

    expect(html).toContain('for="server-url"');
    expect(html).toContain('type="url"');
    expect(html).toContain('for="api-key"');
    expect(html).toContain('type="password"');
    expect(html).toContain('data-action="test-connection"');
    expect(html).toContain('data-action="save-connection"');
  });

  it("announces connection status and disables actions while testing or saving", () => {
    const html = renderOptions({
      testing: true,
      savingConnection: true,
      lastStatus: { ok: false, message: "Connection refused" },
    });

    expect(html).toContain('role="status"');
    expect(html).toContain("Connection refused");
    expect(html).toContain("Testing");
    expect(html).toContain("Saving");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a long connection diagnostic fully readable without truncation", () => {
    const diagnostic =
      "Connection refused after contacting the configured MediaGo host; verify the server address, reverse proxy path, firewall rules, and API key before retrying.";
    const html = renderOptions({
      lastStatus: { ok: false, message: diagnostic },
    });
    const statusClass = classForRole(html, "status");

    expect(html).toContain(diagnostic);
    expect(statusClass).toContain("min-w-0");
    expect(statusClass).toContain("max-w-full");
    expect(statusClass).toContain("whitespace-normal");
    expect(statusClass).toContain("break-words");
    expect(statusClass).not.toContain("truncate");
    expect(statusClass).not.toContain("max-w-[360px]");
  });

  it("disables immediate download semantically in schema mode", () => {
    const html = renderOptions({
      settings: { ...settings, mode: "desktop-schema" },
      draft: { ...settings, mode: "desktop-schema" },
    });

    expect(html).toContain('data-card="import-behaviour"');
    expect(html).toContain('data-download-now-available="false"');
    expect(html).toContain("review dialog");
  });

  it("communicates enabled and schema-disabled switch behavior on its label", () => {
    const enabled = renderOptions();
    const disabled = renderOptions({
      settings: { ...settings, mode: "desktop-schema" },
      draft: { ...settings, mode: "desktop-schema" },
    });

    expect(labelClassFor(enabled, "download-now")).toContain("cursor-pointer");
    expect(labelClassFor(disabled, "download-now")).toContain(
      "cursor-not-allowed",
    );
    expect(labelClassFor(disabled, "download-now")).not.toContain(
      "cursor-pointer",
    );
  });

  it("renders labelled language choices and compact version information", () => {
    const html = renderOptions();

    expect(html).toContain('data-card="language"');
    expect(html).toContain('name="language"');
    expect(html).toContain("Follow system");
    expect(html).toContain('data-card="about"');
    expect(html).toContain("Version 0.1.0");
  });

  it("uses navigable h2 headings for each top-level settings card", () => {
    const html = renderOptions();
    const h1Index = html.indexOf("<h1");
    const cardHeadings = [
      "Dispatch Mode",
      "Sniffing Rules",
      "Page shortcut",
      "Import Behaviour",
      "Interface Language",
      "About",
    ];

    expect(h1Index).toBeGreaterThanOrEqual(0);
    for (const heading of cardHeadings) {
      const headingIndex = html.indexOf(`<h2`, h1Index);
      expect(headingIndex).toBeGreaterThan(h1Index);
      expect(html).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`));
    }
  });
});

function labelClassFor(html: string, targetId: string): string {
  const label = html.match(
    new RegExp(`<label\\b[^>]*\\bfor="${targetId}"[^>]*>`),
  )?.[0];
  if (!label) throw new Error(`Missing label for ${targetId}`);
  return label.match(/\bclass="([^"]*)"/)?.[1] ?? "";
}

function classForText(html: string, text: string): string {
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const className = html.match(
    new RegExp(`<[^>]+class="([^"]*)"[^>]*>${escapedText}</[^>]+>`),
  )?.[1];
  if (!className) throw new Error(`Missing class for ${text}`);
  return className;
}

function classForRole(html: string, role: string): string {
  const tag = html.match(
    new RegExp(`<[^>]+(?=[^>]*role="${role}")[^>]*>`),
  )?.[0];
  const className = tag?.match(/class="([^"]*)"/)?.[1];
  if (!className) throw new Error(`Missing class for role ${role}`);
  return className;
}

describe("Options copy", () => {
  it("contains no visible em dash in any locale", () => {
    for (const locale of Object.values(resources)) {
      expect(JSON.stringify(locale.translation.options)).not.toContain("—");
    }
  });

  it("keeps the Italian desktop note separated from the inline URL", () => {
    expect(resources.it.translation.options.server.desktopHttpNoteTail).toMatch(
      /^\.\s/,
    );
  });
});

describe("extension version display", () => {
  it("prefers the full manifest version name", () => {
    const resolveExtensionVersion = extensionVersionResolver();

    expect(
      resolveExtensionVersion({
        version: "3.5.0",
        version_name: "3.5.0-test.4",
      }),
    ).toBe("3.5.0-test.4");
  });

  it("falls back to the numeric manifest version", () => {
    const resolveExtensionVersion = extensionVersionResolver();

    expect(resolveExtensionVersion({ version: "3.5.0" })).toBe("3.5.0");
  });
});
