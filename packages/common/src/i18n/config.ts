export const DEFAULT_FALLBACK_LNG = "zh";
export const BASE_I18N_OPTIONS = {
  fallbackLng: DEFAULT_FALLBACK_LNG,
  interpolation: {
    escapeValue: false,
  },
} as const;

export type ResolvedAppLanguage = "zh" | "en" | "it" | "zh-TW";

/**
 * Resolve a stored AppStore.language value to a real i18n key.
 *
 * The persisted language may be `"system"` (meta value meaning "follow OS locale").
 * Each process resolves it at apply-time using the same OS-preferred locale.
 * Electron provides that value through `app.getPreferredSystemLanguages()`;
 * browser-only builds use `navigator.languages` as their fallback.
 *
 * Pure function — callers are responsible for reading the raw locale.
 */
export function resolveAppLanguage(
  language: string | undefined,
  systemLocale: string | undefined,
): ResolvedAppLanguage {
  if (
    language === "zh" ||
    language === "en" ||
    language === "it" ||
    language === "zh-TW"
  ) {
    return language;
  }

  const normalizedSystemLocale = (systemLocale ?? "").toLowerCase();
  if (normalizedSystemLocale.startsWith("zh")) {
    if (
      normalizedSystemLocale.includes("hant") ||
      normalizedSystemLocale.startsWith("zh-tw") ||
      normalizedSystemLocale.startsWith("zh-hk") ||
      normalizedSystemLocale.startsWith("zh-mo")
    ) {
      return "zh-TW";
    }
    return "zh";
  }
  if (normalizedSystemLocale.startsWith("it")) {
    return "it";
  }
  return "en";
}
