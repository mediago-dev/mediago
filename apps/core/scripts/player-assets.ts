import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PlayerAssetOperations {
  copy?: (sourceDirectory: string, targetDirectory: string) => void;
  remove?: (targetDirectory: string) => void;
}

export const PLAYER_ASSET_PLACEHOLDER = "MediaGo player assets placeholder.\n";

const defaultOperations: Required<PlayerAssetOperations> = {
  copy: (sourceDirectory, targetDirectory) =>
    cpSync(sourceDirectory, targetDirectory, { recursive: true }),
  remove: (targetDirectory) =>
    rmSync(targetDirectory, { recursive: true, force: true }),
};

export function replacePlayerAssets(
  sourceDirectory: string,
  targetDirectory: string,
  operations: PlayerAssetOperations = {},
): void {
  try {
    (operations.remove ?? defaultOperations.remove)(targetDirectory);
    (operations.copy ?? defaultOperations.copy)(
      sourceDirectory,
      targetDirectory,
    );
  } finally {
    mkdirSync(targetDirectory, { recursive: true });
    writeFileSync(
      join(targetDirectory, "placeholder.txt"),
      PLAYER_ASSET_PLACEHOLDER,
      "utf8",
    );
  }
}
