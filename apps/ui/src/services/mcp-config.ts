const MCP_SERVER_ID = "mediago-downloader";
const MCP_SERVER_NAME = "mediago downloader";

type MCPTarget = "desktop" | "web";

export function buildMCPEndpoint(
  coreUrl: string,
  target: MCPTarget = "web",
): string {
  const baseUrl = coreUrl.trim();
  if (!baseUrl) return "";

  const endpoint = new URL("/mcp", baseUrl);
  if (target === "desktop") endpoint.hostname = "localhost";
  return endpoint.toString();
}

type MCPAgentConfigValues = {
  endpoint: string;
  token: string;
  serverId: string;
  serverName: string;
};

type MCPAgentConfigFormatter = (values: MCPAgentConfigValues) => string;

const formatEnglishAgentConfig: MCPAgentConfigFormatter = ({
  endpoint,
  token,
  serverId,
  serverName,
}) =>
  [
    `Configure an MCP server with configuration ID "${serverId}" and display name "${serverName}" in the current Agent client.`,
    "Transport: Streamable HTTP",
    `URL: ${endpoint}`,
    "HTTP header:",
    `Authorization: Bearer ${token}`,
    "",
    "Use the client's secure secret or environment-variable mechanism for the token when available; otherwise configure the header directly.",
    "The Agent must be able to reach this URL. A localhost or 127.0.0.1 URL works only when the Agent runs on the same machine as MediaGo.",
    "",
    `If an existing "mediago" entry is confirmed to point to this same MediaGo instance, rename it to "${serverId}" and update its URL to the one above, preserving its valid credentials and other settings. Avoid duplicate entries and do not overwrite entries for other instances.`,
    "",
    "Write this configuration to the client's active MCP settings and verify the connection by calling the health_check tool.",
    "If you cannot modify the settings directly, return the exact configuration snippet for the current client.",
  ].join("\n");

export function buildMCPAgentConfig(
  coreUrl: string,
  token: string,
  format: MCPAgentConfigFormatter = formatEnglishAgentConfig,
  target: MCPTarget = "web",
): string {
  const endpoint = buildMCPEndpoint(coreUrl, target);
  if (!endpoint || !token.trim()) return "";

  return format({
    endpoint,
    token,
    serverId: MCP_SERVER_ID,
    serverName: MCP_SERVER_NAME,
  });
}
