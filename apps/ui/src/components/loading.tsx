import type { FC } from "react";

/**
 * Route/Suspense fallback. Deliberately a blank panel in the app background
 * color (no spinner, no white/dark box) so switching tabs / loading a route
 * chunk does NOT flash a mismatched-color box. The chunks are small and load
 * fast; a same-color blank for a few ms is imperceptible.
 */
const Loading: FC = () => {
  return <div className="size-full bg-mg-bg" />;
};

export default Loading;
