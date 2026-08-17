import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BrowserContext, Page, TestInfo, Video } from "@playwright/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { finalizeManualContextArtifacts } from "./artifacts.ts";
import {
  redactDiagnostic,
  startManagedProcess,
  type ManagedProcess,
} from "./process.ts";
import { reserveLoopbackPort } from "./ports.ts";

const temporaryRoots: string[] = [];
const managedProcesses: ManagedProcess[] = [];

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForFile(filePath: string): Promise<string> {
  const deadline = Date.now() + 2_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      lastError = error;
      await delay(20);
    }
  }
  throw lastError;
}

async function waitForLog(
  managedProcess: ManagedProcess,
  expected: string,
  timeoutMs = 2_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const logs = managedProcess.logTail();
    if (logs.includes(expected)) return logs;
    await delay(20);
  }
  throw new Error(`Process logs did not contain ${expected}`);
}

afterEach(async () => {
  await Promise.allSettled(
    managedProcesses.splice(0).map((item) => item.stop()),
  );
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("redactDiagnostic", () => {
  test("redacts header and proxy credentials exactly", () => {
    expect(redactDiagnostic("Cookie: abc\nhttp://u:p@proxy.invalid/x")).toBe(
      "Cookie: [REDACTED]\nhttp://[REDACTED]@proxy.invalid/x",
    );
  });

  test("removes every supported secret form", () => {
    const secrets = [
      "bearer-secret",
      "cookie-secret",
      "proxy-secret",
      "key-123",
      "key-456",
      "embedded-secret",
      "mediago-e2e-password",
    ];
    const redacted = redactDiagnostic(
      [
        "Authorization: Bearer bearer-secret",
        "Cookie=cookie-secret",
        "Proxy-Authorization: Basic proxy-secret",
        "X-API-Key: key-123",
        '{"apiKey":"key-456"}',
        "diagnostic Authorization: embedded-secret",
        "mediago-e2e-password",
      ].join("\n"),
    );

    for (const secret of secrets) expect(redacted).not.toContain(secret);
  });

  test.each([
    {
      name: "double-quoted",
      prefix: '{"apiKey":"',
      quote: '"',
      escapedQuote: '\\"',
    },
    {
      name: "single-quoted",
      prefix: "{'apiKey'='",
      quote: "'",
      escapedQuote: "\\'",
    },
  ])(
    "redacts escape-aware $name apiKey values exactly",
    ({ name, prefix, quote, escapedQuote }) => {
      const secrets = [
        `${name}-before-secret`,
        `${name}-after-escaped-quote-secret`,
        `${name}-after-escaped-backslash-secret`,
      ];
      const ordinarySuffix = `${name}-ordinary-suffix`;
      const value = `${secrets[0]}${escapedQuote}${secrets[1]}\\\\${secrets[2]}`;

      const redacted = redactDiagnostic(
        `${prefix}${value}${quote}}${ordinarySuffix}`,
      );

      expect(redacted).toBe(`${prefix}[REDACTED]${quote}}${ordinarySuffix}`);
      for (const secret of secrets) expect(redacted).not.toContain(secret);
    },
  );

  test.each([
    {
      name: "double-quoted EOF",
      prefix: '{"apiKey":"',
      escapedQuote: '\\"',
      terminator: "",
    },
    {
      name: "single-quoted EOF",
      prefix: "{'apiKey'='",
      escapedQuote: "\\'",
      terminator: "",
    },
    {
      name: "double-quoted newline",
      prefix: '{"apiKey":"',
      escapedQuote: '\\"',
      terminator: "\nsafe-next-line",
    },
    {
      name: "single-quoted newline",
      prefix: "{'apiKey'='",
      escapedQuote: "\\'",
      terminator: "\nsafe-next-line",
    },
    {
      name: "double-quoted bare CR",
      prefix: '{"apiKey":"',
      escapedQuote: '\\"',
      terminator: "\rnext-line",
    },
    {
      name: "single-quoted bare CR",
      prefix: "{'apiKey'='",
      escapedQuote: "\\'",
      terminator: "\rnext-line",
    },
  ])(
    "redacts a truncated $name apiKey value without consuming its terminator",
    ({ name, prefix, escapedQuote, terminator }) => {
      const secrets = [
        `${name}-before-secret`,
        `${name}-after-escaped-quote-secret`,
        `${name}-after-escaped-backslash-secret`,
      ];
      const value = `${secrets[0]}${escapedQuote}${secrets[1]}\\\\${secrets[2]}`;

      const redacted = redactDiagnostic(`${prefix}${value}${terminator}`);

      expect(redacted).toBe(`${prefix}[REDACTED]${terminator}`);
      for (const secret of secrets) expect(redacted).not.toContain(secret);
    },
  );
});

describe("startManagedProcess", () => {
  test("stops its detached process group within the helper deadline", async () => {
    const child = await startManagedProcess({
      label: "idle child",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
    });
    managedProcesses.push(child);

    expect(isProcessGroupAlive(child.pid)).toBe(true);
    await child.stop();
    managedProcesses.splice(managedProcesses.indexOf(child), 1);
    expect(isProcessGroupAlive(child.pid)).toBe(false);
  });

  test("keeps only a redacted 16 KiB rolling log tail", async () => {
    const child = await startManagedProcess({
      label: "chatty child",
      command: process.execPath,
      args: [
        "-e",
        'process.stdout.write("界".repeat(20_000) + "\\nAuthorization: top-secret\\n"); setInterval(() => {}, 1000)',
      ],
      cwd: process.cwd(),
    });
    managedProcesses.push(child);

    const logs = await waitForLog(child, "[REDACTED]");
    expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
    expect(logs).not.toContain("top-secret");
  });

  test.each([
    { header: "Authorization", delimiter: ":" },
    { header: "Cookie", delimiter: "=" },
    { header: "Proxy-Authorization", delimiter: ":" },
    { header: "X-API-Key", delimiter: "=" },
  ])(
    "redacts an oversized live $header header and preserves the next line",
    async ({ header, delimiter }) => {
      const secret = `${header.toLowerCase()}-oversized-secret`;
      const sentinel = `${header.toLowerCase()}-next-line-sentinel`;
      const child = await startManagedProcess({
        label: `${header} child`,
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(${JSON.stringify(`${header}${delimiter} `)} + ${JSON.stringify(secret)}.repeat(2_500) + ${JSON.stringify(`\n${sentinel}\noutput-complete\n`)}); setInterval(() => {}, 1000)`,
        ],
        cwd: process.cwd(),
      });
      managedProcesses.push(child);

      const logs = await waitForLog(child, "output-complete");
      expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
      expect(logs).toContain("[REDACTED]");
      expect(logs).toContain(sentinel);
      expect(logs).not.toContain(secret);
    },
  );

  test.each([
    {
      name: "double-quoted",
      prefix: '{"apiKey":"',
      quote: '"',
    },
    {
      name: "single-quoted",
      prefix: "{'apiKey'='",
      quote: "'",
    },
  ])(
    "redacts escaped $name apiKey values across output chunks",
    async ({ name, prefix, quote }) => {
      const secrets = [
        `${name}-chunk-before-secret`,
        `${name}-chunk-after-quote-secret`,
        `${name}-chunk-after-backslash-secret`,
      ];
      const ordinarySuffix = `${name}-chunk-ordinary-suffix`;
      const parts = [
        `${prefix}${secrets[0]}\\`,
        `${quote}${secrets[1]}\\`,
        `\\${secrets[2]}${quote}}${ordinarySuffix}\noutput-complete\n`,
      ];
      const child = await startManagedProcess({
        label: `${name} escaped api key child`,
        command: process.execPath,
        args: [
          "-e",
          `const parts = ${JSON.stringify(parts)}; let index = 0; const writer = setInterval(() => { if (index < parts.length) process.stdout.write(parts[index++]); else clearInterval(writer); }, 5); setInterval(() => {}, 1000)`,
        ],
        cwd: process.cwd(),
      });
      managedProcesses.push(child);

      const logs = await waitForLog(child, "output-complete");
      expect(logs).toContain(`${prefix}[REDACTED]${quote}}${ordinarySuffix}`);
      for (const secret of secrets) expect(logs).not.toContain(secret);
    },
  );

  test("redacts a header after arbitrarily long delimiter whitespace", async () => {
    const secret = "whitespace-header-secret";
    const child = await startManagedProcess({
      label: "spaced header child",
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write("Authorization" + " ".repeat(20 * 1024) + ": ${secret}\\noutput-complete\\n"); setInterval(() => {}, 1000)`,
      ],
      cwd: process.cwd(),
    });
    managedProcesses.push(child);

    const logs = await waitForLog(child, "output-complete");
    expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
    expect(logs).not.toContain(secret);
  });

  test.each([
    {
      name: "double-quoted",
      prefix: '{"apiKey":"',
      closingQuote: '"',
    },
    {
      name: "single-quoted",
      prefix: "{'apiKey'='",
      closingQuote: "'",
    },
  ])(
    "redacts a chunked $name apiKey value through its closing quote",
    async ({ name, prefix, closingQuote }) => {
      const secret = `${name}-api-key-secret`;
      const sentinel = `${name}-api-key-tail-sentinel`;
      const child = await startManagedProcess({
        label: `${name} api key child`,
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(${JSON.stringify(prefix)} + ${JSON.stringify(secret)}.repeat(2_500) + ${JSON.stringify(`${closingQuote}}${sentinel}\noutput-complete\n`)}); setInterval(() => {}, 1000)`,
        ],
        cwd: process.cwd(),
      });
      managedProcesses.push(child);

      const logs = await waitForLog(child, "output-complete");
      expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
      expect(logs).toContain(`${prefix}[REDACTED]${closingQuote}`);
      expect(logs).toContain(sentinel);
      expect(logs).not.toContain(secret);
    },
  );

  test("preserves a long suffix after a short quoted apiKey value", async () => {
    const secret = "short-quoted-api-key-secret";
    const sentinel = "short-quoted-api-key-tail-sentinel";
    const child = await startManagedProcess({
      label: "quoted api key suffix child",
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(${JSON.stringify(`{"apiKey":"${secret}"}`)} + "x".repeat(12 * 1024) + ${JSON.stringify(`${sentinel}\noutput-complete\n`)}); setInterval(() => {}, 1000)`,
      ],
      cwd: process.cwd(),
    });
    managedProcesses.push(child);

    const logs = await waitForLog(child, "output-complete");
    expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
    expect(logs).toContain('{"apiKey":"[REDACTED]"}');
    expect(logs).toContain(sentinel);
    expect(logs).not.toContain(secret);
  });

  test.each([
    { name: "ampersand", prefix: "apiKey=", delimiter: "&" },
    { name: "comma", prefix: "apiKey=", delimiter: "," },
    { name: "closing-brace", prefix: '{"apiKey":', delimiter: "}" },
    { name: "whitespace", prefix: "apiKey:", delimiter: " " },
    { name: "double-quote", prefix: "apiKey=", delimiter: '"' },
    { name: "single-quote", prefix: "apiKey=", delimiter: "'" },
  ])(
    "redacts a chunked unquoted apiKey through its $name delimiter",
    async ({ name, prefix, delimiter }) => {
      const secret = `${name}-unquoted-api-key-secret`;
      const sentinel = `${name}-unquoted-api-key-tail-sentinel`;
      const child = await startManagedProcess({
        label: `${name} unquoted api key child`,
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(${JSON.stringify(prefix)} + ${JSON.stringify(secret)}.repeat(2_500) + ${JSON.stringify(`${delimiter}${sentinel}\noutput-complete\n`)}); setInterval(() => {}, 1000)`,
        ],
        cwd: process.cwd(),
      });
      managedProcesses.push(child);

      const logs = await waitForLog(child, "output-complete");
      expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
      expect(logs).toContain("[REDACTED]");
      expect(logs).toContain(sentinel);
      expect(logs).not.toContain(secret);
    },
  );

  test.each(["http", "https"])(
    "redacts chunked %s proxy userinfo and preserves its host and path",
    async (scheme) => {
      const secret = `${scheme}-proxy-userinfo-secret`;
      const sentinel = `${scheme}-proxy-tail-sentinel`;
      const preservedSuffix = `@proxy.invalid/path?marker=${sentinel}`;
      const child = await startManagedProcess({
        label: `${scheme} proxy child`,
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(${JSON.stringify(`${scheme}://`)} + ${JSON.stringify(secret)}.repeat(2_500) + ${JSON.stringify(`${preservedSuffix}\noutput-complete\n`)}); setInterval(() => {}, 1000)`,
        ],
        cwd: process.cwd(),
      });
      managedProcesses.push(child);

      const logs = await waitForLog(child, "output-complete");
      expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
      expect(logs).toContain(`[REDACTED]${preservedSuffix}`);
      expect(logs).not.toContain(secret);
    },
  );

  test("preserves a maximum-length hostname and port without buffering beyond it", async () => {
    const hostname = [63, 63, 63, 61]
      .map((length) => "h".repeat(length))
      .join(".");
    const sentinel = "maximum-hostname-tail-sentinel";
    const expectedURL = `http://${hostname}:65535/path?marker=${sentinel}`;
    const child = await startManagedProcess({
      label: "maximum hostname child",
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(${JSON.stringify(`${expectedURL}\noutput-complete\n`)}); setInterval(() => {}, 1000)`,
      ],
      cwd: process.cwd(),
    });
    managedProcesses.push(child);

    const logs = await waitForLog(child, "output-complete");
    expect(logs).toContain(expectedURL);
    expect(logs).not.toContain("<potential proxy credentials omitted>");
  });

  test("redacts a fixed token and retains its long same-line suffix", async () => {
    const sentinel = "fixed-token-tail-sentinel";
    const syntheticPassword = "mediago-e2e-password";
    const child = await startManagedProcess({
      label: "fixed token child",
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(${JSON.stringify(syntheticPassword)} + "x".repeat(12 * 1024) + ${JSON.stringify(sentinel)} + "\\noutput-complete\\n"); setInterval(() => {}, 1000)`,
      ],
      cwd: process.cwd(),
    });
    managedProcesses.push(child);

    const logs = await waitForLog(child, "output-complete");
    expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
    expect(logs).toContain("[REDACTED]");
    expect(logs).toContain(sentinel);
    expect(logs).not.toContain(syntheticPassword);
  });

  test("retains the actual bounded tail of a long ordinary line", async () => {
    const sentinel = "ordinary-line-tail-sentinel";
    const child = await startManagedProcess({
      label: "long ordinary line child",
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write("x".repeat(40 * 1024) + ${JSON.stringify(sentinel)} + "\\nwrite-complete\\n"); setInterval(() => {}, 1000)`,
      ],
      cwd: process.cwd(),
    });
    managedProcesses.push(child);

    const logs = await waitForLog(child, "write-complete");
    expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
    expect(logs).toContain(sentinel);
  });

  test("retains a 1 MiB ordinary-output sentinel without stalling the harness", async () => {
    const sentinel = "one-mebibyte-output-tail-sentinel";
    const startedAt = Date.now();
    const child = await startManagedProcess({
      label: "one mebibyte child",
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write("x".repeat(1024 * 1024) + ${JSON.stringify(`${sentinel}\noutput-complete\n`)}); setInterval(() => {}, 1000)`,
      ],
      cwd: process.cwd(),
    });
    managedProcesses.push(child);

    const logs = await waitForLog(child, "output-complete", 15_000);
    expect(logs).toContain(sentinel);
    expect(Buffer.byteLength(logs)).toBeLessThanOrEqual(16 * 1024);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  }, 20_000);

  test("bounds and redacts a synchronous spawn exception", async () => {
    const label = "invalid command child";
    const syntheticPassword = "mediago-e2e-password";
    let rejection: unknown;
    try {
      await startManagedProcess({
        label,
        command: `\0${syntheticPassword}`,
        args: [],
        cwd: process.cwd(),
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(Error);
    const message = (rejection as Error).message;
    expect(message).toContain(label);
    expect(message).not.toContain(syntheticPassword);
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(16 * 1024);
  });

  test("rejects an immediate exit without readiness after its group is gone", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "mediago-process-exit-test-"),
    );
    temporaryRoots.push(root);
    const pidPath = path.join(root, "pid");

    await expect(
      startManagedProcess({
        label: "immediate exit child",
        command: process.execPath,
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); process.exit(7)`,
        ],
        cwd: process.cwd(),
      }),
    ).rejects.toThrow(/immediate exit child.*exit code 7/i);

    const pid = Number(await waitForFile(pidPath));
    expect(isProcessGroupAlive(pid)).toBe(false);
  });

  test("reports an exit before readiness without waiting for the deadline", async () => {
    const port = await reserveLoopbackPort();
    const startedAt = Date.now();

    await expect(
      startManagedProcess({
        label: "early exit child",
        command: process.execPath,
        args: ["-e", 'process.stderr.write("left early"); process.exit(7)'],
        cwd: process.cwd(),
        readinessURL: `http://127.0.0.1:${port}/never`,
        startupTimeoutMs: 5_000,
      }),
    ).rejects.toThrow(/early exit child.*exit|exit.*early exit child/i);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test("cleans up a never-ready process group before rejecting", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mediago-process-test-"));
    temporaryRoots.push(root);
    const pidPath = path.join(root, "pid");
    const port = await reserveLoopbackPort();

    await expect(
      startManagedProcess({
        label: "never ready child",
        command: process.execPath,
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000)`,
        ],
        cwd: process.cwd(),
        readinessURL: `http://127.0.0.1:${port}/never`,
        startupTimeoutMs: 100,
      }),
    ).rejects.toThrow(/never ready child.*100 ms|100 ms.*never ready child/i);

    const pid = Number(await waitForFile(pidPath));
    expect(isProcessGroupAlive(pid)).toBe(false);
  });
});

