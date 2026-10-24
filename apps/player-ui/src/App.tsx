import { useMemoizedFn, useSize } from "ahooks";
import { ListVideo, LoaderCircle, RefreshCw } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import videojs from "video.js";
import itVideoJsMessages from "video.js/dist/lang/it.json";
import zhCNVideoJsMessages from "video.js/dist/lang/zh-CN.json";
import "video.js/dist/video-js.css";
import "@videojs/themes/dist/sea/index.css";
import "./player-theme.css";
import useSWR from "swr";
import type Player from "video.js/dist/types/player";
import emptyPlayer from "@/assets/images/empty-player.png";
import errorPlayer from "@/assets/images/error-player.png";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  type VideoItem,
  getVideoById,
  getVideoList,
  getVideoListKey,
} from "./api";
import { cn, getVideoURL } from "./lib/utils";
import { usePlayerSize } from "./hooks/usePlayerSize";
import { playerLanguage } from "./i18n";

videojs.addLanguage("it", itVideoJsMessages);
videojs.addLanguage("zh-CN", zhCNVideoJsMessages);

interface PlaylistItemProps {
  video: VideoItem;
  isActive: boolean;
  onClick: (video: VideoItem) => void;
  variant?: "desktop" | "mobile";
}

const PlaylistItem = memo(function PlaylistItem({
  video,
  isActive,
  onClick,
  variant = "desktop",
}: PlaylistItemProps) {
  const handleClick = useMemoizedFn(() => onClick(video));

  if (variant === "mobile") {
    return (
      <li>
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "w-full rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent",
            {
              "border-blue-500 bg-blue-50 text-blue-600 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-400":
                isActive,
            },
          )}
        >
          <div className="line-clamp-2">{video.title}</div>
        </button>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "cursor-pointer rounded-md p-3 text-sm transition-colors hover:bg-accent",
        {
          "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400":
            isActive,
        },
      )}
    >
      <button type="button" className="w-full text-left" onClick={handleClick}>
        <div className="line-clamp-2">{video.title}</div>
      </button>
    </li>
  );
});

interface PlayerFeedbackProps {
  title: string;
  description: string;
  illustration?: string;
  loading?: boolean;
  onRetry?: () => void;
}

