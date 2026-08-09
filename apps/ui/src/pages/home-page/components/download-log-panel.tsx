import { DownloadStatus } from "@mediago/shared-common";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDownloadLog } from "@/api/download-task";
import type { DownloadTaskDetails } from "@/hooks/use-tasks";

/**
 * Collapsible terminal-styled log panel (design lines 145-156).
 * Tails the active (downloading) task's real log via getDownloadLog.
 */
export function DownloadLogPanel({ tasks }: { tasks: DownloadTaskDetails[] }) {
  const { t } = useTranslation();
  const active =
    tasks.find((x) => x.status === DownloadStatus.Downloading) ?? tasks[0];
  const activeId = active?.id;
  const [log, setLog] = useState("");

  useEffect(() => {
    if (activeId === null || activeId === undefined) {
      setLog("");
      return;
    }
    let alive = true;
    const fetchLog = async () => {
      try {
        const res = await getDownloadLog(activeId);
        if (alive) setLog(res?.log || "");
      } catch {
        // ignore
      }
    };
    fetchLog();
    const id = setInterval(fetchLog, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [activeId]);

  const lines = log ? log.split("\n").slice(-200) : [];

  return (
    <div className="mb-4 overflow-hidden rounded-[14px] border border-[#1f1f2e] bg-[#0c0c14] font-mono [animation:mgfade_.2s_ease]">
      <div className="flex items-center gap-[7px] border-b border-[#1f1f2e] bg-[#13131e] px-[14px] py-[9px]">
        <span className="size-[11px] rounded-full bg-[#ff5f57]" />
        <span className="size-[11px] rounded-full bg-[#febc2e]" />
        <span className="size-[11px] rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[11.5px] text-[#8a8aa0]">
          mediago · download.log
        </span>
      </div>
      <div className="max-h-[180px] overflow-auto px-4 py-3.5 text-[12px] leading-[1.8] text-[#a9b7c6]">
        {lines.length === 0 ? (
          <div className="text-[#5b6b7c]">{t("noData")}</div>
        ) : (
          lines.map((ln, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {ln}
            </div>
          ))
        )}
        <div className="text-[#5b6b7c]">
          ▍
          <span className="ml-px inline-block h-[13px] w-[7px] translate-y-[2px] bg-[#34d399] [animation:mgblink_1s_step-end_infinite]" />
        </div>
      </div>
    </div>
  );
}
