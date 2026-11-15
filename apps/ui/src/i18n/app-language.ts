import { resolveAppLanguage, type ResolvedAppLanguage } from "@mediago/common";
import { platformApi } from "../hooks/adapters";
import i18n from ".";

interface AppLanguageSynchronizerDependencies {
  getPreferredSystemLanguage: () => Promise<string | undefined>;
  changeLanguage: (language: ResolvedAppLanguage) => Promise<unknown> | unknown;
  setDocumentLanguage: (language: ResolvedAppLanguage) => void;
}

function unwrapIpcData(result: unknown): unknown {
  if (result && typeof result === "object" && "code" in result) {
    return (result as Record<string, unknown>).data;
  }
  return result;
}

function getBrowserLanguage(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.languages?.[0] ?? navigator.language;
}

async function getPreferredSystemLanguage(): Promise<string | undefined> {
  const browserLanguage = getBrowserLanguage();

  try {
    const result = await platformApi.app.getPreferredSystemLanguage();
    const language = unwrapIpcData(result);
    return typeof language === "string" && language.length > 0
      ? language
      : browserLanguage;
  } catch {
    return browserLanguage;
  }
}

function waitForI18nInitialization(): Promise<void> {
  if (i18n.isInitialized) return Promise.resolve();

  return new Promise((resolve) => {
    const handleInitialized = () => {
      i18n.off("initialized", handleInitialized);
      resolve();
    };
    i18n.on("initialized", handleInitialized);
  });
}

export function createAppLanguageSynchronizer({
  getPreferredSystemLanguage: readPreferredSystemLanguage,
  changeLanguage,
  setDocumentLanguage,
}: AppLanguageSynchronizerDependencies) {
  let requestVersion = 0;

  return async (preference: string | undefined): Promise<void> => {
    const version = ++requestVersion;
    const usesSystemLanguage =
      preference !== "zh" &&
      preference !== "en" &&
      preference !== "it" &&
      preference !== "zh-TW";
    const systemLanguage = usesSystemLanguage
      ? await readPreferredSystemLanguage()
      : undefined;

    // A slower system-language IPC response must not overwrite a newer manual
    // language selection.
    if (version !== requestVersion) return;

    const language = resolveAppLanguage(preference, systemLanguage);
    setDocumentLanguage(language);
    await changeLanguage(language);
  };
}

export const syncAppLanguage = createAppLanguageSynchronizer({
  getPreferredSystemLanguage,
  changeLanguage: async (language) => {
    await waitForI18nInitialization();
    if (i18n.resolvedLanguage === language && i18n.language === language) {
      return;
    }
    await i18n.changeLanguage(language);
  },
  setDocumentLanguage: (language) => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language;
    document.documentElement.dataset.bootLanguage = language;
  },
});
