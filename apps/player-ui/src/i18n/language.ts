export type PlayerLanguage = "en" | "zh-CN" | "it" | "zh-TW";

export function resolvePlayerLanguage(
  languages: readonly string[] = navigator.languages,
): PlayerLanguage {
  for (const language of languages) {
    const normalizedLanguage = language.toLowerCase();

    if (normalizedLanguage.startsWith("zh")) {
      if (
        normalizedLanguage.includes("hant") ||
        normalizedLanguage.startsWith("zh-tw") ||
        normalizedLanguage.startsWith("zh-hk") ||
        normalizedLanguage.startsWith("zh-mo")
      ) {
        return "zh-TW";
      }
      return "zh-CN";
    }

    if (normalizedLanguage.startsWith("it")) {
      return "it";
    }

    if (normalizedLanguage.startsWith("en")) {
      return "en";
    }
  }

  return "en";
}
