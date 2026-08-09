export const ELECTRON_UPDATE_CHANNELS = [
  "alpha",
  "beta",
  "latest",
  "test",
] as const;

export type ElectronUpdateChannel = (typeof ELECTRON_UPDATE_CHANNELS)[number];

export interface ElectronArtifactValidation {
  version: string;
  channel: ElectronUpdateChannel;
}

export function isElectronUpdateChannel(
  value: string,
): value is ElectronUpdateChannel {
  return ELECTRON_UPDATE_CHANNELS.some((channel) => channel === value);
}
