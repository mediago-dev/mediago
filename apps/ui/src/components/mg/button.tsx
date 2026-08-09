import { cva, type VariantProps } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/utils";

/** Text button — matches the redesign's button language (MediaGo.dc.html). */
export const mgButton = cva(
  "inline-flex select-none cursor-pointer items-center justify-center gap-2 font-bold outline-none transition-[filter,background-color,border-color,color] disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        primary:
          "border border-transparent bg-mg-primary text-mg-primary-fg shadow-[0_6px_16px_-5px_rgba(91,91,245,.55)] hover:brightness-[1.06]",
        surface:
          "border border-mg-line bg-mg-surface text-mg-fg hover:border-mg-line2",
        soft: "border border-mg-line bg-mg-surface2 text-mg-fg",
        ghost:
          "border border-transparent bg-transparent text-mg-fg2 hover:bg-mg-surface2",
        dashed:
          "border border-dashed border-mg-line2 bg-transparent text-mg-fg3 hover:text-mg-fg2",
        danger:
          "border border-transparent bg-[#f43f5e] text-white hover:brightness-[1.06]",
        dangerSoft:
          "border border-transparent bg-[rgba(244,63,94,.1)] text-[#f43f5e]",
      },
      size: {
        sm: "h-[34px] rounded-[9px] px-3 text-[12.5px]",
        md: "h-10 rounded-[11px] px-4 text-[13.5px]",
        lg: "h-11 rounded-xl px-5 text-[13.5px]",
      },
    },
    defaultVariants: { variant: "surface", size: "md" },
  },
);

export interface MgButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof mgButton> {}

export const MgButton = forwardRef<HTMLButtonElement, MgButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(mgButton({ variant, size }), className)}
      {...props}
    />
  ),
);
MgButton.displayName = "MgButton";

/** Square icon button. */
export const mgIconButton = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "border border-transparent bg-mg-primary text-white",
        surface:
          "border border-mg-line bg-mg-surface text-mg-fg2 hover:text-mg-fg",
        soft: "border border-transparent bg-mg-surface2 text-mg-fg2",
        ghost:
          "border border-transparent bg-transparent text-mg-fg2 hover:bg-mg-surface2",
        danger: "border border-transparent bg-[#f43f5e] text-white",
      },
      size: {
        sm: "size-[34px] rounded-[9px]",
        md: "size-9 rounded-[10px]",
        lg: "size-[38px] rounded-[11px]",
      },
    },
    defaultVariants: { variant: "surface", size: "sm" },
  },
);

export interface MgIconButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof mgIconButton> {}

export const MgIconButton = forwardRef<HTMLButtonElement, MgIconButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(mgIconButton({ variant, size }), className)}
      {...props}
    />
  ),
);
MgIconButton.displayName = "MgIconButton";
