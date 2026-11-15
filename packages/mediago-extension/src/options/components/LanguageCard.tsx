import { Languages, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import type { ExtensionLanguage } from "../../shared/types";

export interface LanguageCardProps {
  language: ExtensionLanguage;
  saving: boolean;
  onLanguageChange: (language: ExtensionLanguage) => void;
}

export function LanguageCard({
  language,
  saving,
  onLanguageChange,
}: LanguageCardProps) {
  const { t } = useTranslation();
  const options: Array<{ value: ExtensionLanguage; title: string }> = [
    { value: "system", title: t("options.language.system") },
    { value: "zh", title: t("options.language.zh") },
    { value: "en", title: t("options.language.en") },
    { value: "it", title: t("options.language.it") },
    { value: "zh-TW", title: t("options.language.zhTW") },
  ];

  return (
    <Card data-card="language" aria-busy={saving || undefined}>
      <CardHeader className="pb-4">
        <div className="flex items-start gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-selected text-primary">
            <Languages className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>{t("options.language.title")}</CardTitle>
            <CardDescription className="mt-1">
              {t("options.language.description")}
            </CardDescription>
          </div>
          {saving ? (
            <Loader2
              className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-label={t("common.saving")}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <fieldset className="min-w-0">
          <legend className="sr-only">{t("options.language.title")}</legend>
          <RadioGroup<ExtensionLanguage>
            value={language}
            onValueChange={onLanguageChange}
            name="language"
            aria-label={t("options.language.title")}
            className="grid grid-cols-2 gap-2"
          >
            {options.map((option) => (
              <RadioGroupItem
                key={option.value}
                value={option.value}
                title={option.title}
                variant="compact"
              />
            ))}
          </RadioGroup>
        </fieldset>
      </CardContent>
    </Card>
  );
}
