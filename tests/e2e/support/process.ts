import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";

const LOG_TAIL_BYTES = 16 * 1024;
const SECRET_SCAN_OVERLAP_CHARACTERS = 64;
const STARTUP_DIAGNOSTIC_BYTES = 4 * 1024;
const READINESS_INTERVAL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const TERM_TIMEOUT_MS = 3_000;
const KILL_TIMEOUT_MS = 2_000;
const NO_READINESS_EXIT_DEADLINE_MS = 100;
const WITHHELD_PROXY_MESSAGE = "<potential proxy credentials omitted>";
const FIXED_SYNTHETIC_PASSWORD = "mediago-e2e-password";
const MAX_HOSTNAME_CHARACTERS = 253;
const MAX_PORT_SUFFIX_CHARACTERS = 6;
const MAX_UNRESOLVED_AUTHORITY_CHARACTERS =
  MAX_HOSTNAME_CHARACTERS + MAX_PORT_SUFFIX_CHARACTERS;
const STRUCTURED_SECRET_TOKEN_PATTERN =
  /\b(?:proxy-authorization|authorization|cookie|x-api-key)\b|apiKey|https?:\/\//i;

export interface ManagedProcess {
  readonly pid: number;
  logTail(): string;
  stop(): Promise<void>;
}

interface ExitState {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface ReadinessResult {
  ready: boolean;
  detail: string;
}

interface NormalToken {
  index: number;
  value: string;
}

export function redactDiagnostic(value: string): string {
  return value
    .replace(
      /(\b(?:authorization|proxy-authorization|cookie|x-api-key)\s*[:=]\s*)[^\r\n]*/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(["']?apiKey["']?\s*[:=]\s*)(["'])((?:\\[^\r\n]|(?!\2)[^\\\r\n])*)(\2)/gi,
      "$1$2[REDACTED]$4",
    )
    .replace(
      /(["']?apiKey["']?\s*[:=]\s*)(["'])((?:\\[^\r\n]|\\(?=\r|\n|$)|(?!\2)[^\\\r\n])*)(?=\r|\n|$)/gi,
      "$1$2[REDACTED]",
    )
    .replace(/(["']?apiKey["']?\s*[:=]\s*)[^\s&,}"'\r\n]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
    .replaceAll("mediago-e2e-password", "[REDACTED]");
}

function boundedDiagnostic(
  value: string,
  limit = STARTUP_DIAGNOSTIC_BYTES,
): string {
  return utf8Tail(redactDiagnostic(value), limit);
}

function utf8Tail(value: string, limit: number): string {
  const contents = Buffer.from(value, "utf8");
  let result = contents
    .subarray(Math.max(0, contents.length - limit))
    .toString("utf8");
  while (Buffer.byteLength(result) > limit) result = result.slice(1);
  return result;
}

class RedactedRollingTail {
  private contents = "";

  append(value: string): void {
    this.contents = utf8Tail(
      this.contents + redactDiagnostic(value),
      LOG_TAIL_BYTES,
    );
  }

  snapshot(pending: readonly string[] = []): string {
    return boundedDiagnostic(
      this.contents + pending.map((value) => redactDiagnostic(value)).join(""),
      LOG_TAIL_BYTES,
    );
  }
}

type DiagnosticState =
  | { kind: "normal" }
  | { kind: "header-delimiter" }
  | { kind: "header-value-leading" }
  | { kind: "header-value" }
  | { kind: "api-key-delimiter"; acceptedClosingQuote: boolean }
  | { kind: "api-key-value-leading" }
  | { kind: "api-key-quoted-value"; quote: string; escaped: boolean }
  | { kind: "api-key-unquoted-value" }
  | { kind: "proxy-authority"; value: string }
  | { kind: "proxy-userinfo" };

class DiagnosticStream {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private sanitizedOutput = "";
  private state: DiagnosticState = { kind: "normal" };
  private ended = false;

  constructor(private readonly tail: RedactedRollingTail) {}

  append(chunk: unknown): void {
    if (this.ended) return;
    const decoded = Buffer.isBuffer(chunk)
      ? this.decoder.write(chunk)
      : String(chunk);
    this.consume(decoded);
    this.flushSanitizedOutput();
  }

  end(): void {
    if (this.ended) return;
    this.consume(this.decoder.end());
    if (this.state.kind === "normal") {
      this.flushNormal(true);
    } else if (this.state.kind === "header-value-leading") {
      this.emit("[REDACTED]");
    } else if (this.state.kind === "proxy-authority") {
      this.emit(this.state.value);
    }
    this.flushSanitizedOutput();
    this.ended = true;
  }

  snapshot(): string {
    if (this.state.kind === "normal") {
      return `${this.sanitizedOutput}${this.pending}`;
    }
    if (this.state.kind === "proxy-authority") {
      return `${this.sanitizedOutput}${WITHHELD_PROXY_MESSAGE}`;
    }
    return this.sanitizedOutput;
  }

  private consume(value: string): void {
    let offset = 0;
    while (offset < value.length) {
      if (this.state.kind === "normal") {
        offset += this.consumeNormalSpan(value.slice(offset));
        continue;
      }
      const codePoint = value.codePointAt(offset);
      if (codePoint === undefined) return;
      const character = String.fromCodePoint(codePoint);
      offset += character.length;
      this.consumeCharacter(character);
    }
  }

  private consumeCharacter(character: string): void {
    switch (this.state.kind) {
      case "normal":
        this.consumeNormalSpan(character);
        return;
      case "header-delimiter":
        this.consumeHeaderDelimiter(character);
        return;
      case "header-value-leading":
        this.consumeHeaderValueLeading(character);
        return;
      case "header-value":
        if (character === "\n") {
          this.emit(character);
          this.state = { kind: "normal" };
        }
        return;
      case "api-key-delimiter":
        this.consumeApiKeyDelimiter(character, this.state.acceptedClosingQuote);
        return;
      case "api-key-value-leading":
        this.consumeApiKeyValueLeading(character);
        return;
      case "api-key-quoted-value":
        if (this.state.escaped) {
          this.state = {
            kind: "api-key-quoted-value",
            quote: this.state.quote,
            escaped: false,
          };
        } else if (character === "\\") {
          this.state = {
            kind: "api-key-quoted-value",
            quote: this.state.quote,
            escaped: true,
          };
        } else if (character === this.state.quote) {
          this.emit(character);
          this.state = { kind: "normal" };
        } else if (character === "\n") {
          this.emit(character);
        }
        return;
      case "api-key-unquoted-value":
        if (isUnquotedApiKeyDelimiter(character)) {
          this.emit(character);
          this.state = { kind: "normal" };
        }
        return;
      case "proxy-authority":
        this.consumeProxyAuthority(character, this.state.value);
        return;
      case "proxy-userinfo":
        this.consumeProxyUserinfo(character);
        return;
    }
  }

  private consumeNormalSpan(value: string): number {
    const combined = this.pending + value;
    const token = findNormalToken(combined);
    if (token) {
      this.emit(combined.slice(0, token.index));
      const tokenEnd = token.index + token.value.length;
      const consumed = tokenEnd - this.pending.length;
      this.pending = "";
      this.beginToken(token.value);
      return consumed;
    }

    const safeCharacters = Math.max(
      0,
      combined.length - SECRET_SCAN_OVERLAP_CHARACTERS,
    );
    this.emit(combined.slice(0, safeCharacters));
    this.pending = combined.slice(safeCharacters);
    return value.length;
  }

  private flushNormal(final: boolean): void {
    const token = findNormalToken(this.pending);
    if (token) {
      this.emit(this.pending.slice(0, token.index));
      const remainder = this.pending.slice(token.index + token.value.length);
      this.pending = "";
      this.beginToken(token.value);
      this.consume(remainder);
      return;
    }

    const retainedCharacters = final ? 0 : SECRET_SCAN_OVERLAP_CHARACTERS;
    const safeCharacters = this.pending.length - retainedCharacters;
    if (safeCharacters > 0) {
      this.emit(this.pending.slice(0, safeCharacters));
      this.pending = this.pending.slice(safeCharacters);
    }
  }

  private emit(value: string): void {
    this.sanitizedOutput += value;
  }

  private flushSanitizedOutput(): void {
    if (this.sanitizedOutput.length === 0) return;
    this.tail.append(this.sanitizedOutput);
    this.sanitizedOutput = "";
  }

  private beginToken(token: string): void {
    const normalized = token.toLowerCase();
    if (token === FIXED_SYNTHETIC_PASSWORD) {
      this.emit("[REDACTED]");
      return;
    }
    if (normalized === "http://" || normalized === "https://") {
      this.emit(token);
      this.state = { kind: "proxy-authority", value: "" };
      return;
    }

    this.emit(token);
    this.state =
      normalized === "apikey"
        ? { kind: "api-key-delimiter", acceptedClosingQuote: false }
        : { kind: "header-delimiter" };
  }

  private consumeHeaderDelimiter(character: string): void {
    if (isHorizontalWhitespace(character)) {
      this.emit(character);
      return;
    }
    if (character === ":" || character === "=") {
      this.emit(character);
      this.state = { kind: "header-value-leading" };
      return;
    }
    if (character === "\r" || character === "\n") {
      this.emit(character);
      this.state = { kind: "normal" };
      return;
    }

    this.state = { kind: "normal" };
    this.consumeCharacter(character);
  }

  private consumeHeaderValueLeading(character: string): void {
    if (isHorizontalWhitespace(character)) {
      this.emit(character);
      return;
    }

    this.emit("[REDACTED]");
    if (character === "\n") {
      this.emit(character);
      this.state = { kind: "normal" };
    } else {
      this.state = { kind: "header-value" };
    }
  }

  private consumeApiKeyDelimiter(
    character: string,
    acceptedClosingQuote: boolean,
  ): void {
    if (!acceptedClosingQuote && (character === '"' || character === "'")) {
      this.emit(character);
      this.state = { kind: "api-key-delimiter", acceptedClosingQuote: true };
      return;
    }
    if (isHorizontalWhitespace(character)) {
      this.emit(character);
      return;
    }
    if (character === ":" || character === "=") {
      this.emit(character);
      this.state = { kind: "api-key-value-leading" };
      return;
    }
    if (character === "\r" || character === "\n") {
      this.emit(character);
      this.state = { kind: "normal" };
      return;
    }

    this.state = { kind: "normal" };
    this.consumeCharacter(character);
  }

  private consumeApiKeyValueLeading(character: string): void {
    if (isHorizontalWhitespace(character)) {
      this.emit(character);
      return;
    }
    if (character === "\r" || character === "\n") {
      this.emit(character);
      this.state = { kind: "normal" };
      return;
    }

    if (character === "&" || character === "," || character === "}") {
      this.emit(character);
      this.state = { kind: "normal" };
      return;
    }

    if (character === '"' || character === "'") {
      this.emit(`${character}[REDACTED]`);
      this.state = {
        kind: "api-key-quoted-value",
        quote: character,
        escaped: false,
      };
    } else {
      this.emit("[REDACTED]");
      this.state = { kind: "api-key-unquoted-value" };
    }
  }

  private consumeProxyAuthority(character: string, authority: string): void {
    if (character === "@") {
      this.emit("[REDACTED]@");
      this.state = { kind: "normal" };
      return;
    }
    if (isProxyAuthorityDelimiter(character)) {
      this.emit(`${authority}${character}`);
      this.state = { kind: "normal" };
      return;
    }

    const value = authority + character;
    if (value.length > MAX_UNRESOLVED_AUTHORITY_CHARACTERS) {
      this.emit("[REDACTED]");
      this.state = { kind: "proxy-userinfo" };
    } else {
      this.state = { kind: "proxy-authority", value };
    }
  }

  private consumeProxyUserinfo(character: string): void {
    if (character === "@") {
      this.emit(character);
      this.state = { kind: "normal" };
    } else if (isProxyAuthorityDelimiter(character)) {
      this.emit(character);
      this.state = { kind: "normal" };
    }
  }
}

function isHorizontalWhitespace(value: string): boolean {
  return /[^\S\r\n]/.test(value);
}

function isUnquotedApiKeyDelimiter(value: string): boolean {
  return /[\s&,}"']/.test(value);
}

function isProxyAuthorityDelimiter(value: string): boolean {
  return /[/?#\s]/.test(value);
}

function findNormalToken(value: string): NormalToken | undefined {
  const structured = STRUCTURED_SECRET_TOKEN_PATTERN.exec(value);
  const fixedIndex = value.indexOf(FIXED_SYNTHETIC_PASSWORD);
  if (fixedIndex !== -1 && (!structured || fixedIndex < structured.index)) {
    return { index: fixedIndex, value: FIXED_SYNTHETIC_PASSWORD };
  }
  return structured
    ? { index: structured.index, value: structured[0] }
    : undefined;
}

function processGroupIsAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForProcessGroupExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(pid)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(50, remaining));
  }
  return true;
}

async function stopProcessGroup(pid: number): Promise<void> {
  signalProcessGroup(pid, "SIGTERM");
  if (await waitForProcessGroupExit(pid, TERM_TIMEOUT_MS)) return;

  signalProcessGroup(pid, "SIGKILL");
  if (await waitForProcessGroupExit(pid, KILL_TIMEOUT_MS)) return;

  throw new Error(
    `Process group ${pid} did not exit within ${TERM_TIMEOUT_MS + KILL_TIMEOUT_MS} ms`,
  );
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

async function waitForNoReadinessExit(
  exitPromise: Promise<ExitState>,
): Promise<ExitState | undefined> {
  const eventLoopBarrier = (async (): Promise<undefined> => {
    const deadline = Date.now() + NO_READINESS_EXIT_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return undefined;
  })();
  return Promise.race([exitPromise, eventLoopBarrier]);
}

async function checkReadiness(
  readinessURL: string,
  timeoutMs: number,
): Promise<ReadinessResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref();

  try {
    const response = await fetch(readinessURL, { signal: controller.signal });
    await response.body?.cancel();
    return {
      ready: response.ok,
      detail: response.ok ? "ready" : `HTTP ${response.status}`,
    };
  } catch (error) {
    const detail = timedOut
      ? `request timed out after ${timeoutMs} ms`
      : error instanceof Error
        ? error.message
        : String(error);
    return { ready: false, detail: boundedDiagnostic(detail, 512) };
  } finally {
    clearTimeout(timeout);
  }
}

function formatExit(exit: ExitState): string {
  return exit.code === null
    ? `signal ${exit.signal ?? "unknown"}`
    : `exit code ${exit.code}`;
}

function startupError(
  label: string,
  error: unknown,
  logs: string,
  cleanupError?: unknown,
): Error {
  const cause = boundedDiagnostic(
    error instanceof Error ? error.message : String(error),
  );
  const cleanup = cleanupError
    ? `; cleanup failed: ${boundedDiagnostic(
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
      )}`
    : "";
  return new Error(
    boundedDiagnostic(
      `${label} failed to start: ${cause}${cleanup}\n${logs}`,
      LOG_TAIL_BYTES,
    ),
    { cause: new Error(cause) },
  );
}

export async function startManagedProcess(options: {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  readinessURL?: string;
  startupTimeoutMs?: number;
}): Promise<ManagedProcess> {
  let exitState: ExitState | undefined;
  let spawnError: Error | undefined;
  let child: ChildProcess;
  try {
    child = spawn(options.command, options.args, {
      cwd: options.cwd,
      detached: true,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw startupError(options.label, error, "<no output>");
  }

  const diagnosticTail = new RedactedRollingTail();
  const stdoutDiagnostics = new DiagnosticStream(diagnosticTail);
  const stderrDiagnostics = new DiagnosticStream(diagnosticTail);
  child.stdout?.on("data", (chunk) => stdoutDiagnostics.append(chunk));
  child.stdout?.on("end", () => stdoutDiagnostics.end());
  child.stderr?.on("data", (chunk) => stderrDiagnostics.append(chunk));
  child.stderr?.on("end", () => stderrDiagnostics.end());

  const exitPromise = new Promise<ExitState>((resolve) => {
    child.once("exit", (code, signal) => {
      exitState = { code, signal };
      resolve(exitState);
    });
  });
  child.once("error", (error) => {
    spawnError = error;
  });

  let stopPromise: Promise<void> | undefined;
  const createHandle = (pid: number): ManagedProcess => ({
    pid,
    logTail: () => {
      const state = spawnError
        ? `spawn error: ${spawnError.message}`
        : exitState
          ? formatExit(exitState)
          : "running";
      const logs = diagnosticTail.snapshot([
        stdoutDiagnostics.snapshot(),
        stderrDiagnostics.snapshot(),
      ]);
      return boundedDiagnostic(
        `${options.label}: ${state}\n${logs || "<no output>"}`,
        LOG_TAIL_BYTES,
      );
    },
    stop: () => {
      stopPromise ??= stopProcessGroup(pid);
      return stopPromise;
    },
  });

  let handle: ManagedProcess | undefined;
  try {
    await waitForSpawn(child);
    const pid = child.pid;
    if (pid === undefined) {
      throw spawnError ?? new Error("spawn returned no process ID");
    }
    handle = createHandle(pid);

    if (!options.readinessURL) {
      const immediateExit = await waitForNoReadinessExit(exitPromise);
      if (immediateExit) {
        throw new Error(
          `exited during startup with ${formatExit(immediateExit)}`,
        );
      }
      return handle;
    }

    const startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) {
      throw new Error("startupTimeoutMs must be a positive finite number");
    }
    const deadline = Date.now() + startupTimeoutMs;
    let lastReadinessDetail = "readiness endpoint was not checked";

    while (true) {
      if (spawnError) throw spawnError;
      if (exitState) {
        throw new Error(
          `exited before readiness with ${formatExit(exitState)}`,
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `startup timed out after ${startupTimeoutMs} ms (${lastReadinessDetail})`,
        );
      }

      const attempt = await Promise.race([
        checkReadiness(
          options.readinessURL,
          Math.min(READINESS_INTERVAL_MS, remaining),
        ).then((result) => ({ kind: "readiness" as const, result })),
        exitPromise.then((exit) => ({ kind: "exit" as const, exit })),
      ]);
      if (attempt.kind === "exit") {
        throw new Error(
          `exited before readiness with ${formatExit(attempt.exit)}`,
        );
      }
      if (attempt.result.ready) return handle;
      lastReadinessDetail = attempt.result.detail;

      const pollRemaining = deadline - Date.now();
      if (pollRemaining <= 0) continue;
      const pause = await Promise.race([
        delay(Math.min(READINESS_INTERVAL_MS, pollRemaining)).then(() => false),
        exitPromise.then(() => true),
      ]);
      if (pause && exitState) {
        throw new Error(
          `exited before readiness with ${formatExit(exitState)}`,
        );
      }
    }
  } catch (error) {
    let cleanupError: unknown;
    if (handle) {
      try {
        await handle.stop();
      } catch (caught) {
        cleanupError = caught;
      }
    }
    const logs =
      handle?.logTail() ??
      diagnosticTail.snapshot([
        stdoutDiagnostics.snapshot(),
        stderrDiagnostics.snapshot(),
      ]);
    throw startupError(options.label, error, logs, cleanupError);
  }
}
