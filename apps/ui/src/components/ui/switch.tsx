import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import * as React from "react";

import { cn } from "@/utils";

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex cursor-pointer shrink-0 items-center rounded-full border border-transparent p-px outline-none transition-[background-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/15 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[size=default]:h-[1.125rem] data-[size=default]:w-8 data-[size=sm]:h-4 data-[size=sm]:w-7 data-[checked]:bg-primary data-[unchecked]:bg-border",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-surface-raised shadow-sm ring-0 transition-transform group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-3 data-[checked]:translate-x-3.5 data-[unchecked]:translate-x-0 group-data-[size=sm]/switch:data-[checked]:translate-x-3 dark:data-[checked]:bg-primary-foreground dark:data-[unchecked]:bg-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
