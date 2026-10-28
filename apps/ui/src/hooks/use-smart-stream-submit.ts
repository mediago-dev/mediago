import type {
  CreateDiscoveryParams,
  DiscoveryJob,
  DiscoverySource,
  SourceInspection,
} from "@mediago/core-sdk";
import { DownloadType, type DownloadTask } from "@mediago/common";
import { useEffect, useRef, useState } from "react";
import { createDownloadTasks, getDownloadTasks } from "@/api/download-task";
import {
  createDockerDownloadTasks,
  getDockerTasks,
} from "@/api/docker-download-task";
import {
  cancelSourceDiscovery,
  createDockerSourceDiscoveryDownloads,
  createSourceDiscovery,
  createSourceDiscoveryDownloads,
  getSourceDiscovery,
  inspectSource,
} from "@/api/source-discovery";
import type { DownloadFormItem } from "@/store/download-dialog";
import { isWeb } from "@/environment";
import {
  createSmartStreamSubmitState,
  prepareSmartStreamSources,
  selectedSmartStreamSourceURL,
  transitionSmartStreamSubmit,
  type PreparedSmartStreamSource,
  type SubmissionIntent,
  type SmartStreamSubmitState,
} from "@/components/smart-stream-submit-logic";

const DISCOVERY_POLL_MS = 350;
const DISCOVERY_TIMEOUT_MS = 20_000;

export interface SmartStreamDiscoveryInput {
  proxyMode?: "inherit" | "direct" | "custom";
  proxyUrl?: string;
  target?: "local" | "docker";
  allowBrowserDiscovery?: boolean;
  headers: string[];
  isWeb: boolean;
  onDiscoveryCreated?: (id: string) => void;
  signal?: AbortSignal;
  url: string;
}

export interface SmartStreamDiscoveryDependencies {
  createDiscovery: (
    params: CreateDiscoveryParams,
    signal?: AbortSignal,
  ) => Promise<DiscoveryJob>;
  getDiscovery: (id: string, signal?: AbortSignal) => Promise<DiscoveryJob>;
  inspect: (
    url: string,
    headers: string[],
    signal?: AbortSignal,
    proxy?: {
      proxyMode?: "inherit" | "direct" | "custom";
      proxyUrl?: string;
      target?: "local" | "docker";
    },
  ) => Promise<SourceInspection>;
  wait: (signal?: AbortSignal) => Promise<void>;
}

export type SmartStreamDiscoveryResult =
  | {
      kind: "sources";
      discoveryId?: string;
      partial: boolean;
      sources: PreparedSmartStreamSource[];
    }
  | {
      kind: "fallback";
      discoveryId?: string;
      reason: string;
    };

export interface SmartStreamSubmitView {
  discoveryId?: string;
  fallbackReason?: string;
  machine: SmartStreamSubmitState;
  partial: boolean;
  sources: PreparedSmartStreamSource[];
}

function formattedHeadersToArray(headers?: string): string[] {
  if (!headers) return [];
  return headers
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((header) => header.trim())
    .filter(Boolean);
}

function directInspectionSource(
  url: string,
  inspection: SourceInspection,
): PreparedSmartStreamSource {
  return {
    available: true,
    id: inspection.id,
    name: "Media",
    playlistType: inspection.playlistType,
    quality: inspection.maxQuality,
    type: "m3u8",
    url: inspection.url || url,
    variants: inspection.variants,
  };
}

function discoveredSources(
  sources: DiscoverySource[],
): PreparedSmartStreamSource[] {
  return prepareSmartStreamSources(
    sources.map((source) => ({
      id: source.id,
      playlistType: source.playlistType,
      quality: source.maxQuality,
      title: source.title,
      type: source.type,
      url: source.url,
      variants: source.variants,
    })),
  );
}

function terminalDiscoveryResult(
  job: DiscoveryJob,
): SmartStreamDiscoveryResult {
  const sources = discoveredSources(job.sources);
  if (sources.length > 0) {
    return {
      kind: "sources",
      discoveryId: job.id,
      partial: job.partial || job.status === "failed",
      sources,
    };
  }
  return {
    kind: "fallback",
    discoveryId: job.id,
    reason: job.errorCode || "no_sources",
  };
}

