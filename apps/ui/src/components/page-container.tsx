import type React from "react";
import type { FC } from "react";
import { cn } from "@/utils";

interface PageContainerProps {
  children: React.ReactNode | null;
  titleExtra?: React.ReactNode | null;
  rightExtra?: React.ReactNode | null;
  title?: React.ReactNode | null;
  className?: string;
  wrapperClassName?: string;
}

const PageContainer: FC<PageContainerProps> = ({
  children,
  titleExtra,
  rightExtra,
  title,
  className,
  wrapperClassName,
}) => {
  return (
    <div
      className={cn(
        "mediago-page-container flex h-full flex-col gap-3 p-3",
        wrapperClassName,
      )}
    >
      {title && (
        <div className="mediago-page-titlebar flex flex-col gap-2 rounded-lg bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:bg-[#1F2024]">
          <div className="flex min-w-0 flex-row gap-3">
            <div className="min-w-0 truncate text-sm text-[#343434] dark:text-white">
              {title}
            </div>
            {titleExtra && <div>{titleExtra}</div>}
          </div>
          {rightExtra && (
            <div className="mediago-page-title-actions w-full sm:w-auto">
              {rightExtra}
            </div>
          )}
        </div>
      )}

      <div
        className={cn("mediago-page-content flex-1 overflow-auto", className)}
      >
        {children}
      </div>
    </div>
  );
};

export default PageContainer;
