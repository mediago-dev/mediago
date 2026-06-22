import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";

// Allow Immer to work with Map in state
enableMapSet();

// Normalize percent input. Go Core reports percent on a 0-100 scale (e.g. 1 == 1%),
// so just clamp to [0,100]. Do NOT treat small values as a 0-1 ratio — that turned a
// real 1% into 100% (`1 * 100`), and Math.max() in setEvents then pinned it at 100.
const normalizePercent = (value: string | number | undefined) => {
  const num = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.min(100, num);
};
interface DownloadEvent {
  percent: string;
  speed: string;
  id: number;
}

interface DownloadStore {
  count: number;
  events: DownloadEvent[];
  eventsMap: Map<string, DownloadEvent>;
}

const initialState: DownloadStore = {
  count: 0,
  events: [],
  eventsMap: new Map(),
};

type Actions = {
  clearCount: () => void;
  increase: () => void;
  setEvents: (events: DownloadEvent[]) => void;
};

export const useDownloadStore = create<DownloadStore & Actions>()(
  immer((set) => ({
    ...initialState,
    clearCount: () =>
      set((state) => {
        state.count = 0;
      }),
    increase: () =>
      set((state) => {
        state.count += 1;
      }),
    setEvents: (events: DownloadEvent[]) =>
      set((state) => {
        const normalized = events.map((item) => {
          const prevPercent = normalizePercent(
            state.eventsMap.get(String(item.id))?.percent,
          );
          const currentPercent = normalizePercent(item.percent);
          const percent = Math.min(
            100,
            Math.max(currentPercent ?? 0, prevPercent ?? 0, 0),
          );

          return {
            ...item,
            percent: percent.toString(),
          };
        });

        state.events = normalized;
        state.eventsMap = new Map(
          normalized.map((item) => [String(item.id), item]),
        );
      }),
  })),
);

export const downloadStoreSelector = (state: DownloadStore & Actions) => {
  return {
    count: state.count,
    clearCount: state.clearCount,
    increase: state.increase,
    events: state.events,
    eventsMap: state.eventsMap,
    setEvents: state.setEvents,
  };
};
