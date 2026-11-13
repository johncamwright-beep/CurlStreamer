const gameViews = [
  "all",
  "upcoming",
  "events",
  "past",
  "unfinished",
  "single",
] as const;
export type GameView = (typeof gameViews)[number];

export type DashboardQuery = {
  tab: GameView;
  sort: "newest" | "oldest";
  search: string;
  season?: string;
  event?: string;
};

export function parseGameView(value: unknown): GameView {
  return gameViews.find((view) => view === value) ?? "all";
}

export function parseGameSearch(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ").slice(0, 120)
    : "";
}

export function dashboardHref({
  tab,
  sort,
  search,
  season,
  event,
}: DashboardQuery) {
  const params = new URLSearchParams();
  if (tab !== "all") params.set("tab", tab);
  if (season) params.set("season", season);
  if (event) params.set("event", event);
  if (sort !== "newest") params.set("sort", sort);
  if (search) params.set("q", search);
  return params.size ? `/dashboard?${params}` : "/dashboard";
}