function PlayerFeedback({
  title,
  description,
  illustration,
  loading = false,
  onRetry,
}: PlayerFeedbackProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#141415] px-6 text-white">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        {loading ? (
          <LoaderCircle className="size-8 animate-spin text-blue-400" />
        ) : illustration ? (
          <img
            src={illustration}
            alt=""
            aria-hidden="true"
            className="h-36 w-52 object-contain sm:h-40 sm:w-60"
          />
        ) : null}
        <div className="space-y-1.5">
          <h1 className="text-base font-semibold">{title}</h1>
          <p className="text-sm text-white/60">{description}</p>
        </div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-blue-500 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            <RefreshCw className="size-4" />
            {t("refresh")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function PlayerPage() {
  const { t } = useTranslation();
  const [currentVideo, setCurrentVideo] = useState("");
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLDivElement>(null);
  const videoContainer = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const size = useSize(videoContainer);

  const {
    data: videoList,
    error,
    isLoading,
    mutate,
  } = useSWR(getVideoListKey, getVideoList, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const hasVideos = Array.isArray(videoList) && videoList.length > 0;

  const { calculateAndSetPlayerSize } = usePlayerSize(
    playerRef,
    videoContainer,
    size,
  );

  const changeVideoAndPlay = useMemoizedFn((url: string, mimeType?: string) => {
    if (!playerRef.current) return;

    setCurrentVideo(url);
    playerRef.current.src({
      src: getVideoURL(url),
      type: mimeType || "video/mp4",
    });
    playerRef.current.play();
  });

  useEffect(() => {
    if (!hasVideos) return;

    if (!playerRef.current) {
      const videoElement = document.createElement("video-js");
      videoRef.current?.appendChild(videoElement);

      playerRef.current = videojs(
        videoElement,
        {
          controls: true,
          language: playerLanguage,
        },
        () => {
          videojs.log("player is ready");
        },
      );

      playerRef.current.on("loadedmetadata", () => {
        if (!playerRef.current) return;

        videojs.log("Metadata loaded, ready to play");

        calculateAndSetPlayerSize();
      });
    }

    return () => {
      if (playerRef.current && !playerRef.current.isDisposed()) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [calculateAndSetPlayerSize, hasVideos]);

  useEffect(() => {
    if (!playerRef.current) return;

    // Check for ?id= query parameter to auto-play a specific video by task ID
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("id");

    if (targetId) {
      getVideoById(Number(targetId))
        .then((video) => {
          if (video?.url) {
            changeVideoAndPlay(video.url, video.mimeType);
          }
        })
        .catch(() => {
          // Fallback to first video in list
          if (Array.isArray(videoList) && videoList.length > 0) {
            const v = videoList[0];
            changeVideoAndPlay(v.url, v.mimeType);
          }
        });
      return;
    }

    // Default: play the first video in the list
    if (Array.isArray(videoList) && videoList.length > 0) {
      const v = videoList[0];
      changeVideoAndPlay(v.url, v.mimeType);
    }
  }, [videoList, changeVideoAndPlay]);

  const handleVideoClick = useMemoizedFn((video: VideoItem) => {
    changeVideoAndPlay(video.url, video.mimeType);
    setOpen(false);
  });

  const handleOpen = useMemoizedFn(() => {
    setOpen(true);
  });

  if (isLoading) {
    return (
      <PlayerFeedback
        loading
        title={t("loadingTitle")}
        description={t("loadingDescription")}
      />
    );
  }

  if (error) {
    return (
      <PlayerFeedback
        illustration={errorPlayer}
        title={t("errorTitle")}
        description={t("errorDescription")}
        onRetry={() => void mutate()}
      />
    );
  }

  if (!hasVideos) {
    return (
      <PlayerFeedback
        illustration={emptyPlayer}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        onRetry={() => void mutate()}
      />
    );
  }

  return (
    <div className="group relative flex h-full w-full flex-col dark:bg-[#141415] md:flex-row">
      {/* Desktop/Tablet: Show list button on hover (hidden on mobile) */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <button
              type="button"
              className="absolute right-5 top-5 z-50 hidden cursor-pointer items-center gap-2 rounded-md border border-white/80 bg-black/50 px-3 py-1.5 text-sm text-white backdrop-blur-sm transition-all hover:bg-black/70 md:group-hover:flex"
              onClick={handleOpen}
            />
          }
        >
          <ListVideo className="size-4 shrink-0 stroke-[1.75]" />
          <span className="hidden sm:inline">{t("playlist")}</span>
        </SheetTrigger>

        {/* Desktop/Tablet: Right drawer (not used on mobile) */}
        <SheetContent
          side="right"
          className="hidden w-full sm:max-w-md md:block md:max-w-lg"
        >
          <SheetHeader>
            <SheetTitle>{t("playlist")}</SheetTitle>
          </SheetHeader>
          <ScrollArea className="mt-4 h-[calc(100vh-8rem)]">
            <ul className="flex flex-col gap-1 pr-4">
              {videoList?.map((video) => (
                <PlaylistItem
                  key={video.id}
                  video={video}
                  isActive={video.url === currentVideo}
                  onClick={handleVideoClick}
                />
              ))}
            </ul>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Video Player - Mobile has reduced height */}
      <div
        className="h-[40vh] w-full md:h-full bg-black overflow-hidden"
        data-vjs-player
        ref={videoContainer}
      >
        <div
          className="w-full h-full vjs-theme-sea flex items-center justify-center"
          ref={videoRef}
        ></div>
      </div>

      {/* Mobile: Bottom video list (visible only on small screens) */}
      <div className="block flex-1 overflow-hidden border-t border-border bg-background md:hidden">
        <div className="flex h-full flex-col p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("playlist")}</h3>
          <ScrollArea className="flex-1">
            <ul className="flex flex-col gap-2 pr-4">
              {videoList?.map((video) => (
                <PlaylistItem
                  key={video.id}
                  video={video}
                  isActive={video.url === currentVideo}
                  onClick={handleVideoClick}
                  variant="mobile"
                />
              ))}
            </ul>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
