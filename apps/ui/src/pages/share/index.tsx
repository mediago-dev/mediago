import { DownloadType } from "@mediago/shared-common";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useUiStore } from "@/store/ui";

const KNOWN_TYPES: Record<string, DownloadType> = {
  m3u8: DownloadType.m3u8,
  bilibili: DownloadType.bilibili,
  youtube: DownloadType.youtube,
  direct: DownloadType.direct,
  mediago: DownloadType.mediago,
};

// Best-effort source type from the URL (an explicit ?type= wins), so a shared
// Bilibili / YouTube / .m3u8 / direct-file link pre-selects the right tab.
function guessType(url: string): DownloadType | undefined {
  const u = url.toLowerCase();
  if (u.includes("bilibili.com") || u.includes("b23.tv")) {
    return DownloadType.bilibili;
  }
  if (u.includes("youtube.com") || u.includes("youtu.be")) {
    return DownloadType.youtube;
  }
  if (u.includes(".m3u8")) return DownloadType.m3u8;
  if (/\.(mp4|mkv|mov|flv|ts|webm)(\?|#|$)/.test(u)) return DownloadType.direct;
  return undefined;
}

/**
 * Deep-link entry for "share a link into MediaGo":
 *   /share?url=<link>&name=<title>&type=<m3u8|bilibili|youtube|direct|mediago>&folder=<sub>
 *
 * Opens the prefilled New Download modal, then redirects to the list so the
 * modal sits over the normal UI and the address bar stays clean. Lets a
 * browser bookmarklet / extension — and, if the LazyCat mobile client can
 * route a system share to an app URL, the share sheet — create a download in
 * one tap.
 */
export default function ShareRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const openNewDownload = useUiStore((s) => s.openNewDownload);

  useEffect(() => {
    const url = (params.get("url") ?? params.get("u") ?? "").trim();
    const name = (params.get("name") ?? params.get("title") ?? "").trim();
    const folder = (params.get("folder") ?? "").trim();
    const typeParam = params.get("type");
    const type =
      (typeParam ? KNOWN_TYPES[typeParam] : undefined) ??
      (url ? guessType(url) : undefined);

    openNewDownload(
      url
        ? { url, name: name || undefined, type, folder: folder || undefined }
        : undefined,
    );
    navigate("/", { replace: true });
    // Consume the query params once, open the modal, then clean the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
