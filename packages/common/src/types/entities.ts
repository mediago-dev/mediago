// Type definitions for database entities

export interface Conversion {
  id: number;
  name: string;
  path: string;
  status: string;
  outputPath: string;
  outputFormat: string;
  quality: string;
  progress: number;
  error?: string | null;
  createdDate?: Date;
  updatedDate?: Date;
}

export interface Favorite {
  id: number;
  title: string;
  url: string;
  icon?: string | null;
  iconStatus: FavoriteIconStatus;
  createdDate: Date;
  updatedDate: Date;
}

export type FavoriteIconStatus =
  | "unresolved"
  | "ready"
  | "missing"
  | "retryable";

export interface Video {
  id: number;
  name: string;
  type: string;
  url: string;
  folder?: string;
  headers?: string;
  outputPath?: string;
  downloadDir?: string;
  isLive: boolean;
  status: string;
  log: string;
  createdDate: Date;
  updatedDate: Date;
}
