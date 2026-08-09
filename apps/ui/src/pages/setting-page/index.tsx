import { useMemoizedFn } from "ahooks";
import { App, Badge, Modal, Progress } from "antd";
import { Copy, Download, FolderOpen, Upload } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { setConfigValue } from "@/api/config";
import {
  exportFavorites as exportFavoritesApi,
  importFavorites,
} from "@/api/favorite";
import {
  MgButton,
  MgCard,
  MgIconButton,
  MgPill,
  MgSegment,
  type MgSegmentOption,
  MgStepper,
  MgToggle,
} from "@/components/mg";
import { CHECK_UPDATE } from "@/const";
import { useEnvPath } from "@/hooks/use-config";
import { usePlatform } from "@/hooks/use-platform";
import {
  appStoreSelector,
  setAppStoreSelector,
  useAppStore,
} from "@/store/app";
import { updateSelector, useSessionStore } from "@/store/session";
import { cn, isWeb, tdApp } from "@/utils";
import { AppLanguage, type AppStore, AppTheme } from "@mediago/shared-common";

const version = import.meta.env.APP_VERSION;

/**
 * A single settings row: label (+ optional description) on the left, the
 * control on the right. `flex-wrap` makes the control drop below the label
 * on narrow widths, matching MediaGo.dc.html (settings rows, lines 276-280).
 */
function SettingRow({
  label,
  desc,
  control,
  last,
}: {
  label: ReactNode;
  desc?: ReactNode;
  control: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-[14px] px-[18px] py-[13px]",
        !last && "border-b border-mg-line",
      )}
    >
      <div className="min-w-[160px] flex-1">
        <div className="text-[13.5px] font-semibold text-mg-fg">{label}</div>
        {desc && (
          <div className="mt-[2px] text-[11.5px] text-mg-fg3">{desc}</div>
        )}
      </div>
      <div className="flex-none">{control}</div>
    </div>
  );
}

/** A settings group card: header (title + optional desktop badge) + rows. */
function SettingSection({
  title,
  desktop,
  badgeLabel,
  children,
}: {
  title: ReactNode;
  desktop?: boolean;
  badgeLabel: string;
  children: ReactNode;
}) {
  return (
    <MgCard className="overflow-hidden">
      <div className="flex items-center gap-[9px] border-b border-mg-line px-[18px] pb-[13px] pt-[15px]">
        <span className="text-[13.5px] font-extrabold tracking-[-0.01em] text-mg-fg">
          {title}
        </span>
        {desktop && (
          <MgPill className="bg-mg-surface2 text-mg-fg3">{badgeLabel}</MgPill>
        )}
      </div>
      <div>{children}</div>
    </MgCard>
  );
}

/** Mono text input used for paths / URLs / API keys. */
function MonoInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      readOnly={!onChange}
      onChange={(e) => onChange?.(e.target.value)}
      className="h-[38px] min-w-0 flex-1 rounded-[10px] border-[1.5px] border-mg-line bg-mg-surface2 px-3 font-mono text-[12px] text-mg-fg outline-none transition-colors focus:border-mg-primary focus:bg-mg-surface"
    />
  );
}

