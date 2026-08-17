import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const PORT_POLL_INTERVAL_MS = 50;

async function bindAndRelease(host: string, port: number): Promise<void> {
  const server = createServer();
  server.unref();
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => reject(error);
    server.once("error", handleError);
    server.listen({ host, port, exclusive: true }, () => {
      server.off("error", handleError);
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid TCP port ${port}`);
  }
}

export async function assertPortFree(
  host: string,
  port: number,
  owner: string,
): Promise<void> {
  validatePort(port);
  try {
    await bindAndRelease(host, port);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    throw new Error(
      `${owner} requires free port ${port} on ${host}, but it is unavailable (${code})`,
      { cause: error },
    );
  }
}

export async function waitForPortFree(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  validatePort(port);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number");
  }
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (true) {
    try {
      await bindAndRelease(host, port);
      return;
    } catch (error) {
      lastError = error;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const code = (lastError as NodeJS.ErrnoException | undefined)?.code;
      throw new Error(
        `Port ${port} on ${host} did not become free within ${timeoutMs} ms${
          code ? ` (${code})` : ""
        }`,
        { cause: lastError },
      );
    }
    await delay(Math.min(PORT_POLL_INTERVAL_MS, remaining));
  }
}

export async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  server.unref();
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => reject(error);
    server.once("error", handleError);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      server.off("error", handleError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Temporary loopback listener did not provide a TCP port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}
