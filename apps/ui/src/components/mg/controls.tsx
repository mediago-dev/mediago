import type { ReactNode } from "react";
import { cn } from "@/utils";

/** Pill switch — 44x26 track, 22px knob (MediaGo.dc.html settings toggle). */
export function MgToggle({
  checked,
  onChange,
  disabled,
  className,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={cn(
        "relative h-[26px] w-11 shrink-0 cursor-pointer rounded-full p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-mg-primary" : "bg-mg-line2",
        className,
      )}
    >
      <span
        className="absolute top-[2px] size-[22px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,.25)] transition-transform"
        style={{ transform: `translateX(${checked ? "20px" : "2px"})` }}
      />
    </button>
  );
}

export interface MgSegmentOption<T> {
  value: T;
  label: ReactNode;
}

/**
 * Segmented control.
 * - "solid" (default): active = primary fill / white text (settings, quality)
 * - "card": active = surface card + shadow (modal single/batch tabs)
 */
export function MgSegment<T extends string | number>({
  value,
  onChange,
  options,
  variant = "solid",
  className,
  itemClassName,
}: {
  value: T;
  onChange: (v: T) => void;
  options: MgSegmentOption<T>[];
  variant?: "solid" | "card";
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex gap-[3px] rounded-[10px] bg-mg-surface2 p-[3px]",
        className,
      )}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-[30px] cursor-pointer rounded-lg px-3 text-[12px] font-bold transition-colors",
              on
                ? variant === "card"
                  ? "bg-mg-surface text-mg-fg shadow-[0_2px_6px_-2px_rgba(20,20,40,.18)]"
                  : "bg-mg-primary text-white"
                : variant === "card"
                  ? "bg-transparent text-mg-fg3"
                  : "bg-transparent text-mg-fg2",
              itemClassName,
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Numeric stepper (−  value  +). */
export function MgStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center overflow-hidden rounded-[10px] border border-mg-line",
        className,
      )}
    >
      <button
        type="button"
        aria-label="decrease"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex size-[34px] cursor-pointer items-center justify-center bg-mg-surface2 text-[18px] font-bold text-mg-fg"
      >
        −
      </button>
      <span className="min-w-[38px] text-center text-[14px] font-extrabold tabular-nums">
        {value}
      </span>
      <button
        type="button"
        aria-label="increase"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex size-[34px] cursor-pointer items-center justify-center bg-mg-surface2 text-[18px] font-bold text-mg-fg"
      >
        +
      </button>
    </div>
  );
}
