import { expect, test, vi } from "vitest";
import { enableSessionProxy } from "./webview-proxy";

test("enables a normalized proxy without logging credentials", () => {
  const setProxy = vi.fn();
  const info = vi.fn();
  const error = vi.fn();
  const usernameMarker = "U7kQ9mX2vL4p";
  const passwordMarker = "P8nR3sW6yT1c";
  const hostMarker = "H5dJ7fK9qZ2x.invalid";
  const proxy = `${usernameMarker}:${passwordMarker}@${hostMarker}:8080`;

  enableSessionProxy({ setProxy }, { info, error }, proxy);

  const proxyRules = setProxy.mock.calls[0]?.[0]?.proxyRules;
  const configuredExactlyOnce =
    setProxy.mock.calls.length === 1 && proxyRules === `http://${proxy}`;
  expect(configuredExactlyOnce, "setProxy proxyRules changed").toBe(true);

  const infoCall = info.mock.calls[0];
  expect(
    info.mock.calls.length === 1 &&
      infoCall?.length === 1 &&
      infoCall[0] === "[Proxy] proxy enabled",
    "proxy enabled logger changed",
  ).toBe(true);
  const errorLoggerStayedSilent = error.mock.calls.length === 0;
  expect(errorLoggerStayedSilent, "proxy error logger changed").toBe(true);

  const serializedLoggerCalls = JSON.stringify({
    info: info.mock.calls,
    error: error.mock.calls,
  });
  const loggerExposedFullProxy = serializedLoggerCalls.includes(proxy);
  const loggerExposedUsernameMarker =
    serializedLoggerCalls.includes(usernameMarker);
  const loggerExposedPasswordMarker =
    serializedLoggerCalls.includes(passwordMarker);
  const loggerExposedHostMarker = serializedLoggerCalls.includes(hostMarker);
  expect(loggerExposedFullProxy, "proxy logger exposed full address").toBe(
    false,
  );
  expect(
    loggerExposedUsernameMarker,
    "proxy logger exposed username marker",
  ).toBe(false);
  expect(
    loggerExposedPasswordMarker,
    "proxy logger exposed password marker",
  ).toBe(false);
  expect(loggerExposedHostMarker, "proxy logger exposed host marker").toBe(
    false,
  );
});

test("rejects an empty proxy without configuring the session", () => {
  const setProxy = vi.fn();
  const info = vi.fn();
  const error = vi.fn();

  enableSessionProxy({ setProxy }, { info, error }, "");

  expect(setProxy.mock.calls.length === 0, "empty proxy configured").toBe(true);
  const errorCall = error.mock.calls[0];
  expect(
    error.mock.calls.length === 1 &&
      errorCall?.length === 1 &&
      errorCall[0] === "[Proxy] proxy address is empty",
    "empty proxy logger changed",
  ).toBe(true);
});
