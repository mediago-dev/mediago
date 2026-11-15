import type { ExtensionLanguage } from "../shared/types";

export type SupportedLanguage = Exclude<ExtensionLanguage, "system">;

/** Resolve a stored preference without loading i18next or translation resources. */
export function resolveLanguage(
  setting: ExtensionLanguage | undefined,
): SupportedLanguage {
  if (
    setting === "zh" ||
    setting === "en" ||
    setting === "it" ||
    setting === "zh-TW"
  ) {
    return setting;
  }
  const uiLanguage =
    (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage?.()) ||
    (typeof navigator !== "undefined" ? navigator.language : "") ||
    "";
  const normalized = uiLanguage.toLowerCase();
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
