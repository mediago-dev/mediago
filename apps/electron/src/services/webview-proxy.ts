interface ProxySession {
  setProxy(options: { proxyRules: string }): unknown;
}

interface ProxyLogger {
  info(...args: unknown[]): unknown;
  error(...args: unknown[]): unknown;
}

export function enableSessionProxy(
  session: ProxySession,
  logger: ProxyLogger,
  proxy: string,
): void {
  if (!proxy) {
    logger.error("[Proxy] proxy address is empty");
    return;
  }

  const proxyRules = /^(https?|socks5):\/\//i.test(proxy)
    ? proxy
    : `http://${proxy}`;

  session.setProxy({ proxyRules });
  logger.info("[Proxy] proxy enabled");
}
