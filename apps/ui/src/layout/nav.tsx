import {
  AppWindow,
  ArrowDownUp,
  CircleCheckBig,
  Download,
  type LucideIcon,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { isWeb } from "@/utils";

export interface NavItem {
  key: string;
  to: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  /** Hidden in the web/server build (electron-only feature). */
  webHidden?: boolean;
  /** Show the download-count badge. */
  showCount?: boolean;
}

/** Shared nav definition for the sidebar and the mobile bottom nav. */
export function useNavItems(): NavItem[] {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const items: NavItem[] = [
    {
      key: "home",
      to: "/",
      label: t("downloadList"),
      Icon: Download,
      active: pathname === "/",
      showCount: true,
    },
    {
      key: "done",
      to: "/done",
      label: t("downloadComplete"),
      Icon: CircleCheckBig,
      active: pathname === "/done",
    },
    {
      key: "source",
      to: "/source",
      label: t("materialExtraction"),
      Icon: AppWindow,
      active: pathname === "/source",
      webHidden: true,
    },
    {
      key: "converter",
      to: "/converter",
      label: t("converter"),
      Icon: ArrowDownUp,
      active: pathname === "/converter",
      webHidden: true,
    },
    {
      key: "settings",
      to: "/settings",
      label: t("setting"),
      Icon: Settings,
      active: pathname === "/settings",
    },
  ];

  return items.filter((i) => (isWeb ? !i.webHidden : true));
}