const SettingPage: React.FC = () => {
  const { dialog, shell, browser, update, on, off, app } = usePlatform();
  const { t } = useTranslation();
  const settings = useAppStore(useShallow(appStoreSelector));
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));
  const { envPath } = useEnvPath();
  const { message } = App.useApp();
  const { updateAvailable, updateChecking } = useSessionStore(
    useShallow(updateSelector),
  );
  const [openUpdateModal, setOpenUpdateModal] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);

  // Persist a single key the same way the AntD form did: push to Go Core,
  // then mirror into the Zustand store (which also drives app-wide theme /
  // language switches via setAppStore).
  const commit = useMemoizedFn(
    async <K extends keyof AppStore>(key: K, value: AppStore[K]) => {
      try {
        await setConfigValue(key as string, value);
        setAppStore({ [key]: value } as Partial<AppStore>);
      } catch (e: unknown) {
        message.error((e as Error).message);
      }
    },
  );

  useEffect(() => {
    const onDownloadProgress = (
      _event: unknown,
      progress: { percent: number },
    ) => {
      setDownloadProgress(progress.percent);
    };
    const onDownloaded = () => {
      setUpdateDownloaded(true);
    };
    on("update:downloadProgress", onDownloadProgress);
    on("update:downloaded", onDownloaded);
    return () => {
      off("update:downloadProgress", onDownloadProgress);
      off("update:downloaded", onDownloaded);
    };
  }, [on, off]);

  const onSelectDir = useMemoizedFn(async () => {
    const paths = await dialog.open({ type: "directory" });
    const local = paths?.[0];
    if (local) await commit("local", local);
  });

  const handleClearWebviewCache = useMemoizedFn(async () => {
    try {
      await browser.clearCache();
      message.success(t("clearCacheSuccess"));
    } catch {
      message.error(t("clearCacheFailed"));
    }
  });

  const handleImportFavorite = useMemoizedFn(async () => {
    try {
      const contents = await dialog.open({
        type: "file",
        filters: [{ name: "JSON", extensions: ["json"] }],
        readContent: true,
      });
      if (!contents?.length) return;
      const favorites = JSON.parse(contents[0]);
      if (Array.isArray(favorites)) await importFavorites(favorites);
      message.success(t("importFavoriteSuccess"));
    } catch {
      message.error(t("importFavoriteFailed"));
    }
  });

  const handleExportFavorite = useMemoizedFn(async () => {
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
      message.success(t("exportFavoriteSuccess"));
    } catch {
      message.error(t("exportFavoriteFailed"));
    }
  });

  const handleCheckUpdate = useMemoizedFn(async () => {
    tdApp.onEvent(CHECK_UPDATE);
    setOpenUpdateModal(true);
    await update.check();
  });

  const copy = useMemoizedFn((text: string) => {
    navigator.clipboard.writeText(text);
    message.success(t("skillsCopied"));
  });

  const openFolder = useMemoizedFn((target?: string) => {
    if (target) shell.open(target);
  });

  const openExtensionDir = useMemoizedFn(async () => {
    const dir = await app.getExtensionDir();
    if (dir) shell.open(dir);
  });

  // ---- Segment option sets ----
  const themeOptions: MgSegmentOption<AppTheme>[] = [
    { value: AppTheme.System, label: t("followSystem") },
    { value: AppTheme.Dark, label: t("dark") },
    { value: AppTheme.Light, label: t("light") },
  ];
  const langOptions: MgSegmentOption<AppLanguage>[] = [
    { value: AppLanguage.System, label: t("followSystem") },
    { value: AppLanguage.ZH, label: t("chinese") },
    { value: AppLanguage.EN, label: t("english") },
    { value: AppLanguage.IT, label: t("italian") },
  ];
  // closeMainWindow: true = quit on close, false = minimize to tray.
  const closeOptions: MgSegmentOption<"minimize" | "close">[] = [
    { value: "minimize", label: t("minimizeToTray") },
    { value: "close", label: t("close") },
  ];

  // ---- Skills commands (reuse the existing wiring) ----
  const coreUrl = envPath?.playerUrl
    ? envPath.playerUrl.replace(/\/player\/$/, "")
    : "";
  const installCmd = t("skillsInstallCmd");
  let setupCmd: string;
  if (isWeb) {
    const url = coreUrl || "http://localhost:8899";
    setupCmd = settings.apiKey
      ? `Set mediago url to ${url}, api key to ${settings.apiKey}`
      : `Set mediago url to ${url}`;
  } else {
    setupCmd = coreUrl
      ? `Set mediago url to ${coreUrl}`
      : "Set mediago url to http://localhost:39719";
  }

  const badge = t("desktopBadge");

  return (
    <div className="mediago-settings-scroll h-full overflow-auto bg-mg-bg">
      <div
        className="mx-auto max-w-[780px]"
        style={{ padding: "24px clamp(16px,3vw,34px) 90px" }}
      >
        <div className="mb-[22px]">
          <h1 className="m-0 text-[clamp(22px,2.4vw,28px)] font-extrabold tracking-[-0.03em] text-mg-fg">
            {t("setting")}
          </h1>
          <p className="mt-[5px] text-[13.5px] text-mg-fg2">
            {t("personalizeExperience")}
          </p>
        </div>

        <div className="flex flex-col gap-[18px]">
          {/* ---------- General ---------- */}
          <SettingSection title={t("basicSetting")} badgeLabel={badge}>
            <SettingRow
              label={t("localDir")}
              control={
                <div className="flex w-[min(320px,100%)] gap-2">
                  <MonoInput
                    value={settings.local}
                    placeholder={t("pleaseSelectDownloadDir")}
                  />
                  {!isWeb && (
                    <MgIconButton
                      size="lg"
                      title={t("selectFolder")}
                      onClick={onSelectDir}
                    >
                      <FolderOpen size={16} strokeWidth={2} />
                    </MgIconButton>
                  )}
                </div>
              }
            />
            {!isWeb && (
              <SettingRow
                label={t("downloaderTheme")}
                control={
                  <MgSegment
                    value={settings.theme}
                    onChange={(v) => commit("theme", v)}
                    options={themeOptions}
                  />
                }
              />
            )}
            <SettingRow
              label={t("displayLanguage")}
              control={
                <MgSegment
                  value={settings.language}
                  onChange={(v) => commit("language", v)}
                  options={langOptions}
                />
              }
            />
            {!isWeb && (
              <SettingRow
                label={t("downloadPrompt")}
                control={
                  <MgToggle
                    checked={settings.promptTone}
                    onChange={(v) => commit("promptTone", v)}
                  />
                }
              />
            )}
            <SettingRow
              label={t("showTerminal")}
              control={
                <MgToggle
                  checked={settings.showTerminal}
                  onChange={(v) => commit("showTerminal", v)}
                />
              }
            />
            {!isWeb && (
              <SettingRow
                label={t("autoUpgrade")}
                control={
                  <MgToggle
                    checked={settings.autoUpgrade}
                    onChange={(v) => commit("autoUpgrade", v)}
                  />
                }
              />
            )}
            {!isWeb && (
              <SettingRow
                label={t("allowBetaVersion")}
                control={
                  <MgToggle
                    checked={settings.allowBeta}
                    onChange={(v) => commit("allowBeta", v)}
                  />
                }
              />
            )}
            {!isWeb && (
              <SettingRow
                label={t("closeMainWindow")}
                control={
                  <MgSegment
                    value={settings.closeMainWindow ? "close" : "minimize"}
                    onChange={(v) => commit("closeMainWindow", v === "close")}
                    options={closeOptions}
                  />
                }
              />
            )}
            {!isWeb && (
              <SettingRow
                label={t("enableMobilePlayer")}
                last
                control={
                  <MgToggle
                    checked={settings.enableMobilePlayer}
                    onChange={(v) => commit("enableMobilePlayer", v)}
                  />
                }
              />
            )}
          </SettingSection>

          {/* ---------- Browser (desktop only) ---------- */}
          {!isWeb && (
            <SettingSection
              title={t("browserSetting")}
              desktop
              badgeLabel={badge}
            >
              <SettingRow
                label={t("audioMuted")}
                control={
                  <MgToggle
                    checked={settings.audioMuted}
                    onChange={(v) => commit("audioMuted", v)}
                  />
                }
              />
              <SettingRow
                label={t("openInNewWindow")}
                control={
                  <MgToggle
                    checked={settings.openInNewWindow}
                    onChange={(v) => commit("openInNewWindow", v)}
                  />
                }
              />
              <SettingRow
                label={t("blockAds")}
                control={
                  <MgToggle
                    checked={settings.blockAds}
                    onChange={(v) => commit("blockAds", v)}
                  />
                }
              />
              <SettingRow
                label={t("enterMobileMode")}
                control={
                  <MgToggle
                    checked={settings.isMobile}
                    onChange={(v) => commit("isMobile", v)}
                  />
                }
              />
              <SettingRow
                label={t("useImmersiveSniffing")}
                desc={t("immersiveSniffingDescription")}
                control={
                  <MgToggle
                    checked={settings.useExtension}
                    onChange={(v) => commit("useExtension", v)}
                  />
                }
              />
              <SettingRow
                label={t("privacy")}
                control={
                  <MgToggle
                    checked={settings.privacy}
                    onChange={(v) => commit("privacy", v)}
                  />
                }
              />
              <SettingRow
                label={t("moreAction")}
                last
                control={
                  <div className="flex flex-wrap gap-[7px]">
                    <MgButton size="sm" onClick={handleClearWebviewCache}>
                      {t("clearCache")}
                    </MgButton>
                    <MgButton size="sm" onClick={handleImportFavorite}>
                      <Upload size={15} strokeWidth={2} />
                      {t("importFavorite")}
                    </MgButton>
                    <MgButton size="sm" onClick={handleExportFavorite}>
                      <Download size={15} strokeWidth={2} />
                      {t("exportFavorite")}
                    </MgButton>
                  </div>
                }
              />
            </SettingSection>
          )}

          {/* ---------- Download ---------- */}
          <SettingSection title={t("downloadSetting")} badgeLabel={badge}>
            <SettingRow
              label={t("proxySetting")}
              control={
                <div className="flex w-[min(320px,100%)]">
                  <MonoInput
                    value={settings.proxy}
                    placeholder={t("pleaseEnterProxy")}
                    onChange={(v) => commit("proxy", v)}
                  />
                </div>
              }
            />
            <SettingRow
              label={t("downloadProxySwitch")}
              control={
                <MgToggle
                  checked={settings.downloadProxySwitch}
                  onChange={(v) => {
                    if (v && !settings.proxy) {
                      message.error(t("pleaseEnterProxyFirst"));
                      return;
                    }
                    commit("downloadProxySwitch", v);
                  }}
                />
              }
            />
            <SettingRow
              label={t("deleteSegments")}
              control={
                <MgToggle
                  checked={settings.deleteSegments}
                  onChange={(v) => commit("deleteSegments", v)}
                />
              }
            />
            <SettingRow
              label={t("maxRunner")}
              desc={t("maxRunnerDescription")}
              last
              control={
                <MgStepper
                  value={settings.maxRunner}
                  onChange={(v) => commit("maxRunner", v)}
                  min={1}
                  max={50}
                />
              }
            />
          </SettingSection>

          {/* ---------- Docker (desktop only) ---------- */}
          {!isWeb && (
            <SettingSection
              title={t("dockerSetting")}
              desktop
              badgeLabel={badge}
            >
              <SettingRow
                label={t("enableDocker")}
                control={
                  <MgToggle
                    checked={settings.enableDocker}
                    onChange={(v) => commit("enableDocker", v)}
                  />
                }
              />
              <SettingRow
                label={t("dockerUrl")}
                control={
                  <div className="flex w-[min(320px,100%)]">
                    <MonoInput
                      value={settings.dockerUrl}
                      placeholder={t("pleaseEnterDockerUrl")}
                      onChange={(v) => commit("dockerUrl", v)}
                    />
                  </div>
                }
              />
              <SettingRow
                label={t("apiKey")}
                last
                control={
                  <div className="flex w-[min(320px,100%)]">
                    <MonoInput
                      value={settings.apiKey}
                      placeholder={t("pleaseEnterApiKey")}
                      onChange={(v) => commit("apiKey", v)}
                    />
                  </div>
                }
              />
            </SettingSection>
          )}

          {/* ---------- Skills ---------- */}
          <SettingSection title={t("skillsSetting")} badgeLabel={badge}>
            <SettingRow
              label={t("skillsInstall")}
              control={
                <div className="flex w-[min(360px,100%)] gap-2">
                  <MonoInput value={installCmd} />
                  <MgButton
                    size="sm"
                    className="h-[38px]"
                    onClick={() => copy(installCmd)}
                  >
                    <Copy size={15} strokeWidth={2} />
                    {t("skillsCopy")}
                  </MgButton>
                </div>
              }
            />
            <SettingRow
              label={t("skillsInit")}
              last
              control={
                <div className="flex w-[min(360px,100%)] gap-2">
                  <MonoInput value={setupCmd} />
                  <MgButton
                    size="sm"
                    className="h-[38px]"
                    onClick={() => copy(setupCmd)}
                  >
                    <Copy size={15} strokeWidth={2} />
                    {t("skillsCopy")}
                  </MgButton>
                </div>
              }
            />
          </SettingSection>

          {/* ---------- More ---------- */}
          <SettingSection title={t("moreSettings")} badgeLabel={badge}>
            {isWeb && (
              <SettingRow
                label={t("apiKey")}
                control={
                  <div className="flex w-[min(320px,100%)]">
                    <MonoInput value={settings.apiKey} />
                  </div>
                }
              />
            )}
            {!isWeb && (
              <SettingRow
                label={t("moreAction")}
                control={
                  <div className="flex flex-wrap gap-[7px]">
                    <MgButton
                      size="sm"
                      onClick={() => openFolder(envPath?.configDir)}
                    >
                      <FolderOpen size={15} strokeWidth={2} />
                      {t("configDir")}
                    </MgButton>
                    <MgButton
                      size="sm"
                      onClick={() => openFolder(envPath?.binDir)}
                    >
                      <FolderOpen size={15} strokeWidth={2} />
                      {t("binPath")}
                    </MgButton>
                    <MgButton
                      size="sm"
                      onClick={() => openFolder(settings.local)}
                    >
                      <FolderOpen size={15} strokeWidth={2} />
                      {t("localDir")}
                    </MgButton>
                    <MgButton size="sm" onClick={openExtensionDir}>
                      <FolderOpen size={15} strokeWidth={2} />
                      {t("extensionDir")}
                    </MgButton>
                  </div>
                }
              />
            )}
            <SettingRow
              label={t("currentVersion")}
              desc={`MediaGo ${version}`}
              last
              control={
                isWeb ? (
                  <span className="font-mono text-[12px] text-mg-fg2">
                    {version}
                  </span>
                ) : (
                  <Badge dot={updateAvailable}>
                    <MgButton
                      variant="primary"
                      size="sm"
                      onClick={handleCheckUpdate}
                    >
                      {t("checkUpdate")}
                    </MgButton>
                  </Badge>
                )
              }
            />
          </SettingSection>
        </div>
      </div>

      <Modal
        title={t("updateModal")}
        open={openUpdateModal}
        onCancel={() => setOpenUpdateModal(false)}
        footer={
          updateAvailable
            ? [
                <MgButton
                  key="hidden"
                  size="sm"
                  onClick={() => setOpenUpdateModal(false)}
                >
                  {t("close")}
                </MgButton>,
                updateDownloaded ? (
                  <MgButton
                    key="install"
                    variant="primary"
                    size="sm"
                    className="ml-2"
                    onClick={() => update.install()}
                  >
                    {t("install")}
                  </MgButton>
                ) : (
                  <MgButton
                    key="update"
                    variant="primary"
                    size="sm"
                    className="ml-2"
                    onClick={() => update.startDownload()}
                  >
                    {t("update")}
                  </MgButton>
                ),
              ]
            : [
                <MgButton
                  key="hidden"
                  size="sm"
                  onClick={() => setOpenUpdateModal(false)}
                >
                  {t("close")}
                </MgButton>,
              ]
        }
      >
        <div className="flex min-h-28 flex-col justify-center">
          {updateChecking
            ? t("checkingForUpdates")
            : updateAvailable
              ? t("updateAvailable")
              : t("updateNotAvailable")}
          {!updateChecking && updateAvailable && (
            <Progress percent={updateDownloaded ? 100 : downloadProgress} />
          )}
        </div>
      </Modal>
    </div>
  );
};

export default SettingPage;
