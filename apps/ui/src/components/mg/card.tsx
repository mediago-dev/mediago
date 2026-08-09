import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils";

/** Surface card — bg-surface, 1px line border, 16px radius by default. */
export function MgCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[16px] border border-mg-line bg-mg-surface",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Small colored badge/pill (status pill, type tag, count chip).
 * Colors come from the status/type meta tables, applied inline.
 */
export function MgPill({
  color,
  bg,
  children,
  className,
  title,
}: {
  color?: string;
  bg?: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{ color, background: bg }}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-[7px] py-[2px] text-[10.5px] font-bold",
        className,
      )}
    >
      {children}
    </span>
  );
}
