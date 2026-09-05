const season = "33333333-3333-4333-8333-333333333333";
const previous = "44444444-4444-4444-8444-444444444444";
const eventId = "55555555-5555-4555-8555-555555555555";
const id = (n) => `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`;
const at = (days) => new Date(Date.now() + days * 86400000).toISOString();
const game = (n, away, extra = {}) => ({
  id: id(n),
  season_id: season,
  event_id: null,
  opponent_id: "opponent",
  scheduled_start: at(1),
  schedule_timezone: "America/Toronto",
  created_at: at(-5),
  game_status: "active",
  config: {
    homeName: "Northern Ontario Curling Club",
    awayName: away,
    homeColor: "#ef4444",
    awayColor: "#3b82f6",
    eventName: "Single Game",
    scheduledEnds: 8,
    youtubeTitle: "Game",
    youtubeVisibility: "unlisted",
  },
  ...extra,
});
export function dashboardResponse(url) {
  if (url.pathname.endsWith("/rpc/list_seasons"))
    return [
      {
        id: season,
        name: "2026–27 Curling season",
        start_date: "2026-09-01",
        end_date: "2027-04-01",
        status: "active",
      },
      {
        id: previous,
        name: "2025–26 Season",
        start_date: "2025-09-01",
        end_date: "2026-04-01",
        status: "archived",
      },
    ];
  if (url.pathname.endsWith("/rpc/list_events"))
    return [
      {
        id: eventId,
        season_id: season,
        name: "Autumn Club Championship",
        event_type: "tournament",
        start_date: "2026-09-01",
        end_date: "2026-09-15",
        location: "Main rink",
        timezone: "America/Toronto",
        archived_at: null,
      },
    ];
  if (url.pathname.endsWith("/rpc/list_team_hierarchy_games"))
    return [
      game(1, "Team Benning"),
      game(2, "Team Wright", { event_id: eventId, scheduled_start: at(2) }),
      game(3, "Team Epping", { scheduled_start: at(-1) }),
      game(4, "Opponent TBD", { scheduled_start: null, opponent_id: null }),
      game(5, "Team Gushue", {
        game_status: "completed",
        scheduled_start: at(-2),
        completion_result: {
          outcome: "home_win",
          label: "Home win",
          totals: { home: 7, away: 5 },
          ends: [],
        },
        youtube_watch_url: "https://www.youtube.com/watch?v=abcdefghijk",
      }),
      game(6, "Cancelled game", {
        game_status: "completed",
        completion_result: {
          outcome: "no_result",
          label: "No result",
          totals: null,
          ends: [],
        },
      }),
      game(7, "Historical closed", {
        game_status: "closed",
        scheduled_start: at(-3),
      }),
      game(8, "Broadcast opponent", { scheduled_start: at(-1) }),
      game(9, "Last season opponent", {
        season_id: previous,
        game_status: "completed",
        completion_result: {
          outcome: "tie",
          label: "Tie",
          totals: { home: 4, away: 4 },
          ends: [],
        },
      }),
    ];
  if (url.pathname === "/rest/v1/broadcast_sessions") {
    if (
      url.searchParams.get("organization_id") !==
        "eq.22222222-2222-4222-8222-222222222222" ||
      url.searchParams.get("provider") !== "eq.youtube" ||
      !url.searchParams.has("game_id")
    )
      return null;
    return [
      {
        game_id: id(8),
        status: "live",
        watch_url: "https://www.youtube.com/watch?v=liveabcdefgh",
        updated_at: new Date().toISOString(),
      },
    ];
  }
  return null;
}
