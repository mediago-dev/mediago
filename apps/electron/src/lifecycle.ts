interface BeforeQuitEvent {
  preventDefault(): void;
}

interface GracefulQuitApp {
  on(event: "before-quit", listener: (event: BeforeQuitEvent) => void): unknown;
  quit(): void;
}

export function registerGracefulQuit(
  app: GracefulQuitApp,
  shutdown: () => Promise<void>,
  onError: (error: unknown) => void,
): void {
  let stopping = false;
  let quitting = false;

  app.on("before-quit", (event) => {
    if (quitting) return;

    event.preventDefault();
    if (stopping) return;

    stopping = true;
    void Promise.resolve()
      .then(shutdown)
      .catch((error) => onError(error))
      .finally(() => {
        quitting = true;
        app.quit();
      });
  });
}
