import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { renderLocalized } from "@/i18n/localized-message";
import { DESKTOP_HTTP_BASE } from "@/shared/constants";
import type { InvocationMode } from "@/shared/types";

import { useOptions } from "../use-options";

export function ServerCard() {
  const { t } = useTranslation();
  const {
    mode,
    setMode,
    serverUrl,
    apiKey,
    setServerUrl,
    setApiKey,
    loaded,
    testing,
    saving,
    lastStatus,
    test,
    save,
  } = useOptions();

  const modeOptions: Array<{
    value: InvocationMode;
    title: string;
    description: string;
  }> = [
    {
      value: "desktop-schema",
      title: t("options.server.modeSchemaTitle"),
      description: t("options.server.modeSchemaDesc"),
    },
    {
      value: "desktop-http",
      title: t("options.server.modeDesktopHttpTitle"),
      description: t("options.server.modeDesktopHttpDesc", {
        base: DESKTOP_HTTP_BASE,
      }),
    },
    {
      value: "docker-http",
      title: t("options.server.modeDockerHttpTitle"),
      description: t("options.server.modeDockerHttpDesc"),
    },
  ];

  const handleSave = async () => {
    const res = await save();
    if (res.ok) toast.success(t("common.saved"));
    else toast.error(renderLocalized(t, res.error, "common.saveFailed"));
  };

  return (
    // ServerCard is the page's primary action target — the place the
    // user goes to change how the extension talks to MediaGo. `interactive`
    // makes it lift from ambient → elevated on hover, signalling it's
    // actionable. The info cards below (rules / language) stay static.
    <Card interactive>
      <CardHeader>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-block h-1 w-1 rounded-full bg-timeline-read" />
          dispatch
        </div>
        <CardTitle>{t("options.server.title")}</CardTitle>
        <CardDescription>{t("options.server.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <RadioGroup<InvocationMode>
          value={mode}
          onValueChange={setMode}
          name="mode"
        >
          {modeOptions.map((o) => (
            <RadioGroupItem
              key={o.value}
              value={o.value}
              title={o.title}
              description={o.description}
              disabled={!loaded}
            />
          ))}
        </RadioGroup>

        {mode === "docker-http" && (
          <div className="space-y-4 rounded-lg border border-border bg-surface-200 p-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="server-url"
                className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
              >
                {t("options.server.serverUrlLabel")}
              </Label>
              <Input
                id="server-url"
                type="url"
                placeholder={t("options.server.serverUrlPlaceholder")}
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                disabled={!loaded}
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="api-key"
                className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
              >
                {t("options.server.apiKeyLabel")}{" "}
                <span className="text-foreground/40">
                  {t("options.server.apiKeyOptional")}
                </span>
              </Label>
              <Input
                id="api-key"
                type="password"
                placeholder={t("options.server.apiKeyPlaceholder")}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!loaded}
                autoComplete="off"
              />
            </div>
          </div>
        )}

        {mode === "desktop-schema" && (
          <p className="rounded-lg border border-border bg-surface-200 p-4 font-serif text-[13px] leading-relaxed text-muted-foreground">
            {t("options.server.schemaNoteLead")}{" "}
            <code className="rounded-xs bg-surface-400 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              mediago-community://share?v=1&amp;url=...
            </code>{" "}
            {t("options.server.schemaNoteMid")}{" "}
            <strong className="font-medium text-foreground">
              {t("options.server.schemaAllow")}
            </strong>
            {" · "}
            <strong className="font-medium text-foreground">
              {t("options.server.schemaAlways")}
            </strong>{" "}
            {t("options.server.schemaAfter")}
            <span className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-destructive">
                {t("options.server.limitationLabel")}
              </span>
              <span className="text-foreground/70">
                {t("options.server.limitationBody")}
              </span>
            </span>
          </p>
        )}

        {mode === "desktop-http" && (
          <p className="rounded-lg border border-border bg-surface-200 p-4 font-serif text-[13px] leading-relaxed text-muted-foreground">
            {t("options.server.desktopHttpNoteLead")}{" "}
            <code className="rounded-xs bg-surface-400 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {DESKTOP_HTTP_BASE}
            </code>
            {t("options.server.desktopHttpNoteTail")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void test()}
            disabled={testing || !loaded}
          >
            {testing && <Loader2 className="size-3.5 animate-spin" />}
            {t("common.testConnection")}
          </Button>
          <Button
            variant="dark"
            onClick={handleSave}
            disabled={saving || !loaded}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t("common.save")}
          </Button>
          {lastStatus && (
            <StatusInline
              ok={lastStatus.ok}
              text={renderLocalized(t, lastStatus.message)}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusInline({ ok, text }: { ok: boolean; text: string }) {
  if (ok) {
    return (
      <Badge
        role="status"
        aria-live="polite"
        variant="success"
        className="max-w-[360px] gap-1 normal-case tracking-normal"
      >
        <CheckCircle2 className="size-3 shrink-0" />
        <span className="truncate">{text}</span>
      </Badge>
    );
  }
  return (
    <Badge
      role="status"
      aria-live="polite"
      variant="destructive"
      className="max-w-[360px] gap-1 normal-case tracking-normal"
    >
      <XCircle className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
    </Badge>
  );
}
