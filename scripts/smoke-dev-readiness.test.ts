import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { assertPortFree } from "./smoke-dev-all.ts";
import {
  CORE_MARKER,
  PROCESSES_MARKER,
  RUNTIME_MARKER,
  StartupObservation,
  probeMediaGoHTTP,
  waitForReadiness,
} from "./smoke-dev-readiness.ts";

const servers: Server[] = [];
const sockets = new Set<Socket>();
const neverCloses = new Promise<never>(() => {});

async function serve(body: string, contentType = "text/html"): Promise<number> {
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.end(
      `HTTP/1.1 200 OK\r\nContent-Type: ${contentType}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  return address.port;
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("dev readiness observation", () => {
  test("recognizes ordered markers split across chunks", () => {
    const observation = new StartupObservation();
    observation.append("MEDIAGO_RUNTIME_");
    observation.append("READY /tmp/deps\nMEDIAGO_DEV_PROCESSES_");
    observation.append("STARTING\nGo Core start");
    observation.append("ed at http://127.0.0.1:9900");

    expect(observation.markersReady).toBe(true);
    expect(observation.invalidMarkerOrder).toBe(false);
  });

  test("records a process marker that precedes runtime readiness", () => {
    const observation = new StartupObservation();
    observation.append(`${PROCESSES_MARKER}\n${RUNTIME_MARKER}`);
    expect(observation.invalidMarkerOrder).toBe(true);
  });

  test("reports child failure before probing ports", async () => {
    const observation = new StartupObservation();
    observation.append(
      `${RUNTIME_MARKER}\n${PROCESSES_MARKER}\n${CORE_MARKER}`,
    );
    let probes = 0;
    await expect(
      waitForReadiness(
        observation,
        Promise.resolve({ code: 2, signal: null }),
        () => ({ code: 2, signal: null }),
        { probe: async () => (probes += 1) > 0 },
      ),
    ).rejects.toThrow(/code 2/i);
    expect(probes).toBe(0);
  });
});

describe("MediaGo HTTP readiness", () => {
  test("rejects an unrelated HTML 200 and wrong content type", async () => {
    const other = await serve("<html><title>Other</title></html>");
    const wrongType = await serve("<title>MediaGo</title>", "text/plain");
    expect(await probeMediaGoHTTP(other, 500)).toBe(false);
    expect(await probeMediaGoHTTP(wrongType, 500)).toBe(false);
  });

  test("accepts MediaGo HTML", async () => {
    const port = await serve("<html><title>MediaGo</title></html>");
    expect(await probeMediaGoHTTP(port, 500)).toBe(true);
  });

  test("requires both UI ports to be ready in the same probe round", async () => {
    const observation = new StartupObservation();
    observation.append(
      `${RUNTIME_MARKER}\n${PROCESSES_MARKER}\n${CORE_MARKER}`,
    );
    const rounds = [
      new Map([
        [8500, true],
        [8501, false],
      ]),
      new Map([
        [8500, false],
        [8501, true],
      ]),
      new Map([
        [8500, true],
        [8501, true],
      ]),
    ];
    const calls: number[] = [];
    let now = 0;
    await waitForReadiness(observation, neverCloses, () => undefined, {
      now: () => now,
      wait: async (milliseconds) => {
        now += milliseconds;
      },
      probe: async (port) => {
        const round = Math.floor(calls.length / 2);
        calls.push(port);
        return rounds[round]?.get(port) ?? false;
      },
      deadlineMs: 1_000,
    });

    expect(calls).toEqual([8500, 8501, 8500, 8501, 8500, 8501]);
  });

  test("caps each same-round probe by the remaining total deadline", async () => {
    const observation = new StartupObservation();
    observation.append(
      `${RUNTIME_MARKER}\n${PROCESSES_MARKER}\n${CORE_MARKER}`,
    );
    let now = 0;
    const timeouts: number[] = [];
    await expect(
      waitForReadiness(observation, neverCloses, () => undefined, {
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
        },
        probe: async (_port, timeoutMs) => {
          timeouts.push(timeoutMs);
          now += timeoutMs;
          return false;
        },
        deadlineMs: 600,
      }),
    ).rejects.toThrow(/timed out/i);

    expect(timeouts[0]).toBe(500);
    expect(timeouts.every((timeout) => timeout <= 500)).toBe(true);
    expect(now).toBeLessThanOrEqual(1_100);
  });

  test("refuses an occupied port without terminating its owner", async () => {
    const port = await serve("<title>owner</title>");
    await expect(assertPortFree(port)).rejects.toThrow(/unavailable/i);
    expect(servers[0]?.listening).toBe(true);
  });
});
