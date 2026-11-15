import type { i18n } from "i18next";

import { DEFAULT_SETTINGS, STORAGE_KEY_SETTINGS } from "../shared/constants";
import type { ExtensionLanguage, ExtensionSettings } from "../shared/types";

import { createExtensionI18n, resolveLanguage } from "./index";

export interface DocumentLanguageTarget {
  lang: string;
}

export interface LanguageChangeSource {
  language: string;
  resolvedLanguage?: string;
  on(event: "languageChanged", listener: (language: string) => void): unknown;
  off(event: "languageChanged", listener: (language: string) => void): unknown;
}

function concreteDocumentLanguage(
  language: string,
): "zh" | "en" | "it" | "zh-TW" {
  const normalized = language.toLowerCase();
  if (normalized.startsWith("zh")) {
    if (
      normalized.includes("hant") ||
      normalized.startsWith("zh-tw") ||
      normalized.startsWith("zh-hk") ||
      normalized.startsWith("zh-mo")
    ) {
      return "zh-TW";
    }
    return "zh";
  }
  if (normalized.startsWith("it")) return "it";
  return "en";
}

export function bindDocumentLanguage(
  instance: LanguageChangeSource,
  target: DocumentLanguageTarget,
): () => void {
  const update = (language: string) => {
    target.lang = concreteDocumentLanguage(language);
  };
  update(instance.resolvedLanguage ?? instance.language);
  instance.on("languageChanged", update);
  return () => {
    instance.off("languageChanged", update);
  };
}

let releaseDocumentLanguage: (() => void) | null = null;

/**
 * Bootstrap an i18next instance for a popup / options page:
 *
 * 1. Read the persisted language from `chrome.storage.local`.
 * 2. Resolve `system` → concrete locale using the browser UI language.
 * 3. Build and return the i18n instance.
 * 4. Subscribe to storage changes so the page re-renders when the user
 *    picks a different language from the LanguageCard — no reload.
 *
 * Both entry points (popup / options) run this identically; sharing here
 * keeps the behaviour aligned.
 */
export async function bootstrapExtensionI18n(): Promise<i18n> {
  const raw = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
  const stored = (raw[STORAGE_KEY_SETTINGS] ??
    {}) as Partial<ExtensionSettings>;
  const setting: ExtensionLanguage =
    stored.language ?? DEFAULT_SETTINGS.language;
  const instance = createExtensionI18n(resolveLanguage(setting));

  if (typeof document !== "undefined") {
    releaseDocumentLanguage?.();
    releaseDocumentLanguage = bindDocumentLanguage(
      instance,
      document.documentElement,
    );
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const change = changes[STORAGE_KEY_SETTINGS];
    if (!change) return;
    const nextSettings = (change.newValue ?? {}) as Partial<ExtensionSettings>;
    const next = nextSettings.language ?? DEFAULT_SETTINGS.language;
    const resolved = resolveLanguage(next);
    if (instance.language !== resolved) {
      void instance.changeLanguage(resolved);
    }
  });

  return instance;
}
