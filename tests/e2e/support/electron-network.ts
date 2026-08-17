import type { ElectronApplication } from "@playwright/test";

const INTERNAL_PROTOCOLS = new Set([
  "about:",
  "blob:",
  "data:",
  "chrome-extension:",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const CORE_PORT = "39719";

export type ElectronNetworkDecision = "allow" | "provisional-core" | "block";

export interface ElectronNetworkSnapshot {
  provisionalRequests: string[];
  blockedRequests: string[];
  provisionalRequestCount?: number;
  blockedRequestCount?: number;
  provisionalOrigin?: string | null;
  provisionalOriginMismatch?: boolean;
}

export interface ElectronNetworkGuard {
  tighten(coreOrigin: string): Promise<void>;
  assertFinal(): Promise<void>;
}

interface ElectronNetworkPolicyState extends ElectronNetworkSnapshot {
  coreOrigin: string | null;
}

interface ElectronBeforeRequestDetails {
  url: string;
}

interface ElectronBeforeRequestResponse {
  cancel?: boolean;
}

interface ElectronMainTarget {
  session: {
    defaultSession: {
      webRequest: {
        onBeforeRequest(
          listener: (
            details: ElectronBeforeRequestDetails,
            callback: (response: ElectronBeforeRequestResponse) => void,
          ) => void,
        ): void;
      };
    };
  };
}

interface ElectronPolicyGlobal {
  __mediagoE2eElectronNetworkPolicy?: ElectronNetworkPolicyState;
}

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4) return false;
  const values = octets.map((octet) => Number(octet));
  if (
    values.some(
      (value, index) =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255 ||
        String(value) !== octets[index],
    )
  ) {
    return false;
  }
  const [first, second] = values;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function normalizeElectronCoreOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Owned Core origin is invalid: ${value}`);
  }
  const validProtocol = url.protocol === "http:" || url.protocol === "https:";
  const validHost =
    LOOPBACK_HOSTS.has(url.hostname) || isPrivateIPv4(url.hostname);
  if (
    !validProtocol ||
    !validHost ||
    url.port !== CORE_PORT ||
    url.origin !== value
  ) {
    throw new Error(
      `Owned Core origin must be an exact loopback/private IPv4 HTTP(S) origin on port ${CORE_PORT}: ${value}`,
    );
  }
  return url.origin;
}

export function scrubElectronEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !/proxy/i.test(entry[0]) &&
        !/^(?:load|open)_devtools$/i.test(entry[0]),
    ),
  );
}

export function classifyElectronRequest(
  value: string,
  coreOrigin?: string | null,
): ElectronNetworkDecision {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "block";
  }
  if (INTERNAL_PROTOCOLS.has(url.protocol)) return "allow";
  const http = url.protocol === "http:" || url.protocol === "https:";
  const webSocket = url.protocol === "ws:" || url.protocol === "wss:";
  if (!http && !webSocket) return "block";
  if (LOOPBACK_HOSTS.has(url.hostname)) return "allow";
  if (webSocket) return "block";
  if (coreOrigin) {
    return url.origin === normalizeElectronCoreOrigin(coreOrigin)
      ? "allow"
      : "block";
  }
  return isPrivateIPv4(url.hostname) && url.port === CORE_PORT
    ? "provisional-core"
    : "block";
}

export function assertElectronNetworkSnapshot(
  snapshot: ElectronNetworkSnapshot,
  coreOrigin: string,
): void {
  const expectedOrigin = normalizeElectronCoreOrigin(coreOrigin);
  const unexpectedProvisional = snapshot.provisionalRequests.filter(
    (request) => {
      try {
        return new URL(request).origin !== expectedOrigin;
      } catch {
        return true;
      }
    },
  );
  if (
    snapshot.provisionalOriginMismatch ||
    (snapshot.provisionalOrigin !== undefined &&
      snapshot.provisionalOrigin !== null &&
      snapshot.provisionalOrigin !== expectedOrigin) ||
    unexpectedProvisional.length > 0
  ) {
    throw new Error(
      [
        `Electron provisional Core request(s) did not match ${expectedOrigin}:`,
        ...unexpectedProvisional,
      ]
        .join("\n")
        .slice(0, 4_096),
    );
  }
  const blockedRequestCount =
    snapshot.blockedRequestCount ?? snapshot.blockedRequests.length;
  if (blockedRequestCount > 0) {
    throw new Error(
      [
        `Electron blocked ${blockedRequestCount} external request(s):`,
        ...snapshot.blockedRequests,
      ]
        .join("\n")
        .slice(0, 4_096),
    );
  }
}

export function installElectronNetworkPolicy({
  session,
}: ElectronMainTarget): void {
  const policyGlobal = globalThis as ElectronPolicyGlobal;
  if (policyGlobal.__mediagoE2eElectronNetworkPolicy) {
    throw new Error("Electron network policy is already installed");
  }
  const state: ElectronNetworkPolicyState = {
    coreOrigin: null,
    provisionalRequests: [],
    blockedRequests: [],
    provisionalRequestCount: 0,
    blockedRequestCount: 0,
    provisionalOrigin: null,
    provisionalOriginMismatch: false,
  };
  policyGlobal.__mediagoE2eElectronNetworkPolicy = state;

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let url: URL;
    try {
      url = new URL(details.url);
    } catch {
      state.blockedRequestCount = (state.blockedRequestCount ?? 0) + 1;
      if (state.blockedRequests.length < 32) {
        state.blockedRequests.push("<invalid-url>");
      }
      callback({ cancel: true });
      return;
    }
    const safeOrigin =
      url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin;
    const safePath = url.pathname === "/" ? "/" : "/<redacted>";
    const location = `${safeOrigin}${safePath}`.slice(0, 512);
    const internal = new Set(["about:", "blob:", "data:", "chrome-extension:"]);
    if (internal.has(url.protocol)) {
      callback({ cancel: false });
      return;
    }
    const http = url.protocol === "http:" || url.protocol === "https:";
    const webSocket = url.protocol === "ws:" || url.protocol === "wss:";
    const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    if ((http || webSocket) && loopback.has(url.hostname)) {
      callback({ cancel: false });
      return;
    }
    if (http && state.coreOrigin) {
      if (url.origin === state.coreOrigin) {
        callback({ cancel: false });
        return;
      }
    } else if (http) {
      const octets = url.hostname.split(".");
      const values = octets.map((octet) => Number(octet));
      const validIPv4 =
        octets.length === 4 &&
        values.every(
          (value, index) =>
            Number.isInteger(value) &&
            value >= 0 &&
            value <= 255 &&
            String(value) === octets[index],
        );
      const [first, second] = values;
      const privateIPv4 =
        validIPv4 &&
        (first === 10 ||
          (first === 172 && second >= 16 && second <= 31) ||
          (first === 192 && second === 168));
      if (privateIPv4 && url.port === "39719") {
        state.provisionalRequestCount =
          (state.provisionalRequestCount ?? 0) + 1;
        if (state.provisionalOrigin === null) {
          state.provisionalOrigin = url.origin;
        } else if (state.provisionalOrigin !== url.origin) {
          state.provisionalOriginMismatch = true;
        }
        if (state.provisionalRequests.length < 32) {
          state.provisionalRequests.push(location);
        }
        callback({ cancel: false });
        return;
      }
    }
    state.blockedRequestCount = (state.blockedRequestCount ?? 0) + 1;
    if (state.blockedRequests.length < 32) {
      state.blockedRequests.push(location);
    }
    callback({ cancel: true });
  });
}

export function tightenElectronNetworkPolicy(
  _electron: ElectronMainTarget,
  coreOrigin: string,
): ElectronNetworkSnapshot {
  const state = (globalThis as ElectronPolicyGlobal)
    .__mediagoE2eElectronNetworkPolicy;
  if (!state) throw new Error("Electron network policy is not installed");
  let url: URL;
  try {
    url = new URL(coreOrigin);
  } catch {
    throw new Error(`Owned Core origin is invalid: ${coreOrigin}`);
  }
  const octets = url.hostname.split(".");
  const values = octets.map((octet) => Number(octet));
  const validIPv4 =
    octets.length === 4 &&
    values.every(
      (value, index) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 255 &&
        String(value) === octets[index],
    );
  const [first, second] = values;
  const privateIPv4 =
    validIPv4 &&
    (first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168));
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const validProtocol = url.protocol === "http:" || url.protocol === "https:";
  if (
    !validProtocol ||
    (!loopback.has(url.hostname) && !privateIPv4) ||
    url.port !== "39719" ||
    url.origin !== coreOrigin
  ) {
    throw new Error(
      `Owned Core origin must be an exact loopback/private IPv4 HTTP(S) origin on port 39719: ${coreOrigin}`,
    );
  }
  state.coreOrigin = url.origin;
  return {
    provisionalRequests: [...state.provisionalRequests],
    blockedRequests: [...state.blockedRequests],
    provisionalRequestCount: state.provisionalRequestCount,
    blockedRequestCount: state.blockedRequestCount,
    provisionalOrigin: state.provisionalOrigin,
    provisionalOriginMismatch: state.provisionalOriginMismatch,
  };
}

export function readElectronNetworkPolicy(
  _electron: ElectronMainTarget,
): ElectronNetworkSnapshot {
  const state = (globalThis as ElectronPolicyGlobal)
    .__mediagoE2eElectronNetworkPolicy;
  if (!state) throw new Error("Electron network policy is not installed");
  return {
    provisionalRequests: [...state.provisionalRequests],
    blockedRequests: [...state.blockedRequests],
    provisionalRequestCount: state.provisionalRequestCount,
    blockedRequestCount: state.blockedRequestCount,
    provisionalOrigin: state.provisionalOrigin,
    provisionalOriginMismatch: state.provisionalOriginMismatch,
  };
}

export async function installElectronNetworkGuard(
  electronApp: ElectronApplication,
): Promise<ElectronNetworkGuard> {
  await electronApp.evaluate(installElectronNetworkPolicy);
  let ownedCoreOrigin: string | undefined;

  return {
    async tighten(coreOrigin) {
      ownedCoreOrigin = normalizeElectronCoreOrigin(coreOrigin);
      const snapshot = await electronApp.evaluate(
        tightenElectronNetworkPolicy,
        ownedCoreOrigin,
      );
      assertElectronNetworkSnapshot(snapshot, ownedCoreOrigin);
    },
    async assertFinal() {
      if (!ownedCoreOrigin) {
        throw new Error("Electron network policy was never tightened");
      }
      const snapshot = await electronApp.evaluate(readElectronNetworkPolicy);
      assertElectronNetworkSnapshot(snapshot, ownedCoreOrigin);
    },
  };
}
