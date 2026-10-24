import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 disabled:active:translate-y-0 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
  {
    variants: {
      variant: {
        default:
          "bg-action text-primary-foreground hover:bg-action-hover active:bg-action-active",
        dark: "bg-action text-primary-foreground hover:bg-action-hover active:bg-action-active",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-border bg-surface-raised text-foreground hover:border-border-strong hover:bg-surface-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-surface-hover",
        "tertiary-pill":
          "rounded-full bg-surface-selected text-brand-foreground hover:bg-surface-hover",
        ghost:
          "bg-transparent text-foreground-secondary hover:bg-surface-hover hover:text-foreground",
        "light-surface":
          "bg-surface-raised text-foreground hover:bg-surface-hover",
        link: "text-brand-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5 text-[13px]",
        sm: "h-[30px] px-3 text-xs",
        xs: "h-7 px-2.5 text-xs",
        pill: "h-7 rounded-full px-2.5 text-xs",
        lg: "h-9 px-5 text-sm",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    Omit<ButtonPrimitive.Props, "className">,
    VariantProps<typeof buttonVariants> {
  className?: string;
}

const Button = React.forwardRef<HTMLElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <ButtonPrimitive
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
