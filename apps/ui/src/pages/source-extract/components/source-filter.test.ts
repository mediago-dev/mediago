import { expect, test } from "vitest";
import { filterSources } from "./source-filter";

const sources = [
  {
    id: 1,
    name: "Episode One",
    url: "https://media.example.com/episode-1.m3u8",
    documentURL: "https://example.com/series",
  },
  {
    id: 2,
    name: "幕后花絮",
    url: "https://cdn.example.org/bonus.mp4",
    documentURL: "https://example.org/BONUS",
  },
];

test("returns the original source list for a blank query", () => {
  expect(filterSources(sources, "   ")).toBe(sources);
});

test("filters source names and URLs without case sensitivity", () => {
  expect(filterSources(sources, "EPISODE")).toStrictEqual([sources[0]]);
  expect(filterSources(sources, "bonus.MP4")).toStrictEqual([sources[1]]);
  expect(filterSources(sources, " example.org/bonus ")).toStrictEqual([
    sources[1],
  ]);
});

test("returns an empty list when no source matches", () => {
  expect(filterSources(sources, "trailer")).toStrictEqual([]);
});
