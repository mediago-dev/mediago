import {
  CodeXml,
  Copy,
  Download,
  Eraser,
  FolderOpen,
  Puzzle,
  RefreshCw,
  Server,
  Star,
  Terminal,
  Upload,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useController, useFormContext } from "react-hook-form";
import { toast } from "sonner";
import useSWR from "swr";
import {
  exportFavorites as exportFavoritesApi,
  importFavorites,
} from "@/api/favorite";
import { getMCPStatus, getMCPStatusKey } from "@/api/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEnvPath } from "@/hooks/use-config";
import { usePlatform } from "@/hooks/use-platform";
import { useAppStore } from "@/store/app";
import { useSessionStore } from "@/store/session";
import { isAppTheme, useWebAppearanceStore } from "@/store/web-appearance";
import { getAdapterCoreUrl } from "@/services/adapter-bootstrap";
import { buildMCPAgentConfig, buildMCPEndpoint } from "@/services/mcp-config";
import { isWeb } from "@/utils";
import {
  SettingBooleanRadioField,
  SettingCard,
  SettingNumberField,
  SettingRow,
  SettingSelectField,
  SettingSelectRow,
  SettingSwitchField,
  SettingTextField,
  usePersistSetting,
} from "./setting-fields";
import {
  AppLanguage,
  type AppStore,
  AppTheme,
  type CLIInstallStatus,
} from "@mediago/common";

const version = import.meta.env.APP_VERSION;
const EXTENSION_GUIDE_URL = "https://downloader.caorushizi.cn/extension.html";
const GITHUB_REPOSITORY_URL = "https://github.com/mediago-dev/mediago";
const GITHUB_REPOSITORY_NAME = "mediago-dev/mediago";

const actionButtonClass = "h-8 shrink-0";

export const BasicSettingsCard = memo(function BasicSettingsCard() {
  const { t } = useTranslation();
  const { dialog } = usePlatform();
  const persistSetting = usePersistSetting();
  const webTheme = useWebAppearanceStore((state) => state.theme);
  const setWebTheme = useWebAppearanceStore((state) => state.setTheme);
  const { control, setValue } = useFormContext<AppStore>();
  const { field: localField } = useController({ name: "local", control });

  const selectDirectory = async () => {
    const paths = await dialog.open({ type: "directory" });
    const local = paths?.[0];
    if (!local) return;
    setValue("local", local, { shouldDirty: true });
    await persistSetting("local", local);
  };

  const themeOptions = [
    { label: t("followSystem"), value: AppTheme.System },
    { label: t("dark"), value: AppTheme.Dark },
    { label: t("light"), value: AppTheme.Light },
  ];

  return (
    <SettingCard title={t("basicSetting")}>
      <SettingRow
        label={
          isWeb ? (
            t("localDir")
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={selectDirectory}
              className={actionButtonClass}
            >
              <FolderOpen className="size-4" />
              {t("selectFolder")}
            </Button>
          )
        }
        htmlFor={isWeb ? "setting-local" : undefined}
      >
        <Input
          id="setting-local"
          value={String(localField.value ?? "")}
          readOnly
          aria-readonly="true"
          aria-label={!isWeb ? t("localDir") : undefined}
          placeholder={t("pleaseSelectDownloadDir")}
          className="h-8"
        />
      </SettingRow>

      {isWeb ? (
        <SettingSelectRow
          id="setting-theme"
          label={t("downloaderTheme")}
          placeholder={t("pleaseSelectTheme")}
          options={themeOptions}
          value={webTheme}
          onValueChange={(value) => {
            if (isAppTheme(value)) setWebTheme(value);
          }}
        />
      ) : (
        <SettingSelectField
          name="theme"
          label={t("downloaderTheme")}
          placeholder={t("pleaseSelectTheme")}
          options={themeOptions}
        />
      )}

      <SettingSelectField
        name="language"
        label={t("displayLanguage")}
        placeholder={t("pleaseSelectLanguage")}
        options={[
          { label: t("followSystem"), value: AppLanguage.System },
          { label: t("chinese"), value: AppLanguage.ZH },
          { label: t("english"), value: AppLanguage.EN },
          { label: t("italian"), value: AppLanguage.IT },
        ]}
      />

      {!isWeb ? (
        <>
          <SettingSwitchField name="promptTone" label={t("downloadPrompt")} />
        </>
      ) : null}
      <SettingSwitchField name="showTerminal" label={t("showTerminal")} />
      {!isWeb ? (
        <>
          <SettingSwitchField
            name="autoUpgrade"
            label={t("autoUpgrade")}
            tooltip={t("autoUpgradeTooltip")}
          />
          <SettingSwitchField name="allowBeta" label={t("allowBetaVersion")} />
          <SettingBooleanRadioField
            name="closeMainWindow"
            label={t("closeMainWindow")}
            options={[
              { label: t("close"), value: true },
              { label: t("minimizeToTray"), value: false },
            ]}
          />
          <SettingSwitchField
            name="enableMobilePlayer"
            label={t("enableMobilePlayer")}
          />
        </>
      ) : null}
    </SettingCard>
  );
});