describe("manual context failure artifacts", () => {
  test("uses exact isolated filenames and finalizes before close and video save", async () => {
    const calls: string[] = [];
    const outputPath = vi.fn((...segments: string[]) =>
      path.join("/tmp/mediago-artifacts", ...segments),
    );
    const attach = vi.fn(
      async (name: string, options?: { path?: string }): Promise<void> => {
        calls.push(`attach:${name}:${path.basename(options?.path ?? "")}`);
      },
    );
    const video = {
      saveAs: vi.fn(async (filePath: string) => {
        calls.push(`video:${path.basename(filePath)}`);
      }),
      delete: vi.fn(async () => undefined),
      path: vi.fn(async () => ""),
    } as unknown as Video;
    const page = {
      screenshot: vi.fn(async ({ path: filePath }: { path: string }) => {
        calls.push(`screenshot:${path.basename(filePath)}`);
      }),
      video: () => video,
    } as unknown as Page;
    const context = {
      tracing: {
        stop: vi.fn(async (options?: { path?: string }) => {
          calls.push(`trace:${path.basename(options?.path ?? "<none>")}`);
        }),
      },
      pages: () => [page],
    } as unknown as BrowserContext;
    const testInfo = { outputPath, attach } as unknown as TestInfo;

    await finalizeManualContextArtifacts({
      testInfo,
      context,
      page,
      close: async () => {
        calls.push("close");
      },
      failed: true,
      name: "electron",
    });

    expect(outputPath).toHaveBeenCalledWith("failure.png");
    expect(outputPath).toHaveBeenCalledWith("trace.zip");
    expect(outputPath).not.toHaveBeenCalledWith("electron-failure.png");
    expect(outputPath).not.toHaveBeenCalledWith("electron-trace.zip");
    expect(attach.mock.calls.map(([name]) => name)).toEqual([
      "failure.png",
      "trace.zip",
      "electron-video-1.webm",
    ]);
    expect(calls).toEqual([
      "screenshot:failure.png",
      "trace:trace.zip",
      "close",
      "video:electron-video-1.webm",
      "attach:failure.png:failure.png",
      "attach:trace.zip:trace.zip",
      "attach:electron-video-1.webm:electron-video-1.webm",
    ]);
  });
});
