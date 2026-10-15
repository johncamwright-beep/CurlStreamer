import { dashboardResponse } from "./dashboard-fixtures.mjs";

// Isolated Supabase fixture only: real app routes perform authentication,
// review/confirmation and server projection reads against these test records.
const fixtures = new Map();
const administrator = "11111111-1111-4111-8111-111111111111";
const result = {
  outcome: "home_win",
  label: "Home win",
  totals: { home: 6, away: 3 },
  ends: [],
};

export async function dashboardFixtureResponse(request, url) {
  if (url.pathname === "/__dashboard-completion-fixture") {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw || "{}");
    if (request.method === "DELETE") fixtures.delete(input.seasonId);
    else if (request.method === "POST") {
      const config = {
        homeName: "Northern Ontario Curling Club",
        awayName: "Refresh regression opponent",
        homeColor: "#ef4444",
        awayColor: "#3b82f6",
        eventName: "Refresh regression event",
        scheduledEnds: 8,
        initialHammer: "home",
        youtubeTitle: "Mock dashboard regression",
        youtubeVisibility: "unlisted",
        ...input.config,
      };
      fixtures.set(input.seasonId, {
        ...input,
        game: {
          id: input.gameId,
          season_id: input.seasonId,
          event_id: input.eventId,
          opponent_id: input.gameId,
          game_number: 1,
          scheduled_start: new Date(
            Date.now() + input.days * 86400000,
          ).toISOString(),
          schedule_timezone: "America/Toronto",
          created_at: new Date().toISOString(),
          game_status: "active",
          youtube_scheduled_status: input.youtubeScheduledStatus,
          youtube_scheduled_watch_url: input.youtubeScheduledWatchUrl,
          config,
        },
      });
    }
    return { status: 200, body: { ok: true } };
  }

  const base = dashboardResponse(url);
  const records = [...fixtures.values()];
  if (base !== null) {
    let added = [];
    if (url.pathname.endsWith("/rpc/list_seasons"))
      added = records.map((f) => ({
        id: f.seasonId,
        name: "Refresh regression season",
        start_date: "2026-09-01",
        end_date: "2027-04-01",
        status: f.seasonStatus ?? "archived",
      }));
    if (url.pathname.endsWith("/rpc/list_events"))
      added = records.map((f) => ({
        id: f.eventId,
        season_id: f.seasonId,
        name: "Refresh regression event",
        event_type: "tournament",
        start_date: "2026-09-01",
        end_date: "2027-04-01",
        location: "Mock rink",
        timezone: "America/Toronto",
        archived_at: null,
      }));
    if (url.pathname.endsWith("/rpc/list_team_hierarchy_games"))
      added = records.map((f) => f.game);
    return { status: 200, body: [...base, ...added] };
  }
  if (!url.pathname.startsWith("/rest/v1/rpc/")) return null;
  const operation = url.pathname.split("/").at(-1);
  const supported = [
    "list_team_games",
    "read_game_state",
    "read_game_team_logo",
    "review_game_completion_with_link",
    "complete_reviewed_game",
    "read_game_completion_summary",
    "get_game_completion_cleanup",
  ];
  if (!supported.includes(operation)) return null;
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const input = JSON.parse(raw || "{}");
  if (operation === "list_team_games")
    return {
      status: 200,
      body:
        input.p_user_id === administrator
          ? records.map((f) => ({
              game_id: f.game.id,
              game_status: f.game.game_status,
            }))
          : [],
    };
  const fixture = records.find((f) => f.game.id === input.p_game_id);
  if (operation === "read_game_team_logo") return { status: 200, body: null };
  if (!fixture) return null;
  const game = fixture.game;
  if (operation === "read_game_state")
    return {
      status: 200,
      body: [
        {
          outcome: game.game_status === "completed" ? "closed" : "active",
          scheduled_start: game.scheduled_start,
          schedule_timezone: game.schedule_timezone,
          state: {
            id: game.id,
            config: game.config,
            createdAt: Date.now(),
            scoreEvents: [],
            layout: "split",
            broadcast: "idle",
            status: "active",
            audioMuted: false,
            connections: {
              "camera-home": false,
              "camera-away": false,
              scorer: false,
            },
            claims: {},
            sponsors: [],
            sponsorMode: {
              active: false,
              style: "overlay",
              intervalSeconds: 10,
              startedAt: null,
              rotationOffset: 0,
              paused: false,
              mutedPrevious: false,
              muteDuring: false,
            },
          },
        },
      ],
    };
  if (operation === "read_game_completion_summary")
    return { status: 200, body: fixture.completion ?? null };
  if (
    input.p_actor_user_id !== administrator ||
    input.p_verified_organizer !== false
  )
    return {
      status: 403,
      body: { code: "42501", message: "Fixture administrator required" },
    };
  if (operation === "get_game_completion_cleanup")
    return {
      status: 200,
      body: [{ status: "complete", attempts: 1, last_error: null }],
    };
  if (operation === "review_game_completion_with_link") {
    fixture.review = {
      review_id: input.p_review_id,
      input_revision: 0,
      result,
      youtube_watch_url: input.p_youtube_watch_url,
    };
    return { status: 200, body: [fixture.review] };
  }
  if (!fixture.review || fixture.review.review_id !== input.p_review_id)
    return { status: 409, body: { code: "PT409", message: "Review required" } };
  game.game_status = "completed";
  game.completion_result = result;
  fixture.completion = {
    status: "completed",
    eventName: game.config.eventName,
    homeName: game.config.homeName,
    awayName: game.config.awayName,
    result,
    youtubeWatchUrl: null,
    completedAt: new Date().toISOString(),
  };
  return {
    status: 200,
    body: [
      {
        ...fixture.review,
        completion_id: input.p_completion_id,
        completed_at: fixture.completion.completedAt,
        cleanup_status: "complete",
      },
    ],
  };
}