export const BrowserSettingsCard = memo(function BrowserSettingsCard() {
  const { t } = useTranslation();
  const { browser, contextMenu, dialog } = usePlatform();

  const showTextMenu = () =>
    contextMenu.show([
      { key: "copy", label: t("copy"), role: "copy" },
      { key: "paste", label: t("paste"), role: "paste" },
    ]);

  const clearCache = async () => {
    try {
      await browser.clearCache();
      toast.success(t("clearCacheSuccess"));
    } catch {
      toast.error(t("clearCacheFailed"));
    }
  };

  const exportFavorites = async () => {
    try {
      const content = await exportFavoritesApi();
      await dialog.save({
        content:
          typeof content === "string"
            ? content
            : JSON.stringify(content, null, 2),
        defaultPath: "favorites.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      toast.success(t("exportFavoriteSuccess"));
    } catch {
      toast.error(t("exportFavoriteFailed"));
    }
  };

  const importFavoriteFile = async () => {
    try {
      const contents = await dialog.open({
        type: "file",
        filters: [{ name: "JSON", extensions: ["json"] }],
        readContent: true,
      });
      if (!contents?.length) return;
      const favorites = JSON.parse(contents[0]);
      if (Array.isArray(favorites)) await importFavorites(favorites);
      toast.success(t("importFavoriteSuccess"));
    } catch {
      toast.error(t("importFavoriteFailed"));
    }
  };

  return (
    <SettingCard title={t("browserSetting")}>
      <SettingSwitchField name="audioMuted" label={t("audioMuted")} />
      <SettingSwitchField name="openInNewWindow" label={t("openInNewWindow")} />
      <SettingTextField
        name="proxy"
        label={t("proxySetting")}
        placeholder={t("pleaseEnterProxy")}
        onContextMenu={showTextMenu}
      />
      <SettingSwitchField
        name="useProxy"
        label={t("proxySwitch")}
        validate={(checked, getValues) => {
          const proxy = getValues("proxy");
          if (checked && proxy === "") return t("pleaseEnterProxyFirst");
          return undefined;
        }}
      />
      <SettingSwitchField name="blockAds" label={t("blockAds")} />
      <SettingSwitchField name="isMobile" label={t("defaultMobileMode")} />
      <SettingSwitchField
        name="useExtension"
        label={t("useImmersiveSniffing")}
        tooltip={t("immersiveSniffingDescription")}
      />
      <SettingSwitchField
        name="privacy"
        label={t("privacy")}
        tooltip={t("privacyTooltip")}
      />
      <div className="grid grid-cols-1 gap-2 py-4 @sm/settings:grid-cols-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={clearCache}
        >
          <Eraser className="size-4" />
          {t("clearCache")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={exportFavorites}
        >
          <Download className="size-4" />
          {t("exportFavorite")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={importFavoriteFile}
        >
          <Upload className="size-4" />
          {t("importFavorite")}
        </Button>
      </div>
    </SettingCard>
  );
});

export const DownloadSettingsCard = memo(function DownloadSettingsCard() {
  const { t } = useTranslation();
  const { contextMenu } = usePlatform();

  return (
    <SettingCard title={t("downloadSetting")}>
      {isWeb ? (
        <SettingTextField
          name="proxy"
          label={t("proxySetting")}
          placeholder={t("pleaseEnterProxy")}
          onContextMenu={() =>
            contextMenu.show([
              { key: "copy", label: t("copy"), role: "copy" },
              { key: "paste", label: t("paste"), role: "paste" },
            ])
          }
        />
      ) : null}
      <SettingSwitchField
        name="downloadProxySwitch"
        label={t("downloadProxySwitch")}
        validate={(checked, getValues) => {
          const proxy = getValues("proxy");
          if (checked && proxy === "") return t("pleaseEnterProxyFirst");
          return undefined;
        }}
      />
      <SettingSwitchField name="deleteSegments" label={t("deleteSegments")} />
      <SettingNumberField
        name="maxRunner"
        label={t("maxRunner")}
        tooltip={t("maxRunnerDescription")}
        min={1}
        max={50}
      />
    </SettingCard>
  );
});

export const DockerSettingsCard = memo(function DockerSettingsCard() {
  const { t } = useTranslation();
  const { contextMenu } = usePlatform();
  const showTextMenu = () =>
    contextMenu.show([
      { key: "copy", label: t("copy"), role: "copy" },
      { key: "paste", label: t("paste"), role: "paste" },
    ]);

  return (
    <SettingCard title={t("dockerSetting")}>
      <SettingTextField
        name="apiKey"
        label={t("apiKey")}
        placeholder={t("pleaseEnterApiKey")}
        onContextMenu={showTextMenu}
      />
      <SettingTextField
        name="dockerUrl"
        label={t("dockerUrl")}
        placeholder={t("pleaseEnterDockerUrl")}
        onContextMenu={showTextMenu}
      />
      <SettingSwitchField name="enableDocker" label={t("enableDocker")} />
    </SettingCard>
  );
});

export const SkillsSettingsCard = memo(function SkillsSettingsCard() {
  const { t } = useTranslation();
  const { envPath } = useEnvPath();
  const apiKey = useAppStore((state) => state.apiKey);
  const coreUrl = envPath?.playerUrl
    ? envPath.playerUrl.replace(/\/player\/$/, "")
    : "";
  const installCommand = t("skillsInstallCmd");
  const fallbackCoreUrl = isWeb
    ? coreUrl || "http://localhost:8899"
    : coreUrl || "http://localhost:39719";
  const setupCommand = isWeb
    ? apiKey
      ? t("skillsSetupWithApiKey", { url: fallbackCoreUrl, apiKey })
      : t("skillsSetupWithoutApiKey", { url: fallbackCoreUrl })
    : t("skillsSetupWithoutApiKey", { url: fallbackCoreUrl });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("skillsCopied"));
    } catch {
      toast.error(t("clipboardCopyFailed"));
    }
  };

  return (
    <SettingCard title={t("skillsSetting")}>
      <SettingRow
        label={t("skillsInstall")}
        tooltip={t("skillsInstallTooltip")}
        htmlFor="skills-install-command"
      >
        <div className="relative w-full min-w-0">
          <Input
            id="skills-install-command"
            value={installCommand}
            readOnly
            className="h-8 pr-10 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("skillsCopy")}
            onClick={() => copy(installCommand)}
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
          >
            <Copy className="size-4" />
            <span className="sr-only">{t("skillsCopy")}</span>
          </Button>
        </div>
      </SettingRow>
      <SettingRow
        label={t("skillsInit")}
        tooltip={t("skillsInitTooltip")}
        htmlFor="skills-setup-command"
      >
        <div className="relative w-full min-w-0">
          <Input
            id="skills-setup-command"
            value={setupCommand}
            readOnly
            className="h-8 pr-10 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("skillsCopy")}
            onClick={() => copy(setupCommand)}
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
          >
            <Copy className="size-4" />
            <span className="sr-only">{t("skillsCopy")}</span>
          </Button>
        </div>
      </SettingRow>
    </SettingCard>
  );
});

export const CLISettingsCard = memo(function CLISettingsCard() {
  const { t } = useTranslation();
  const { cli, shell } = usePlatform();
  const { envPath } = useEnvPath();
  const apiKey = useAppStore((state) => state.apiKey);
  const [status, setStatus] = useState<CLIInstallStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const coreUrl = envPath?.playerUrl
    ? envPath.playerUrl.replace(/\/player\/$/, "")
    : "http://127.0.0.1:39719";

  useEffect(() => {
    void cli
      .getStatus()
      .then(setStatus)
      .catch(() => toast.error(t("cliStatusFailed")));
  }, [cli, t]);

  const install = async () => {
    setInstalling(true);
    try {
      const nextStatus = await cli.install({ baseUrl: coreUrl, apiKey });
      setStatus(nextStatus);
      toast.success(t("cliInstallSuccess"));
    } catch {
      toast.error(t("cliInstallFailed"));
    } finally {
      setInstalling(false);
    }
  };

  const openInstallDir = () => {
    if (!status?.binaryPath) return;
    const directory = status.binaryPath.replace(/[\\/][^\\/]+$/, "");
    void shell.open(directory);
  };

  const buttonLabel = status?.updateAvailable
    ? t("cliUpdate")
    : status?.installed
      ? t("cliReinstall")
      : t("cliInstall");

  return (
    <SettingCard title={t("cliSetting")}>
      <SettingRow label={t("cliStatus")}>
        <span className="text-sm text-muted-foreground">
          {status?.installed ? t("cliInstalled") : t("cliNotInstalled")}
          {status?.inPath ? ` · ${t("cliPathReady")}` : ""}
        </span>
      </SettingRow>
      <SettingRow label={t("cliInstallPath")}>
        <Input
          value={status?.binaryPath ?? "~/.mediago-community/bin/mediago"}
          readOnly
          className="h-8 font-mono text-xs"
        />
      </SettingRow>
      <SettingRow label={t("cliUsage")} htmlFor="cli-usage-command">
        <div className="relative w-full min-w-0">
          <Input
            id="cli-usage-command"
            value="mediago download <url>"
            readOnly
            className="h-8 pr-10 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("copy")}
            onClick={() => {
              void navigator.clipboard
                .writeText("mediago download <url>")
                .then(() => toast.success(t("cliCommandCopied")))
                .catch(() => toast.error(t("clipboardCopyFailed")));
            }}
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
          >
            <Copy className="size-4" />
          </Button>
        </div>
      </SettingRow>
      <SettingRow label={t("moreAction")}>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={install}
            disabled={installing}
          >
            <Terminal className="size-4" />
            {buttonLabel}
          </Button>
          {status?.installed ? (
            <Button type="button" variant="outline" onClick={openInstallDir}>
              <FolderOpen className="size-4" />
              {t("openFolder")}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("cliRestartTerminalHint")}
        </p>
      </SettingRow>
    </SettingCard>
  );
});

export const MCPSettingsCard = memo(function MCPSettingsCard() {
  const { t } = useTranslation();
  const persistSetting = usePersistSetting();
  const enabled = useAppStore((state) => state.enableMcp);
  const token = useAppStore((state) => state.mcpToken);
  const { data: status, mutate } = useSWR(getMCPStatusKey, getMCPStatus, {
    dedupingInterval: 250,
    refreshInterval: 1500,
  });
  const isStatusPending = status === undefined || status.enabled !== enabled;
  const coreUrl = getAdapterCoreUrl();
  const target = isWeb ? "web" : "desktop";
  const endpoint = buildMCPEndpoint(coreUrl, target);
  const agentConfig = buildMCPAgentConfig(
    coreUrl,
    token,
    (values) => t("mcpAgentConfigPrompt", values),
    target,
  );
  const canCopyAgentConfig = Boolean(
    endpoint && token && status?.running && !isStatusPending,
  );

  useEffect(() => {
    void mutate();

    const timer = window.setTimeout(() => {
      void mutate();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [enabled, mutate, token]);

  const copyConfig = async () => {
    if (!agentConfig || !canCopyAgentConfig) return;
    try {
      await navigator.clipboard.writeText(agentConfig);
      toast.success(t("mcpConfigCopied"));
    } catch {
      toast.error(t("clipboardCopyFailed"));
    }
  };

  const regenerateToken = async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const nextToken = Array.from(bytes, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    await persistSetting("mcpToken", nextToken);
    toast.success(t("mcpTokenRegenerated"));
  };

  return (
    <SettingCard title={t("mcpSetting")}>
      <SettingSwitchField
        name="enableMcp"
        label={t("mcpEnable")}
        tooltip={t("mcpEnableTooltip")}
      />
      <SettingRow label={t("mcpStatus")}>
        <div className="flex items-center justify-end gap-2 text-sm">
          <Server className="size-4" />
          <span
            className={
              isStatusPending
                ? "text-amber-600"
                : status?.running
                  ? "text-emerald-600"
                  : "text-muted-foreground"
            }
          >
            {isStatusPending
              ? t("mcpApplying")
              : status?.running
                ? t("mcpRunning")
                : t("mcpStopped")}
          </span>
          {status?.error ? (
            <span className="text-destructive">{status.error}</span>
          ) : null}
        </div>
      </SettingRow>
      <SettingRow label={t("mcpUrl")} htmlFor="mcp-url">
        <Input
          id="mcp-url"
          value={endpoint}
          readOnly
          aria-readonly="true"
          className="h-8 font-mono text-xs"
        />
      </SettingRow>
      <SettingRow label={t("mcpToken")} htmlFor="mcp-token">
        <Input
          id="mcp-token"
          value={token}
          readOnly
          aria-readonly="true"
          className="h-8 font-mono text-xs"
        />
      </SettingRow>
      <SettingRow label={t("mcpAgentConfig")}>
        <div className="w-full space-y-2">
          <div
            data-mcp-actions="true"
            className="flex w-full flex-nowrap justify-end gap-2"
          >
            <Button type="button" variant="outline" onClick={regenerateToken}>
              <RefreshCw className="size-4" />
              {t("mcpRegenerateToken")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={copyConfig}
              disabled={!canCopyAgentConfig}
              aria-describedby="mcp-agent-config-hint"
            >
              <Copy className="size-4" />
              {t("mcpCopyForAgent")}
            </Button>
          </div>
          <p
            id="mcp-agent-config-hint"
            className="text-xs text-muted-foreground"
          >
            {canCopyAgentConfig
              ? t("mcpAgentConfigHint")
              : t("mcpCopyRequiresRunning")}
          </p>
        </div>
      </SettingRow>
    </SettingCard>
  );
});

export const BrowserExtensionCard = memo(function BrowserExtensionCard() {
  const { t } = useTranslation();
  const { app, shell } = usePlatform();

  return (
    <SettingCard title={t("browserExtension")}>
      <div className="grid grid-cols-1 gap-2 py-4 @sm/settings:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={async () => {
            const dir = await app.getExtensionDir();
            if (dir) shell.open(dir);
          }}
        >
          <FolderOpen className="size-4" />
          {t("extensionDir")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => shell.open(EXTENSION_GUIDE_URL)}
        >
          <Puzzle className="size-4" />
          {t("extensionGuide")}
        </Button>
      </div>
    </SettingCard>
  );
});

export const OpenSourceCard = memo(function OpenSourceCard() {
  const { t } = useTranslation();
  const { shell } = usePlatform();

  return (
    <SettingCard title={t("openSourceProject")}>
      <div className="flex flex-col gap-4 py-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
            <CodeXml className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium">
              {GITHUB_REPOSITORY_NAME}
            </p>
            <p className="text-sm leading-5 text-muted-foreground">
              {t("openSourceDescription")}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => shell.open(GITHUB_REPOSITORY_URL)}
        >
          <Star className="fill-current" />
          {t("viewAndStarOnGithub")}
        </Button>
      </div>
    </SettingCard>
  );
});

export const MoreSettingsCard = memo(function MoreSettingsCard({
  onCheckUpdate,
}: {
  onCheckUpdate: () => void;
}) {
  const { t } = useTranslation();
  const { shell } = usePlatform();
  const { envPath } = useEnvPath();
  const local = useAppStore((state) => state.local);
  const apiKey = useAppStore((state) => state.apiKey);
  const updateAvailable = useSessionStore((state) => state.updateAvailable);
  const updateState = useSessionStore((state) => state.updateState);
  const updateBusy = ["checking", "downloading"].includes(updateState.status);
  const updateActionLabel = updateState.portable
    ? t("viewReleases")
    : updateState.status === "checking"
      ? t("checkingForUpdates")
      : updateState.status === "downloading"
        ? t("downloadingUpdate")
        : t("checkUpdate");

  const copyApiKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      toast.success(t("apiKeyCopied"));
    } catch {
      toast.error(t("clipboardCopyFailed"));
    }
  };

  return (
    <SettingCard title={t("moreSettings")}>
      {isWeb ? (
        <SettingRow label={t("apiKey")} htmlFor="setting-web-api-key">
          <div className="relative w-full">
            <Input
              id="setting-web-api-key"
              value={apiKey}
              readOnly
              aria-readonly="true"
              className="h-8 pr-10 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 -translate-y-1/2"
              onClick={copyApiKey}
              disabled={!apiKey}
              aria-label={t("copyApiKey")}
              title={t("copyApiKey")}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </SettingRow>
      ) : (
        <div className="grid grid-cols-1 gap-2 py-4 @sm/settings:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => envPath?.configDir && shell.open(envPath.configDir)}
          >
            <FolderOpen className="size-4" />
            {t("configDir")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => envPath?.binDir && shell.open(envPath.binDir)}
          >
            <FolderOpen className="size-4" />
            {t("binPath")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => local && shell.open(local)}
          >
            <FolderOpen className="size-4" />
            {t("localDir")}
          </Button>
        </div>
      )}
      <div className="mb-4 flex flex-col gap-3 py-4 @sm/settings:flex-row @sm/settings:items-center @sm/settings:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{t("currentVersion")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-xl font-semibold tabular-nums tracking-tight">
              {version}
            </span>
            {updateAvailable ? (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                {t("updateAvailable")}
              </span>
            ) : null}
          </div>
        </div>
        {!isWeb ? (
          <Button
            type="button"
            size="lg"
            variant={updateAvailable ? "default" : "outline"}
            className="w-full shrink-0 @sm/settings:w-auto"
            onClick={onCheckUpdate}
            disabled={updateBusy}
          >
            <RefreshCw
              className={
                updateState.status === "checking" ? "animate-spin" : undefined
              }
            />
            {updateActionLabel}
          </Button>
        ) : null}
      </div>
    </SettingCard>
  );
});
