import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/utils";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-sm font-medium shadow-xs transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-brand-hover active:bg-brand-active",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border-border bg-surface-raised text-foreground hover:bg-surface-hover active:bg-secondary",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-surface-hover active:bg-accent",
        ghost:
          "border-transparent bg-transparent shadow-none hover:bg-surface-hover active:bg-secondary",
        link: "border-transparent bg-transparent text-brand shadow-none underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[30px] px-2.5",
        sm: "h-6 px-2 text-xs",
        lg: "h-8 px-3.5",
        icon: "size-7 p-0",
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
        data-variant={variant ?? "default"}
        data-size={size ?? "default"}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
