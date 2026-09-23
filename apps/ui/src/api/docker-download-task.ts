import type {
  DownloadTask,
  DownloadTaskPagination,
  DownloadTaskResponse,
  Video,
} from "@mediago/common";
import { http } from "@/utils";

export const createDockerDownloadTasks = (
  tasks: Omit<DownloadTask, "id">[],
  startDownload = false,
): Promise<Video[]> =>
  http.post("/api/docker/downloads", { tasks, startDownload });

export const getDockerTasks = async (
  params: DownloadTaskPagination,
): Promise<DownloadTaskResponse> => {
  const response: DownloadTaskResponse = await http.get(
    "/api/docker/downloads",
    {
      params,
    },
  );
  if (
    !Array.isArray(response?.list) ||
    !Number.isInteger(response.total) ||
    response.total < 0
  ) {
    throw new Error("Invalid Docker task response");
  }
  return response;
};

export const getActiveDockerTasks = (): Promise<Video[]> =>
  http.get("/api/docker/downloads/active");

export const startDockerDownload = (id: number): Promise<void> =>
  http.post(`/api/docker/downloads/${id}/start`);

export const stopDockerDownload = (id: number): Promise<void> =>
  http.post(`/api/docker/downloads/${id}/stop`);

export const deleteDockerDownloadTask = (id: number): Promise<void> =>
  http.delete(`/api/docker/downloads/${id}`);

export const editDockerDownloadTask = (
  id: number,
  data: Partial<DownloadTask>,
): Promise<Video> => http.put(`/api/docker/downloads/${id}`, data);

export const getDockerDownloadLog = (
  id: number,
): Promise<{ id: number; log: string }> =>
  http.get(`/api/docker/downloads/${id}/logs`);
