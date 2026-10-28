import { Controller, useWatch, type UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { DownloadFormItem } from "@/store/download-dialog";
import { isWeb } from "@/environment";
import { DownloadType } from "@mediago/common";

export function DownloadTargetField({
  form,
  enabled,
  locked,
  formId,
}: {
  form: UseFormReturn<DownloadFormItem>;
  enabled: boolean;
  locked: boolean;
  formId: string;
}) {
  const { t } = useTranslation();
  const target =
    useWatch({ control: form.control, name: "downloadTarget" }) ?? "local";
  if (isWeb) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <span id={`${formId}-target-label`} className="text-sm font-medium">
        {t("downloadTarget")}
      </span>
      <div className="space-y-2">
        <Controller
          name="downloadTarget"
          control={form.control}
          render={({ field }) => (
            <RadioGroup
              aria-labelledby={`${formId}-target-label`}
              value={field.value ?? "local"}
              onValueChange={field.onChange}
              disabled={locked}
              className="flex gap-5"
            >
              <label
                className={
                  locked
                    ? "flex cursor-not-allowed items-center gap-2 text-sm"
                    : "flex cursor-pointer items-center gap-2 text-sm"
                }
              >
                <RadioGroupItem value="local" />
                {t("downloadOnThisDevice")}
              </label>
              <label
                className={
                  locked || !enabled
                    ? "flex cursor-not-allowed items-center gap-2 text-sm"
                    : "flex cursor-pointer items-center gap-2 text-sm"
                }
              >
                <RadioGroupItem value="docker" disabled={!enabled && !locked} />
                Docker
              </label>
            </RadioGroup>
          )}
        />
        {target === "docker" && (
          <p className="text-xs text-muted-foreground">
            {t("dockerDownloadNetworkHelp")}
          </p>
        )}
        {!enabled && (
          <p className="text-xs text-muted-foreground">
            {t("dockerDownloadSetupHelp")}
          </p>
        )}
      </div>
    </div>
  );
}

export function DownloadProxyFields({
  form,
  formId,
}: {
  form: UseFormReturn<DownloadFormItem>;
  formId: string;
}) {
  const { t } = useTranslation();
  const target = useWatch({ control: form.control, name: "downloadTarget" });
  const type = useWatch({ control: form.control, name: "type" });
  const mode =
    useWatch({ control: form.control, name: "proxyMode" }) ?? "inherit";
  const remote = isWeb || target === "docker";
  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <label htmlFor={`${formId}-proxy-mode`} className="text-sm font-medium">
        {t("taskProxyStrategy")}
      </label>
      <div className="space-y-2">
        {remote ? (
          <div
            id={`${formId}-proxy-mode`}
            className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
          >
            {t("dockerProxyInherited")}
          </div>
        ) : (
          <>
            <Controller
              name="proxyMode"
              control={form.control}
              render={({ field }) => (
                <Select
                  value={field.value ?? "inherit"}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger id={`${formId}-proxy-mode`} className="w-full">
                    <SelectValue>
                      {mode === "custom"
                        ? t("taskProxyCustom")
                        : mode === "direct"
                          ? t("taskProxyDirect")
                          : t("taskProxyInherit")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      {t("taskProxyInherit")}
                    </SelectItem>
                    <SelectItem
                      value="direct"
                      disabled={type === DownloadType.bilibili}
                    >
                      {t("taskProxyDirect")}
                    </SelectItem>
                    <SelectItem value="custom">
                      {t("taskProxyCustom")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {mode === "custom" && (
              <Input
                aria-label={t("taskProxyAddress")}
                placeholder="http://127.0.0.1:7890"
                {...form.register("proxyUrl", {
                  validate: (value) => {
                    if (
                      isWeb ||
                      form.getValues("downloadTarget") === "docker" ||
                      form.getValues("proxyMode") !== "custom"
                    )
                      return true;
                    try {
                      const url = new URL(value?.trim() ?? "");
                      return (
                        (["http:", "socks5:"].includes(url.protocol) &&
                          !!url.hostname &&
                          !url.username &&
                          !url.password &&
                          !url.search &&
                          !url.hash &&
                          (!url.pathname || url.pathname === "/")) ||
                        t("taskProxyAddressInvalid")
                      );
                    } catch {
                      return t("taskProxyAddressInvalid");
                    }
                  },
                })}
              />
            )}
            {form.formState.errors.proxyUrl && (
              <p role="alert" className="text-xs text-destructive">
                {form.formState.errors.proxyUrl.message}
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {mode === "custom"
                ? t("taskProxyCustomHelp")
                : mode === "direct"
                  ? t("taskProxyDirectHelp")
                  : t("taskProxyInheritHelp")}
            </p>
            {type === DownloadType.bilibili && (
              <p className="text-xs text-muted-foreground">
                {t("taskProxyBilibiliHelp")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