export async function runSmartStreamDiscovery(
  input: SmartStreamDiscoveryInput,
  dependencies: SmartStreamDiscoveryDependencies,
): Promise<SmartStreamDiscoveryResult> {
  let inspection: SourceInspection | undefined;
  try {
    inspection = input.proxyMode
      ? await dependencies.inspect(input.url, input.headers, input.signal, {
          proxyMode: input.proxyMode,
          proxyUrl: input.proxyUrl,
          target: input.target,
        })
      : await dependencies.inspect(input.url, input.headers, input.signal);
  } catch (error) {
    if (input.signal?.aborted) throw error;
  }

  if (
    inspection &&
    !inspection.error &&
    !inspection.errorCode &&
    (inspection.playlistType === "master" ||
      inspection.playlistType === "media")
  ) {
    return {
      kind: "sources",
      partial: false,
      sources: [directInspectionSource(input.url, inspection)],
    };
  }

  if (input.allowBrowserDiscovery === false || input.isWeb) {
    return {
      kind: "fallback",
      reason: inspection?.errorCode || "probe_failed",
    };
  }

  let discovery = await dependencies.createDiscovery(
    {
      url: input.url,
      mode: "browser",
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      useSessionCookies: true,
    },
    input.signal,
  );
  input.onDiscoveryCreated?.(discovery.id);
  const pollUntilDone = async (
    current: DiscoveryJob,
  ): Promise<DiscoveryJob> => {
    if (current.status !== "pending" && current.status !== "running") {
      return current;
    }
    await dependencies.wait(input.signal);
    return pollUntilDone(
      await dependencies.getDiscovery(current.id, input.signal),
    );
  };
  discovery = await pollUntilDone(discovery);
  return terminalDiscoveryResult(discovery);
}

function waitForPoll(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, DISCOVERY_POLL_MS);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

const defaultDependencies: SmartStreamDiscoveryDependencies = {
  createDiscovery: createSourceDiscovery,
  getDiscovery: getSourceDiscovery,
  inspect: inspectSource,
  wait: waitForPoll,
};

interface SubmissionContext {
  intent: SubmissionIntent;
  values: DownloadFormItem;
}

const initialView = (): SmartStreamSubmitView => ({
  machine: createSmartStreamSubmitState(),
  partial: false,
  sources: [],
});

