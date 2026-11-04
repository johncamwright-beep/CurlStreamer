import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { defaultTeamPageSettings } from "@/lib/team-page-settings";
const m = vi.hoisted(() => ({
  settings: vi.fn(),
  rows: [] as unknown[],
  organization: "team-a",
  signed: vi.fn(),
  upload: vi.fn(),
  upsert: vi.fn(),
  queries: [] as [string, string, unknown][],
}));
vi.mock("./team-settings", () => ({ readTeamSettings: m.settings }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        upsert: m.upsert,
        eq: (column: string, value: unknown) => {
          m.queries.push([table, column, value]);
          return query;
        },
        single: async () => ({
          data: { organization_id: m.organization },
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: m.rows, error: null }).then(resolve),
      };
      return query;
    },
    storage: {
      from: () => ({
        createSignedUrl: m.signed,
        upload: m.upload,
        list: async () => ({ data: [], error: null }),
      }),
    },
  }),
}));
import {
  normalizeCelebrationHeadshot,
  readCelebrationHeadshots,
  resolveCelebrationRosterPlayerForGame,
  saveCelebrationHeadshot,
  saveCelebrationCoachHeadshot,
  celebrationCoachId,
  coachHeadshotInputSchema,
} from "./celebration-headshots";
import { rosterPlayers } from "./player-contacts";
const settings = defaultTeamPageSettings("Team");
settings.roster.lead = "Alice";
const headshotId = "22222222-2222-4222-8222-222222222222";
const gameId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks();
  m.rows = [];
  m.queries = [];
  m.organization = "team-a";
  m.settings.mockResolvedValue({ settings });
  m.upload.mockResolvedValue({ error: null });
  m.upsert.mockResolvedValue({ error: null });
  m.signed.mockResolvedValue({
    data: { signedUrl: "https://test/signed/photo" },
    error: null,
  });
});
it("filters changed roster identities and cross-organization storage paths before signing", async () => {
  const player = rosterPlayers("team-a", settings)[0];
  m.rows = [
    {
      id: headshotId,
      roster_player_id: player.id,
      player_name: "Other player",
      storage_path: "team-a/old.png",
    },
    {
      id: headshotId,
      roster_player_id: player.id,
      player_name: player.name,
      storage_path: "team-b/photo.png",
    },
  ];
  expect((await readCelebrationHeadshots("team-a")).headshots).toEqual([]);
  expect(m.signed).not.toHaveBeenCalled();
  expect(m.queries).toContainEqual([
    "team_celebration_headshots",
    "organization_id",
    "team-a",
  ]);
});
it("signs only the exact current player's organization-scoped cutout for five minutes", async () => {
  const player = rosterPlayers("team-a", settings)[0];
  m.rows = [
    {
      id: headshotId,
      roster_player_id: player.id,
      player_name: player.name,
      storage_path: "team-a/photo.png",
    },
  ];
  expect((await readCelebrationHeadshots("team-a")).headshots[0]).toMatchObject(
    {
      id: headshotId,
      rosterPlayerId: player.id,
      playerName: "Alice",
      imageUrl: "https://test/signed/photo",
    },
  );
  expect(m.signed).toHaveBeenCalledWith("team-a/photo.png", 300);
});
it("requires a saved cutout and resolves only against the game's organization", async () => {
  m.organization = "team-b";
  const player = rosterPlayers("team-b", settings)[0];
  await expect(
    resolveCelebrationRosterPlayerForGame(gameId, player.id),
  ).rejects.toThrow("Upload a photo");
  m.rows = [
    {
      id: headshotId,
      roster_player_id: player.id,
      player_name: player.name,
      storage_path: "team-b/player.png",
    },
  ];
  expect(
    await resolveCelebrationRosterPlayerForGame(gameId, player.id),
  ).toMatchObject({
    playerId: player.id,
    playerName: "Alice",
    headshotUrl: "https://test/signed/photo",
  });
  await expect(
    resolveCelebrationRosterPlayerForGame(
      gameId,
      rosterPlayers("team-a", settings)[0].id,
    ),
  ).rejects.toThrow("Roster changed");
});
it("rejects a stale roster upload before processing or storing a photo", async () => {
  await expect(
    saveCelebrationHeadshot(
      "team-a",
      "b".repeat(64),
      new File(["bad"], "head.png", { type: "image/png" }),
    ),
  ).rejects.toThrow("Roster changed");
  expect(m.upload).not.toHaveBeenCalled();
});
it("rejects invalid, opaque and fully transparent PNG uploads", async () => {
  for (const alpha of [0, 1]) {
    const bytes = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha },
      },
    })
      .png()
      .toBuffer();
    await expect(
      normalizeCelebrationHeadshot(
        new File([new Uint8Array(bytes)], "head.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("visible head cutout");
  }
  await expect(
    normalizeCelebrationHeadshot(
      new File(["not png"], "head.png", { type: "image/png" }),
    ),
  ).rejects.toThrow();
});
it("normalizes a valid alpha PNG to a metadata-free 512px PNG", async () => {
  const bytes = await sharp({
    create: {
      width: 50,
      height: 50,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 20,
            height: 20,
            channels: 4,
            background: { r: 80, g: 100, b: 120, alpha: 1 },
          },
        },
        left: 15,
        top: 15,
      },
    ])
    .png()
    .toBuffer();
  const output = await normalizeCelebrationHeadshot(
    new File([new Uint8Array(bytes)], "head.png", { type: "image/png" }),
  );
  const meta = await sharp(output).metadata();
  expect(meta).toMatchObject({
    format: "png",
    width: 512,
    height: 512,
    hasAlpha: true,
  });
  expect(meta.exif).toBeUndefined();
});
it("adds one team-scoped coach identity without changing curling roster identities", async () => {
  const rosterBefore = rosterPlayers("team-a", settings);
  const id = celebrationCoachId("team-a");
  m.rows = [
    {
      id: headshotId,
      roster_player_id: id,
      player_name: "Coach Sample",
      storage_path: "team-a/coach.png",
      person_kind: "coach",
    },
  ];
  const library = await readCelebrationHeadshots("team-a");
  expect(library.players).toContainEqual({
    id,
    name: "Coach Sample",
    position: "Coach",
    kind: "coach",
  });
  expect(library.headshots[0]).toMatchObject({
    rosterPlayerId: id,
    playerName: "Coach Sample",
  });
  expect(rosterPlayers("team-a", settings)).toEqual(rosterBefore);
  expect(await resolveCelebrationRosterPlayerForGame(gameId, id)).toMatchObject(
    {
      playerId: id,
      playerName: "Coach Sample",
      headshotUrl: "https://test/signed/photo",
    },
  );
});
it("never resolves another organization's coach or a forged person role", async () => {
  m.rows = [
    {
      id: headshotId,
      roster_player_id: celebrationCoachId("team-b"),
      player_name: "Other coach",
      storage_path: "team-a/coach.png",
      person_kind: "coach",
    },
  ];
  expect((await readCelebrationHeadshots("team-a")).players).not.toContainEqual(
    expect.objectContaining({ position: "Coach" }),
  );
  await expect(
    resolveCelebrationRosterPlayerForGame(gameId, celebrationCoachId("team-b")),
  ).rejects.toThrow("Roster changed");
  m.rows = [
    {
      id: headshotId,
      roster_player_id: celebrationCoachId("team-a"),
      player_name: "Forged role",
      storage_path: "team-a/coach.png",
      person_kind: "admin",
    },
  ];
  await expect(readCelebrationHeadshots("team-a")).rejects.toThrow();
});
it("rejects arbitrary coach IDs and invalid names before upload", async () => {
  const file = new File(["bad"], "coach.png", { type: "image/png" });
  await expect(
    saveCelebrationCoachHeadshot(
      "team-a",
      {
        kind: "coach",
        playerName: "Coach Sample",
        playerId: celebrationCoachId("team-b"),
      },
      file,
    ),
  ).rejects.toThrow("does not belong");
  for (const name of [" ", "x".repeat(101)])
    expect(
      coachHeadshotInputSchema.safeParse({ kind: "coach", playerName: name })
        .success,
    ).toBe(false);
  expect(
    coachHeadshotInputSchema.safeParse({ kind: "owner", playerName: "Sample" })
      .success,
  ).toBe(false);
  expect(m.upload).not.toHaveBeenCalled();
});
it("derives coach identity server-side and stores its approved private cutout", async () => {
  const bytes = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 16,
            height: 16,
            channels: 4,
            background: { r: 200, g: 100, b: 50, alpha: 1 },
          },
        },
        left: 8,
        top: 8,
      },
    ])
    .png()
    .toBuffer();
  await saveCelebrationCoachHeadshot(
    "team-a",
    { kind: "coach", playerName: "  Coach Sample  " },
    new File([new Uint8Array(bytes)], "coach.png", { type: "image/png" }),
  );
  expect(m.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      organization_id: "team-a",
      roster_player_id: celebrationCoachId("team-a"),
      player_name: "Coach Sample",
      person_kind: "coach",
      storage_path: expect.stringMatching(/^team-a\/[a-f0-9-]+\.png$/),
    }),
    { onConflict: "organization_id,roster_player_id" },
  );
});
