import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

type State = {
  page: number;
  pageSize: number;
};

type Actions = {
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
};

export const useHomeStore = create<State & Actions>()(
  immer((set) => ({
    // 1-indexed: AntD Pagination is 1-based; Go core also coerces <=0 to 1.
    page: 1,
    pageSize: 20,
    setPage: (page) => {
      set((state) => {
        state.page = page;
      });
    },
    setPageSize: (pageSize) => {
      set((state) => {
        state.pageSize = pageSize;
      });
    },
  })),
);

export const homeSelector = (s: State & Actions) => ({
  page: s.page,
  pageSize: s.pageSize,
  setPage: s.setPage,
  setPageSize: s.setPageSize,
});
