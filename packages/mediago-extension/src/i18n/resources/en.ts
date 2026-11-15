import type { ExtensionResources } from "./zh";

const resource: ExtensionResources = {
  popup: {
    header: "MediaGo Sniffer",
    workspaceLabel: "Resource workspace",
    pageContext: "Current page",
    untitledPage: "Untitled page",
    noPageUrl: "No page URL",
    detectedCount_one: "{{count}} resource detected",
    detectedCount_other: "{{count}} resources detected",
    resourceList: "Detected resources",
    clear: "Clear",
    clearLabel: "Clear detected resources",
    importAll: "Import all",
    importAllWithCount: "Import all ({{count}})",
    importing: "Importing resources",
    settings: "Settings",
    imported: "Imported {{count}} task(s)",
    importFailed: "Import failed",
    loadingTitle: "Scanning this page",
    loadErrorTitle: "Could not load resources",
    loadErrorHint: "The extension could not read this page. Try again.",
    retry: "Try again",
    setupTitle: "Finish connection setup",
    setupHint:
      "Add your MediaGo server address before importing detected resources.",
    openConnectionSettings: "Open connection settings",
    connectionErrorTitle: "MediaGo is offline",
    connectionErrorHint:
      "Check that MediaGo is running and that the connection settings are correct.",
  },
  status: {
    detecting: "Detecting",
    unavailable: "Status unavailable",
    schemaMode: "Schema mode",
    notConfigured: "Not configured",
    connectionFailed: "Connection failed",
  },
  empty: {
    title: "No downloadable resources detected on this page yet.",
    hint: "Matching sources show up here automatically as you browse.",
    reloadPage: "Reload current page",
    openSettings: "Open settings",
  },
  source: {
    unnamed: "(untitled)",
    import: "Import",
    importNamed: "Import {{name}}",
    inspecting: "Inspecting",
    autoBest: "Auto best",
    qualityUnknown: "Quality unknown",
  },
  options: {
    pageTitle: "MediaGo Extension Settings",
    workspaceLabel: "Browser workspace",
    settingsLabel: "Settings",
    description:
      "Configure how captured media is sent to MediaGo and tune extension preferences.",
    preferencesLabel: "Extension preferences",
    loadingTitle: "Loading settings",
    loadErrorTitle: "Could not load settings",
    loadErrorHint:
      "The extension could not read its saved settings. Try loading them again.",
    retry: "Try again",
    language: {
      title: "Interface Language",
      description:
        'Language used by the popup and options page. "Follow system" picks based on the browser UI language.',
      system: "Follow system",
      zh: "中文",
      en: "English",
      it: "Italiano",
      zhTW: "Traditional Chinese",
    },
    server: {
      title: "Dispatch Mode",
      eyebrow: "Connection",
      modeLegend: "MediaGo connection mode",
      description:
        "Choose one explicit route for sending captured resources to MediaGo. Connection failures stay visible until you resolve them or change modes.",
      modeSchemaTitle: "Desktop / Schema protocol",
      modeSchemaDesc:
        "Open MediaGo Desktop through mediago-community:// and show a prefilled review dialog. Desktop launches automatically when needed.",
      modeDesktopHttpTitle: "Desktop / HTTP local",
      modeDesktopHttpDesc:
        "Talk to a running Desktop through {{base}}. Requires Desktop to be running, but no confirmation dialog.",
      modeDockerHttpTitle: "Docker / Self-hosted / HTTP",
      modeDockerHttpDesc:
        "Connect to a remote Docker deployment or any self-hosted MediaGo server. Requires a server URL; add an API Key when auth is enabled.",
      serverUrlLabel: "Server URL",
      serverUrlPlaceholder: "http://your-host:8899",
      apiKeyLabel: "API Key",
      apiKeyOptional: "(optional)",
      apiKeyPlaceholder: "Leave blank to skip the X-API-Key header",
      schemaNoteLead: "Uses the new",
      schemaNoteBody:
        "Share Intent protocol to open MediaGo Desktop with a review dialog.",
      schemaNoteMid:
        'Share Intent protocol to invoke Desktop. The active tab navigates to the protocol URL. When Chrome first shows "Open MediaGo-community?", choose',
      schemaAllow: "Allow",
      schemaAlways: "Always allow",
      schemaAfter:
        "so Chrome stops asking; MediaGo still opens its review dialog.",
      limitationLabel: "Limitation",
      limitationBody:
        "Schema sends one task without headers. Use HTTP mode for batches or sources that require headers.",
      desktopHttpNoteLead: "Always connects to",
      desktopHttpNoteTail:
        '. Desktop listens automatically on startup; use "Test connection" to verify it is online.',
    },
    importBehaviour: {
      title: "Import Behaviour",
      httpDescription:
        "HTTP modes can add tasks directly and optionally start downloading immediately.",
      schemaReviewOnly:
        "Schema only opens MediaGo with a review dialog. It never creates or starts a task automatically.",
      schemaDisabled:
        "Immediate download is unavailable because Schema mode always opens a review dialog.",
      downloadNowLabel: "Start downloading immediately",
      downloadNowDesc:
        "On: the task is queued and started. Off: it is only added to the list. Applies to HTTP modes only.",
    },
    pageQuickAction: {
      title: "Page shortcut",
      description:
        "Show “Add to MediaGo” in the top-right corner of supported pages.",
      enabledLabel: "Show the page shortcut",
      enabledDescription:
        "Clicking adds the current page to the extension popup list and opens it.",
    },
    rules: {
      title: "Sniffing Rules",
      description:
        "A compact overview of the resource patterns shared with MediaGo Desktop.",
      descriptionLead: "Rules are maintained centrally in",
      descriptionTail: "and shared between Desktop and the browser extension.",
      m3u8Label: "HLS / m3u8 streams",
      directLabel: "Direct media files",
      bilibiliLabel: "Bilibili video pages",
      youtubeLabel: "YouTube",
    },
    about: {
      title: "About",
      productName: "MediaGo Extension",
      description: "Media capture companion for MediaGo",
      version: "Version {{version}}",
    },
  },
  common: {
    close: "Close",
    notifications: "Notifications",
    save: "Save",
    saved: "Saved",
    saveFailed: "Failed to save",
    testConnection: "Test connection",
    testing: "Testing",
    saving: "Saving",
  },
  errors: {
    serverUrlRequired: "Please fill in the server URL first",
    dockerServerRequired: "Docker mode requires a server URL",
    schemaBatchNotSupported:
      "Schema mode can only dispatch one task at a time; switch to HTTP mode (Options page) for batch imports.",
    schemaNoActiveTab:
      "No active tab in the current window; cannot invoke the protocol",
    schemaHeadersNotSupported:
      "Schema mode does not send request headers; use HTTP mode for this source.",
    schemaInvoked:
      "Invoked mediago-community://. If the Desktop window didn't appear, make sure MediaGo Desktop is installed.",
    serverNotConfigured: "MediaGo server not configured",
    dockerNotConfigured:
      "Docker mode has no server URL yet. Configure one on the options page.",
    unknown: "{{detail}}",
  },
};

export default resource;
