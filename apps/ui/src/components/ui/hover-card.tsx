import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";
import { cn } from "@/utils";

function HoverCard(props: HoverCardPrimitive.Root.Props) {
  return <HoverCardPrimitive.Root {...props} />;
}

function HoverCardTrigger(
  props: HoverCardPrimitive.Trigger.Props & { className?: string },
) {
  return (
    <HoverCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      {...props}
      className={cn(
        "cursor-pointer disabled:cursor-not-allowed data-[disabled]:cursor-not-allowed",
        props.className,
      )}
    />
  );
}

function HoverCardContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  alignOffset = 0,
  ...props
}: HoverCardPrimitive.Popup.Props &
  Pick<
    HoverCardPrimitive.Positioner.Props,
    "align" | "side" | "sideOffset" | "alignOffset"
  > & { className?: string }) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <HoverCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "z-50 w-64 origin-(--transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        />
      </HoverCardPrimitive.Positioner>
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
