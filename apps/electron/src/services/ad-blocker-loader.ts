export class AdBlockerLoader<T> {
  private loadPromise: Promise<T | undefined> | null = null;

  constructor(
    private readonly factory: () => Promise<T>,
    private readonly onError: (error: unknown) => void,
  ) {}

  load(): Promise<T | undefined> {
    if (!this.loadPromise) {
      this.loadPromise = Promise.resolve()
        .then(this.factory)
        .catch((error: unknown) => {
          try {
            this.onError(error);
          } catch {
            // Error reporting must not escape the loader.
          }
          return undefined;
        });
    }

    return this.loadPromise;
  }
}
