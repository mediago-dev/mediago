import type { FC } from "react";
import { AppBootScreen } from "./components/app-boot-screen";
import { Toaster } from "./components/ui/sonner";
import { useAdapterBootstrap } from "./hooks/use-adapter-bootstrap";
import { useAppTheme } from "./hooks/use-app-theme";
import { AuthGuard } from "./hooks/use-auth";
import { useDesktopEvents } from "./hooks/use-desktop-events";
import { useDownloadEvents } from "./hooks/use-download-events";
import { AppRoutes } from "./routes/app-routes";

const App: FC = () => {
  const adapterReady = useAdapterBootstrap();
  const theme = useAppTheme();

  useDesktopEvents();
  useDownloadEvents();

  if (!adapterReady) return <AppBootScreen />;

  return (
    <>
      <div className="size-full overflow-hidden">
        <AuthGuard />
        <AppRoutes />
      </div>
      <Toaster theme={theme} richColors position="top-center" duration={2400} />
    </>
  );
};

export default App;
