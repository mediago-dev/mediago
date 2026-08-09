import { useEffect, useState } from "react";

/**
 * Responsive breakpoints from the source design (MediaGo.dc.html `bp()`):
 *   mobile  < 720px   — no sidebar; top bar + bottom nav + FAB
 *   tablet  < 1080px  — icon-only sidebar rail (74px)
 *   desktop >= 1080px — full sidebar (244px), collapsible to rail
 */
export type Breakpoint = "mobile" | "tablet" | "desktop";

export const MG_TABLET = 720;
export const MG_DESKTOP = 1080;

function resolve(width: number): Breakpoint {
  if (width < MG_TABLET) return "mobile";
  if (width < MG_DESKTOP) return "tablet";
  return "desktop";
}

export interface BreakpointState {
  width: number;
  bp: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

export function useBreakpoint(): BreakpointState {
  const [width, setWidth] = useState<number>(() =>
    typeof window === "undefined" ? MG_DESKTOP + 200 : window.innerWidth,
  );

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const bp = resolve(width);
  return {
    width,
    bp,
    isMobile: bp === "mobile",
    isTablet: bp === "tablet",
    isDesktop: bp === "desktop",
  };
}
