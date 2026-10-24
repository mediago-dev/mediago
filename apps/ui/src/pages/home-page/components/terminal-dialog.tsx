import { X } from "lucide-react";
import type { TaskOrigin } from "@mediago/common";
import type React from "react";
import { useTranslation } from "react-i18next";
import { useMemoizedFn } from "ahooks";
import Terminal from "@/components/download-terminal";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Props {
  trigger: React.ReactElement;
  title: string;
  id: number;
  origin?: TaskOrigin;
}

export function TerminalDialog({
  trigger,
  title,
  id,
  origin = "local",
}: Props) {
  const { t } = useTranslation();
  const stopContextPropagation = useMemoizedFn(
    (event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation(),
  );

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden border-[#252936] bg-[#0b0d12] p-0 text-[#d7dce5] shadow-2xl sm:max-w-[780px]"
        onContextMenu={stopContextPropagation}
      >
        <div className="flex h-12 items-center gap-2 border-b border-[#252936] bg-[#13161d] px-4">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <div className="ml-2 min-w-0 flex-1">
            <DialogTitle className="truncate font-mono text-xs font-medium text-[#c5cbd6]">
              {t("downloadLog")} · {title}
            </DialogTitle>
            <DialogDescription className="sr-only">{title}</DialogDescription>
          </div>
          <DialogClose
            render={
              <button
                type="button"
                title={t("close")}
                aria-label={t("close")}
                className="flex size-7 items-center justify-center rounded-md text-[#7f8795] transition-colors hover:bg-white/10 hover:text-white"
              />
            }
          >
            <X className="size-4" />
          </DialogClose>
        </div>
        <Terminal
          id={id}
          origin={origin}
          className="h-[min(58vh,400px)] w-full p-3"
        />
      </DialogContent>
    </Dialog>
  );
}
