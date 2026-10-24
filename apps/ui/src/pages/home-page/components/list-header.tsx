import { DownloadFilter } from "@mediago/common";
import { useMemoizedFn } from "ahooks";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePlatform } from "@/hooks/use-platform";
import { isWeb } from "@/utils";

interface Props {
  onSelectAll: (checked: boolean) => void;
  checked: boolean | "indeterminate";
  selected: string[];
  onDeleteItems: (ids: string[]) => void;
  onDownloadItems: (ids: string[]) => void;
  onCancelItems: () => void;
  filter: DownloadFilter;
}

export function ListHeader({
  onSelectAll,
  checked,
  selected,
  onDeleteItems,
  onDownloadItems,
  onCancelItems,
  filter,
}: Props) {
  const { t } = useTranslation();
  const disabled = selected.length === 0;
  const { dialog } = usePlatform();

  const handleExportDownloadList = useMemoizedFn(async () => {
    try {
      const { exportDownloadList } = await import("@/api/download-task");
      const content = await exportDownloadList();
      await dialog.save({
        content:
          typeof content === "string" ? content : JSON.stringify(content),
        defaultPath: "downloads.txt",
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
    } catch {
      toast.error(t("exportDownloadListFailed"));
    }
  });

  return (
    <div className="flex flex-row items-center justify-between border-b px-3 py-2">
      <div className="flex flex-row items-center gap-3">
        <Checkbox
          checked={checked === true}
          indeterminate={checked === "indeterminate"}
          onCheckedChange={onSelectAll}
          aria-label={t("selectAll")}
        />
        <span
          className="cursor-pointer text-sm text-foreground"
          onClick={() => onSelectAll(true)}
        >
          {t("selectAll")}
        </span>
        {!!selected.length && (
          <span className="text-xs text-muted-foreground">
            <Trans
              i18nKey="selectedItems"
              values={{ count: selected.length }}
            />
          </span>
        )}
      </div>
      <div className="flex flex-row items-center gap-2">
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => onDeleteItems(selected)}
        >
          {t("delete")}
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => onCancelItems()}
        >
          {t("cancel")}
        </Button>
        {filter === DownloadFilter.list && (
          <Button disabled={disabled} onClick={() => onDownloadItems(selected)}>
            {t("download")}
          </Button>
        )}
        {!isWeb && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button />}>
              {t("more")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportDownloadList}>
                {t("exportDownloadList")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
