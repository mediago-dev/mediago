import { createServer, type Server } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertPortFree,
  reserveLoopbackPort,
  waitForPortFree,
} from "./ports.ts";

const servers: Server[] = [];

async function listen(): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => socket.end("healthy"));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test listener did not return a TCP port");
  }
  return { server, port: address.port };
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map(close));
});

describe("loopback port ownership", () => {
  test("rejects an occupied port with its owner and port", async () => {
    const { port } = await listen();

    await expect(assertPortFree("127.0.0.1", port, "Web Core")).rejects.toThrow(
      new RegExp(`Web Core.*${port}`),
    );
  });

  test("does not reuse an occupied healthy service", async () => {
    const { port } = await listen();

    await expect(
      assertPortFree("127.0.0.1", port, "healthy existing service"),
    ).rejects.toThrow(/healthy existing service/);
  });

  test("waits until an occupied port becomes free", async () => {
    const { server, port } = await listen();
    const closing = delay(50).then(() => close(server));

    await expect(
      waitForPortFree("127.0.0.1", port, 1_000),
    ).resolves.toBeUndefined();
    await closing;
  });

  test("reserves and releases an OS-assigned loopback port", async () => {
    const port = await reserveLoopbackPort();

    expect(port).toBeGreaterThan(0);
    await expect(
      assertPortFree("127.0.0.1", port, "reserved test port"),
    ).resolves.toBeUndefined();
  });
});
