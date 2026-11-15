import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resolvePlayerLanguage } from "./language";

const resources = {
  en: {
    translation: {
      close: "Close",
      emptyDescription:
        "Completed video downloads will appear here for playback.",
      emptyTitle: "No videos available",
      errorDescription: "Check the MediaGo server and try again.",
      errorTitle: "Could not load videos",
      loadingDescription: "Preparing your media library…",
      loadingTitle: "Loading videos",
      pageTitle: "MediaGo Player",
      playlist: "Playlist",
      refresh: "Refresh",
    },
  },
  "zh-CN": {
    translation: {
      close: "关闭",
      emptyDescription: "已完成下载的视频会显示在这里，供你播放。",
      emptyTitle: "暂无可播放的视频",
      errorDescription: "请检查 MediaGo 服务后重试。",
      errorTitle: "无法加载视频",
      loadingDescription: "正在准备媒体库…",
      loadingTitle: "正在加载视频",
      pageTitle: "MediaGo 播放器",
      playlist: "播放列表",
      refresh: "刷新",
    },
  },
  "zh-TW": {
    translation: {
      close: "關閉",
      emptyDescription: "已完成下載的影片會顯示在這裡，供你播放。",
      emptyTitle: "尚無可播放的影片",
      errorDescription: "請檢查 MediaGo 服務後重試。",
      errorTitle: "無法載入影片",
      loadingDescription: "正在準備媒體庫…",
      loadingTitle: "正在載入影片",
      pageTitle: "MediaGo 播放器",
      playlist: "播放列表",
      refresh: "重新整理",
    },
  },
  it: {
    translation: {
      close: "Chiudi",
      emptyDescription:
        "I video scaricati verranno visualizzati qui per la riproduzione.",
      emptyTitle: "Nessun video disponibile",
      errorDescription: "Controlla il server MediaGo e riprova.",
      errorTitle: "Impossibile caricare i video",
      loadingDescription: "Preparazione della libreria multimediale…",
      loadingTitle: "Caricamento dei video",
      pageTitle: "Lettore MediaGo",
      playlist: "Playlist",
      refresh: "Aggiorna",
    },
  },
} as const;

export const playerLanguage = resolvePlayerLanguage();

export const playerI18nReady = i18n.use(initReactI18next).init({
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  lng: playerLanguage,
  resources,
  supportedLngs: ["en", "zh-CN", "it", "zh-TW"],
});

export { i18n as playerI18n };
