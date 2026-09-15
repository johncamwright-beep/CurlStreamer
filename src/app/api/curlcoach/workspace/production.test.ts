import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type State } from "@/lib/curlcoach/model";
import type { CoachEvent } from "@/lib/curlcoach/event";

const ids = {
  organization: "00000000-0000-4000-8000-000000000001",
  actor: "00000000-0000-4000-8000-000000000002",
  event: "00000000-0000-4000-8000-000000000003",
  game: "00000000-0000-4000-8000-000000000004",
  otherGame: "00000000-0000-4000-8000-000000000005",
};
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  productionSource: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  transition: vi.fn(),
  localRead: vi.fn(),
  localWrite: vi.fn(),
  localSource: vi.fn(),
}));

vi.mock("@/lib/curlcoach/access", () => ({
  labEnabled: () => false,
  sameOrigin: (request: Request) =>
    request.headers.get("origin") === "http://localhost",
  authorized: vi.fn(),
  sessionCookie: "curlcoach-lab-session",
}));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: mocks.account,
}));
vi.mock("@/lib/providers/curlcoach-production-streamer", () => ({
  loadProductionStreamerEvent: mocks.productionSource,
}));
vi.mock("@/lib/providers/curlcoach-store", () => ({
  loadCoachState: mocks.load,
  saveCoachState: mocks.save,
  transitionCoachState: mocks.transition,
}));
vi.mock("@/lib/providers/curlcoach-local", () => ({
  readCoachState: mocks.localRead,
  writeCoachEvent: mocks.localWrite,
}));
vi.mock("@/lib/providers/curlcoach-streamer", () => ({
  loadStreamerEvent: mocks.localSource,
}));

import { GET, POST } from "./route";

function state(): State {
  return {
    ...emptyState(),
    organizationId: ids.organization,
    gameId: ids.game,
    roster: [{ id: "player-1", name: "Taylor", position: "Lead" }],
  };
}
function workspace(): {
  event: CoachEvent;
  catalog: { id: string; name: string }[];
  actor: string;
} {
  return {
    actor: ids.actor,
    catalog: [{ id: ids.event, name: "Club night" }],
    event: {
      id: ids.event,
      name: "Club night",
      source: "streamer",
      organizationId: ids.organization,
      games: [
        {
          id: ids.game,
          eventId: ids.event,
          label: "Game 1",
          opponent: "Visitors",
          teamName: "Home",
          scheduledEnds: 8,
          status: "active",
          side: "home",
          initialHammer: "home",
          scoreboardAvailable: true,
          ends: [],
          roster: state().roster,
          state: state(),
        },
      ],
    },
  };
}
function request(body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/curlcoach/workspace", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}
function lifecycle(action: "finish" | "reopen", gameId = ids.game) {
  return {
    source: "streamer",
    eventId: ids.event,
    gameId,
    action,
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  mocks.account.mockResolvedValue({
    userId: ids.actor,
    organizationId: ids.organization,
  });
  mocks.productionSource.mockResolvedValue(workspace());
  mocks.load.mockResolvedValue(state());
  mocks.save.mockResolvedValue(state());
  mocks.transition.mockResolvedValue({
    ...state(),
    revision: 1,
    status: "closed",
  });
});
afterEach(() => vi.unstubAllEnvs());

it("denies an unentitled account before listing games or reading private state", async () => {
  mocks.account.mockResolvedValue(null);

  const response = await GET(
    new Request(
      `http://localhost/api/curlcoach/workspace?source=streamer&eventId=${ids.event}`,
    ),
  );

  expect(response.status).toBe(403);
  expect(mocks.productionSource).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.localRead).not.toHaveBeenCalled();
});

it("loads each production game from durable private storage, never the local lab", async () => {
  const response = await GET(
    new Request(
      `http://localhost/api/curlcoach/workspace?source=streamer&eventId=${ids.event}`,
    ),
  );

  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenCalledWith(
    {
      organizationId: ids.organization,
      gameId: ids.game,
      actorUserId: ids.actor,
    },
    expect.objectContaining({ gameId: ids.game }),
  );
  expect(mocks.localRead).not.toHaveBeenCalled();
  expect(mocks.localSource).not.toHaveBeenCalled();
  expect((await response.json()).event.source).toBe("streamer");
});

it("keeps production sample data unavailable", async () => {
  const response = await GET(
    new Request("http://localhost/api/curlcoach/workspace?source=sample"),
  );

  expect(response.status).toBe(503);
  expect(mocks.productionSource).not.toHaveBeenCalled();
  expect(mocks.localRead).not.toHaveBeenCalled();
});

it("finishes only the actor's private coaching session for the selected game", async () => {
  const payload = lifecycle("finish");
  const response = await POST(request(payload));

  expect(response.status).toBe(200);
  expect(mocks.transition).toHaveBeenCalledWith(
    {
      organizationId: ids.organization,
      gameId: ids.game,
      actorUserId: ids.actor,
    },
    expect.objectContaining({ gameId: ids.game }),
    "finish",
    payload.requestId,
    0,
  );
  expect(mocks.save).not.toHaveBeenCalled();
});

it("reopens only the actor's private coaching session for the selected game", async () => {
  mocks.transition.mockResolvedValue({
    ...state(),
    revision: 1,
    status: "open",
  });
  const payload = lifecycle("reopen");
  const response = await POST(request(payload));

  expect(response.status).toBe(200);
  expect(mocks.transition).toHaveBeenCalledWith(
    {
      organizationId: ids.organization,
      gameId: ids.game,
      actorUserId: ids.actor,
    },
    expect.anything(),
    "reopen",
    payload.requestId,
    0,
  );
});

it("rejects a cross-event game before loading or mutating its private state", async () => {
  const response = await POST(request(lifecycle("finish", ids.otherGame)));

  expect(response.status).toBe(403);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.transition).not.toHaveBeenCalled();
});

it("rejects cross-origin mutations before loading the production event", async () => {
  const response = await POST(
    request(lifecycle("finish"), "https://evil.example"),
  );

  expect(response.status).toBe(403);
  expect(mocks.productionSource).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.transition).not.toHaveBeenCalled();
});
