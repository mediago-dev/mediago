import { setTimeout as wait } from "node:timers/promises";
import {
  BoundedRedactedLog,
  type CommandResult,
} from "./migration-verification-safety.ts";

export const RUNTIME_MARKER = "MEDIAGO_RUNTIME_READY";
export const PROCESSES_MARKER = "MEDIAGO_DEV_PROCESSES_STARTING";
export const CORE_MARKER = "Go Core started at";
const MARKER_CARRY_LENGTH = Math.max(
  RUNTIME_MARKER.length,
  PROCESSES_MARKER.length,
  CORE_MARKER.length,
);
const UI_PORTS = [8500, 8501] as const;
const LOOPBACK_HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 120_000;
const RESPONSE_PREFIX_BYTES = 32 * 1024;

export class StartupObservation {
  runtimeReady = false;
  processesStarting = false;
  coreStarted = false;
  invalidMarkerOrder = false;
  private markerCarry = "";
  private readonly logs = new BoundedRedactedLog();

  get markersReady(): boolean {
    return this.runtimeReady && this.processesStarting && this.coreStarted;
  }

  append(chunk: unknown): void {
    const value = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    this.logs.append(value);
    const combined = this.markerCarry + value;
    this.observeMarkers(combined);
    this.markerCarry = combined.slice(-MARKER_CARRY_LENGTH);
  }

  diagnostic(limit?: number): string {
    return this.logs.diagnostic(limit);
  }

  private observeMarkers(value: string): void {
    if (!this.runtimeReady) {
      const runtimeIndex = value.indexOf(RUNTIME_MARKER);
      const processesIndex = value.indexOf(PROCESSES_MARKER);
      if (
        processesIndex !== -1 &&
        (runtimeIndex === -1 || processesIndex < runtimeIndex)
      ) {
        this.invalidMarkerOrder = true;
      }
      if (runtimeIndex !== -1) {
        this.runtimeReady = true;
        if (processesIndex > runtimeIndex) this.processesStarting = true;
      }
    } else if (!this.processesStarting && value.includes(PROCESSES_MARKER)) {
      this.processesStarting = true;
    }
    if (!this.coreStarted && value.includes(CORE_MARKER)) {
      this.coreStarted = true;
    }
  }
}

async function responsePrefix(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let result = "";
  try {
    while (bytesRead < RESPONSE_PREFIX_BYTES) {
      // oxlint-disable-next-line no-await-in-loop -- The response prefix is read sequentially under one abort deadline.
      const next = await reader.read();
      if (next.done) {
        result += decoder.decode();
        break;
      }
      const remaining = RESPONSE_PREFIX_BYTES - bytesRead;
      const value = next.value.subarray(0, remaining);
      bytesRead += value.byteLength;
      result += decoder.decode(value, {
        stream: bytesRead < RESPONSE_PREFIX_BYTES,
      });
      if (value.byteLength < next.value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return result;
}

export async function probeMediaGoHTTP(
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  if (timeoutMs <= 0) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    const response = await fetch(`http://${LOOPBACK_HOST}:${port}/`, {
      signal: controller.signal,
    });
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.includes("text/html")) {
      await response.body?.cancel();
      return false;
    }
    const body = await responsePrefix(response);
    return /<title>\s*MediaGo\s*<\/title>/i.test(body);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function formatExit(exit: CommandResult): string {
  if (exit.spawnError) return `spawn failed: ${exit.spawnError.message}`;
  return exit.code === null
    ? `terminated by ${exit.signal ?? "an unknown signal"}`
    : `exited with code ${exit.code}`;
}

export async function waitForReadiness(
  observation: StartupObservation,
  closePromise: Promise<CommandResult>,
  readExitState: () => CommandResult | undefined,
  options: {
    now?: () => number;
    wait?: (milliseconds: number) => Promise<void>;
    probe?: (port: number, timeoutMs: number) => Promise<boolean>;
    deadlineMs?: number;
  } = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const pause = options.wait ?? ((milliseconds) => wait(milliseconds));
  const probe = options.probe ?? probeMediaGoHTTP;
  const timeoutMs = options.deadlineMs ?? STARTUP_TIMEOUT_MS;
  const deadline = now() + timeoutMs;
  const childExited = closePromise.then((exit) => ({
    kind: "exit" as const,
    exit,
  }));

  while (now() < deadline) {
    if (observation.invalidMarkerOrder) {
      throw new Error(
        "dev:all printed its process marker before runtime readiness",
      );
    }
    const exit = readExitState();
    if (exit) throw new Error(`dev:all ${formatExit(exit)} before readiness`);

    let remaining = deadline - now();
    if (observation.markersReady && remaining > 0) {
      const probeTimeout = Math.min(500, remaining);
      // oxlint-disable-next-line no-await-in-loop -- Every readiness round must revalidate both ports together.
      const round = await Promise.race([
        Promise.all(UI_PORTS.map((port) => probe(port, probeTimeout))).then(
          (ready) => ({ kind: "probes" as const, ready }),
        ),
        childExited,
      ]);
      if (round.kind === "exit") {
        throw new Error(`dev:all ${formatExit(round.exit)} before readiness`);
      }
      // oxlint-disable-next-line no-await-in-loop -- Drain close-state microtasks at the probe/exit boundary before declaring readiness.
      await Promise.resolve();
      const exitAfterProbes = readExitState();
      if (exitAfterProbes) {
        throw new Error(
          `dev:all ${formatExit(exitAfterProbes)} before readiness`,
        );
      }
      if (round.ready.every(Boolean)) return;
    }

    remaining = deadline - now();
    if (remaining <= 0) break;
    // oxlint-disable-next-line no-await-in-loop -- Sequential rounds share one bounded startup deadline.
    await Promise.race([pause(Math.min(100, remaining)), closePromise]);
  }

  const missing = [
    !observation.runtimeReady && RUNTIME_MARKER,
    !observation.processesStarting && PROCESSES_MARKER,
    !observation.coreStarted && CORE_MARKER,
    observation.markersReady && "MediaGo HTTP 8500+8501 in one round",
  ].filter(Boolean);
  throw new Error(
    `dev:all readiness timed out after ${timeoutMs} ms; missing: ${missing.join(", ")}`,
  );
}