export function useSmartStreamSubmit() {
  const [view, setView] = useState<SmartStreamSubmitView>(initialView);
  const controllerRef = useRef<AbortController | null>(null);
  const contextRef = useRef<SubmissionContext | null>(null);
  const discoveryIdRef = useRef<string | undefined>(undefined);

  const cancel = async () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const discoveryId = discoveryIdRef.current;
    discoveryIdRef.current = undefined;
    if (discoveryId) {
      await cancelSourceDiscovery(discoveryId).catch(() => undefined);
    }
    contextRef.current = null;
    setView(initialView());
  };

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      const discoveryId = discoveryIdRef.current;
      if (discoveryId)
        void cancelSourceDiscovery(discoveryId).catch(() => undefined);
    };
  }, []);

  const begin = async (
    values: DownloadFormItem,
    intent: SubmissionIntent,
    options: { allowBrowserDiscovery?: boolean } = {},
  ): Promise<SmartStreamDiscoveryResult> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    contextRef.current = { intent, values };
    let machine = transitionSmartStreamSubmit(createSmartStreamSubmitState(), {
      type: "submit",
      intent,
      startedAt: Date.now(),
    });
    setView({ machine, partial: false, sources: [] });
    try {
      const result = await runSmartStreamDiscovery(
        {
          allowBrowserDiscovery: options.allowBrowserDiscovery,
          headers: formattedHeadersToArray(values.headers),
          proxyMode:
            intent.target === "docker" || isWeb
              ? "inherit"
              : (values.proxyMode ?? "inherit"),
          proxyUrl: intent.target === "docker" || isWeb ? "" : values.proxyUrl,
          target: intent.target,
          isWeb,
          onDiscoveryCreated: (discoveryId) => {
            discoveryIdRef.current = discoveryId;
            machine = transitionSmartStreamSubmit(machine, {
              type: "probeNeedsDiscovery",
            });
            setView({
              discoveryId,
              machine,
              partial: false,
              sources: [],
            });
          },
          signal: controller.signal,
          url: values.url?.trim() ?? "",
        },
        defaultDependencies,
      );
      if (controller.signal.aborted) throw controller.signal.reason;
      discoveryIdRef.current = result.discoveryId;
      if (result.kind === "fallback") {
        machine = transitionSmartStreamSubmit(machine, {
          type: "fail",
          reason: result.reason,
        });
        setView({
          discoveryId: result.discoveryId,
          fallbackReason: result.reason,
          machine,
          partial: false,
          sources: [],
        });
        return result;
      }
      machine = result.discoveryId
        ? transitionSmartStreamSubmit(machine, { type: "sourcesFound" })
        : transitionSmartStreamSubmit(machine, { type: "probeFoundHls" });
      let existingUrls = new Set<string>();
      try {
        const existing =
          intent.target === "docker"
            ? await getDockerTasks({ current: 1, pageSize: 1_000 })
            : await getDownloadTasks({ current: 1, pageSize: 1_000 });
        existingUrls = new Set(existing.list.map((task) => task.url));
      } catch {
        // Discovery remains usable if the duplicate preflight is unavailable;
        // the authoritative Core still rejects a concurrent duplicate.
      }
      const sources = prepareSmartStreamSources(result.sources, {
        existingUrls,
        requestedName: values.name,
      });
      setView({
        discoveryId: result.discoveryId,
        machine,
        partial: result.partial,
        sources,
      });
      return { ...result, sources };
    } catch (error) {
      if (!controller.signal.aborted) {
        machine = transitionSmartStreamSubmit(machine, {
          type: "fail",
          reason: error instanceof Error ? error.message : String(error),
        });
        setView({ machine, partial: false, sources: [] });
      }
      throw error;
    }
  };

  const confirm = async (
    sourceIds: string[],
    names: Record<string, string>,
    variantUrls: Record<string, string>,
  ): Promise<void> => {
    const context = contextRef.current;
    if (!context || view.machine.phase !== "selecting") {
      throw new Error("Smart stream selection is not ready");
    }
    const selected = view.sources.filter(
      (source) => source.available && sourceIds.includes(source.id),
    );
    if (selected.length === 0) throw new Error("Select at least one source");
    setView((current) => ({
      ...current,
      machine: transitionSmartStreamSubmit(current.machine, { type: "create" }),
    }));
    const params = {
      ...(context.intent.target === "local" && !isWeb
        ? {
            proxyMode: context.values.proxyMode ?? "inherit",
            proxyUrl:
              context.values.proxyMode === "custom"
                ? context.values.proxyUrl
                : "",
          }
        : {}),
      sourceIds: selected.map((source) => source.id),
      folder: context.values.folder,
      names,
      variantUrls,
      startDownload: context.intent.startDownload,
    };
    try {
      if (view.discoveryId) {
        if (context.intent.target === "docker") {
          await createDockerSourceDiscoveryDownloads(view.discoveryId, params);
        } else {
          await createSourceDiscoveryDownloads(view.discoveryId, params);
        }
      } else {
        const tasks: Omit<DownloadTask, "id">[] = selected.map((source) => ({
          ...(context.intent.target === "local" && !isWeb
            ? {
                proxyMode: context.values.proxyMode ?? "inherit",
                proxyUrl:
                  context.values.proxyMode === "custom"
                    ? context.values.proxyUrl
                    : "",
              }
            : {}),
          folder: context.values.folder,
          headers: context.values.headers,
          name: names[source.id]?.trim() || source.name,
          type: (source.type as DownloadType | undefined) ?? DownloadType.m3u8,
          url: selectedSmartStreamSourceURL(source, variantUrls),
        }));
        if (context.intent.target === "docker") {
          await createDockerDownloadTasks(tasks, context.intent.startDownload);
        } else {
          await createDownloadTasks(tasks, context.intent.startDownload);
        }
      }
    } catch (error) {
      setView((current) => ({
        ...current,
        machine: transitionSmartStreamSubmit(current.machine, {
          type: "createFailed",
          reason: error instanceof Error ? error.message : String(error),
        }),
      }));
      throw error;
    }
    controllerRef.current = null;
    contextRef.current = null;
    discoveryIdRef.current = undefined;
    setView(initialView());
  };

  const dismissFallback = () => {
    discoveryIdRef.current = undefined;
    contextRef.current = null;
    setView(initialView());
  };

  return { begin, cancel, confirm, dismissFallback, view };
}
