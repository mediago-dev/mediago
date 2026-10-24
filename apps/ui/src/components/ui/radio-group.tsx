import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import { CircleIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

function RadioGroup({
  className,
  ...props
}: RadioGroupPrimitive.Props<string> & { className?: string }) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: Radio.Root.Props & { className?: string }) {
  return (
    <Radio.Root
      data-slot="radio-group-item"
      className={cn(
        "inline-flex aspect-square size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-input bg-surface-raised text-brand outline-none transition-[border-color,box-shadow] hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/15 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[checked]:border-primary aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/15",
        className,
      )}
      {...props}
    >
      <Radio.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-current" />
      </Radio.Indicator>
    </Radio.Root>
  );
}

export { RadioGroup, RadioGroupItem };
