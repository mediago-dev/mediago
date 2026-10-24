import { Popover } from "@base-ui/react/popover";
import { cn } from "@/utils";

const InfoTip = Popover.Root;

function InfoTipTrigger(props: Popover.Trigger.Props & { className?: string }) {
  return (
    <Popover.Trigger
      data-slot="info-tip-trigger"
      openOnHover
      delay={0}
      closeDelay={100}
      {...props}
      className={cn(
        "cursor-pointer disabled:cursor-not-allowed data-[disabled]:cursor-not-allowed",
        props.className,
      )}
    />
  );
}

function InfoTipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  children,
  ...props
}: Popover.Popup.Props &
  Pick<Popover.Positioner.Props, "side" | "sideOffset" | "align"> & {
    className?: string;
  }) {
  return (
    <Popover.Portal>
      <Popover.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className="isolate z-50"
      >
        <Popover.Popup
          data-slot="info-tip-content"
          className={cn(
            "z-50 w-fit max-w-xs origin-(--transform-origin) rounded-md bg-foreground px-3 py-1.5 text-left text-xs leading-relaxed text-background outline-none transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
          <Popover.Arrow className="size-2.5 rotate-45 rounded-[2px] bg-foreground data-[side=top]:-bottom-1 data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1" />
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

export { InfoTip, InfoTipContent, InfoTipTrigger };
