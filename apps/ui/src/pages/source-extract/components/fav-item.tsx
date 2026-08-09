import { type ReactElement, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/utils";

/** Bookmark tile palette from the redesign (MediaGo.dc.html `bmColors`). */
const BM_COLORS = [
  "#5b5bf5",
  "#f43f5e",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
];

function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  }
}

/** Stable color pick from the title so a bookmark keeps its tile color. */
function colorOf(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return BM_COLORS[hash % BM_COLORS.length];
}

interface Props {
  onContextMenu?: () => void;
  onClick?: () => void;
  onClose?: () => void;
  src?: string;
  url?: string;
  icon?: ReactElement;
  title?: string;
  /** Dashed "add" affordance instead of a bookmark tile. */
  add?: boolean;
}

export function FavItem({
  onContextMenu,
  onClick,
  onClose,
  src,
  url,
  icon,
  title,
  add,
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const showFavicon = !!src && !imgFailed;
  const letter = (title || hostOf(url) || "?").trim().charAt(0).toUpperCase();
  const tileColor = colorOf(title || url || "");

  if (add) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[15px] border border-dashed border-mg-line2 bg-transparent p-[16px_12px] text-mg-fg3 transition-colors hover:text-mg-fg2"
      >
        {icon}
        <span className="text-[12px] font-semibold">{title}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onContextMenu={onContextMenu}
      onClick={onClick}
      className="group relative flex cursor-pointer flex-col items-center gap-[10px] rounded-[15px] border border-mg-line bg-mg-surface p-[16px_12px] transition-[border-color,box-shadow] hover:border-mg-primary hover:shadow-[0_8px_20px_-12px_var(--mg-shadow)]"
    >
      {onClose && (
        <span
          role="button"
          tabIndex={-1}
          title="remove"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }}
          className="absolute right-[6px] top-[6px] hidden size-5 items-center justify-center rounded-md bg-mg-surface2 text-mg-fg3 hover:text-mg-fg group-hover:flex"
        >
          <X size={13} strokeWidth={2.4} />
        </span>
      )}
      <span
        className={cn(
          "flex size-[46px] items-center justify-center overflow-hidden rounded-[14px] text-[19px] font-extrabold text-white",
        )}
        style={showFavicon ? undefined : { background: tileColor }}
      >
        {showFavicon ? (
          <img
            src={src}
            alt=""
            className="size-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          letter
        )}
      </span>
      <span className="max-w-full truncate text-[13px] font-bold text-mg-fg">
        {title}
      </span>
      <span className="max-w-full truncate font-mono text-[10.5px] text-mg-fg3">
        {hostOf(url)}
      </span>
    </button>
  );
}
