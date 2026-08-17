import path from "node:path";

interface ResolveServerPathsOptions {
  appName: string;
  homeDir: string;
  rootOverride?: string;
}

export const resolveServerPaths = ({
  appName,
  homeDir,
  rootOverride,
}: ResolveServerPathsOptions) => {
  const root = rootOverride?.trim()
    ? path.resolve(rootOverride)
    : path.resolve(homeDir, `.${appName}-server`);
  const data = path.resolve(root, "data");

  return {
    root,
    data,
    logs: path.resolve(root, "logs"),
    downloads: path.resolve(root, "downloads"),
    database: path.resolve(data, "mediago.db"),
  };
};
