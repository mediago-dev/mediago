export class AdBlockerLoader<T> {
  private loadPromise: Promise<T | undefined> | null = null;

  constructor(
    private readonly factory: () => Promise<T | undefined>,
    private readonly onError: (error: unknown) => void,
  ) {}

  load(): Promise<T | undefined> {
    if (!this.loadPromise) {
      const loadPromise = Promise.resolve()
        .then(this.factory)
        .then((value) => {
          if (value === undefined && this.loadPromise === loadPromise) {
            this.loadPromise = null;
          }
          return value;
        })
        .catch((error: unknown): undefined => {
          try {
            this.onError(error);
          } catch {
            // Error reporting must not escape the loader.
          }
          if (this.loadPromise === loadPromise) {
            this.loadPromise = null;
          }
          return undefined;
        });
      this.loadPromise = loadPromise;
    }

    return this.loadPromise;
  }

  replace(value: T): void {
    this.loadPromise = Promise.resolve(value);
  }

  invalidate(): void {
    this.loadPromise = null;
  }
}
