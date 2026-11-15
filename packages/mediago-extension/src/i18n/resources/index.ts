import en from "./en";
import it from "./it";
import zh, { type ExtensionResources } from "./zh";
import zhTW from "./zh-TW";
import type { SupportedLanguage } from "../language";

export { type ExtensionResources } from "./zh";

export const resources = {
  en: { translation: en },
  it: { translation: it },
  zh: { translation: zh },
  "zh-TW": { translation: zhTW },
} as const satisfies Record<
  SupportedLanguage,
  { translation: ExtensionResources }
>;

export type { SupportedLanguage } from "../language";
