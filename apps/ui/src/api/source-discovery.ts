import type {
  CreateDiscoveryDownloadsParams,
  CreateDiscoveryParams,
  DiscoveryJob,
  InspectSourcesResponse,
  SourceInspection,
} from "@mediago/core-sdk";
import type { DownloadTask, Video } from "@mediago/common";
import { http } from "@/utils";

export async function inspectSource(
  url: string,
  headers: string[],
  signal?: AbortSignal,
  proxy?: {
    proxyMode?: "inherit" | "direct" | "custom";
    proxyUrl?: string;
    target?: "local" | "docker";
  },
): Promise<SourceInspection> {
  const response = await http.post<never, InspectSourcesResponse>(
    proxy?.target === "docker"
      ? "/api/docker/sources/inspect"
      : "/api/sources/inspect",
    {
      sources: [
        {
          id: "homepage-source",
          url,
          headers,
          ...(proxy
            ? { proxyMode: proxy.proxyMode, proxyUrl: proxy.proxyUrl }
            : {}),
        },
      ],
    },
    { signal },
  );
  return response.sources[0];
}

export const createSourceDiscovery = (
  params: CreateDiscoveryParams,
  signal?: AbortSignal,
): Promise<DiscoveryJob> =>
  http.post("/api/discoveries", params, { signal, timeout: 35_000 });

export const getSourceDiscovery = (
  id: string,
  signal?: AbortSignal,
): Promise<DiscoveryJob> =>
  http.get(`/api/discoveries/${encodeURIComponent(id)}`, { signal });

export const cancelSourceDiscovery = (id: string): Promise<DiscoveryJob> =>
  http.post(`/api/discoveries/${encodeURIComponent(id)}/cancel`);

export const createSourceDiscoveryDownloads = (
  id: string,
  params: CreateDiscoveryDownloadsParams,
): Promise<Video[]> =>
  http.post(`/api/discoveries/${encodeURIComponent(id)}/downloads`, params);

export const createDockerSourceDiscoveryDownloads = (
  id: string,
  params: CreateDiscoveryDownloadsParams,
): Promise<DownloadTask[]> =>
  http.post(
    `/api/docker/discoveries/${encodeURIComponent(id)}/downloads`,
    params,
  );
