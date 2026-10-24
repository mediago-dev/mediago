import { ChevronLeftIcon, ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { type ComponentProps, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, isWeb } from "@/utils";
import {
  getPageItems,
  getPaginationState,
  shouldCorrectPage,
} from "./pagination-logic";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface PaginationControlProps extends Omit<
  ComponentProps<"nav">,
  "onChange"
> {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  showSizeChanger?: boolean;
  isLoading?: boolean;
}

function PaginationControl({
  className,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  showSizeChanger,
  isLoading = false,
  ...props
}: PaginationControlProps) {
  const { t } = useTranslation();
  const { hasItems, safePageSize, totalPages, safeCurrent } =
    getPaginationState(page, pageSize, total);
  const pageItems = getPageItems(safeCurrent, totalPages);
  const sizeOptions = pageSizeOptions.includes(safePageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, safePageSize];
  const canChangePageSize =
    Boolean(onPageSizeChange) && (showSizeChanger ?? total > 50);

  useEffect(() => {
    if (shouldCorrectPage(page, safeCurrent, isLoading)) {
      onPageChange(safeCurrent);
    }
  }, [isLoading, onPageChange, page, safeCurrent]);

  const changePage = (nextPage: number) => {
    if (!hasItems) return;
    onPageChange(Math.min(Math.max(nextPage, 1), totalPages));
  };

  const changePageSize = (value: string) => {
    const nextPageSize = Number(value);
    const nextTotalPages = Math.max(1, Math.ceil(total / nextPageSize));
    onPageChange(Math.min(safeCurrent, nextTotalPages));
    onPageSizeChange?.(nextPageSize);
  };

  return (
    <nav
      aria-label={t("pagination")}
      aria-busy={isLoading}
      className={cn("flex items-center gap-1", className)}
      {...props}
    >
      <Button
        type="button"
        variant="outline"
        className={cn(isWeb ? "size-7" : "size-6", "rounded-md p-0")}
        aria-label={t("previousPage")}
        disabled={!hasItems || safeCurrent === 1}
        onClick={() => changePage(safeCurrent - 1)}
      >
        <ChevronLeftIcon className="size-4" />
      </Button>

      {pageItems.map((item) => {
        if (typeof item !== "number") {
          const isBackward = item === "ellipsis-start";
          const label = t(
            isBackward ? "jumpBackwardPages" : "jumpForwardPages",
            { count: 5 },
          );
          return (
            <Button
              key={item}
              type="button"
              variant="ghost"
              className={cn(
                isWeb ? "size-7" : "size-6",
                "rounded-md p-0 text-muted-foreground",
              )}
              aria-label={label}
              title={label}
              onClick={() => changePage(safeCurrent + (isBackward ? -5 : 5))}
            >
              <EllipsisIcon className="size-4" />
            </Button>
          );
        }

        return (
          <Button
            key={item}
            type="button"
            variant={item === safeCurrent ? "default" : "ghost"}
            className={cn(isWeb ? "size-7" : "size-6", "rounded-md p-0")}
            aria-current={item === safeCurrent ? "page" : undefined}
            aria-label={t("pageNumber", { page: item })}
            disabled={!hasItems}
            onClick={() => changePage(item)}
          >
            {item}
          </Button>
        );
      })}

      <Button
        type="button"
        variant="outline"
        className={cn(isWeb ? "size-7" : "size-6", "rounded-md p-0")}
        aria-label={t("nextPage")}
        disabled={!hasItems || safeCurrent === totalPages}
        onClick={() => changePage(safeCurrent + 1)}
      >
        <ChevronRightIcon className="size-4" />
      </Button>

      {canChangePageSize ? (
        <Select
          items={sizeOptions.map((size) => ({
            value: String(size),
            label: t("itemsPerPageCount", { count: size }),
          }))}
          value={String(safePageSize)}
          onValueChange={changePageSize}
        >
          <SelectTrigger
            size="sm"
            className={cn("ml-2 min-w-24", !isWeb && "h-6 min-w-20")}
            aria-label={t("itemsPerPage")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            {sizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t("itemsPerPageCount", { count: size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </nav>
  );
}

export { PaginationControl };
export type { PaginationControlProps };
