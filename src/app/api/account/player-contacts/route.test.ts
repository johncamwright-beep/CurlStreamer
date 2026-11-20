import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  coaches: vi.fn(),
  saveCoaches: vi.fn(),
}));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: m.account,
}));
vi.mock("@/lib/providers/player-contacts", async (original) => ({
  ...(await original<typeof import("@/lib/providers/player-contacts")>()),
  currentPlayerContacts: m.read,
  savePlayerContact: m.save,
  readCoachContacts: m.coaches,
  saveCoachContacts: m.saveCoaches,
}));
import { GET, PUT } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  m.account.mockResolvedValue({ organizationId: "authorized-team" });
  m.read.mockResolvedValue([]);
  m.coaches.mockResolvedValue(["", ""]);
});
const put = (body: unknown, origin = "https://www.curlstreamer.app") =>
  PUT(
    new Request("https://www.curlstreamer.app/api/account/player-contacts", {
      method: "PUT",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
it("requires team administrator context for reading and writing private contacts", async () => {
  m.account.mockResolvedValue(null);
  expect((await GET()).status).toBe(403);
  expect(
    (await put({ playerId: "a".repeat(64), email: "p@example.com" })).status,
  ).toBe(403);
  expect(m.account).toHaveBeenCalledWith(true);
  expect(m.read).not.toHaveBeenCalled();
  expect(m.save).not.toHaveBeenCalled();
});
it("rejects cross-origin writes and arbitrary organization fields", async () => {
  const input = { playerId: "a".repeat(64), email: "p@example.com" };
  expect((await put(input, "https://other.example")).status).toBe(403);
  expect((await put({ ...input, organizationId: "other" })).status).toBe(400);
  expect(m.save).not.toHaveBeenCalled();
  expect((await put(input)).status).toBe(200);
  expect(m.save).toHaveBeenCalledWith("authorized-team", input);
  expect((await GET()).headers.get("cache-control")).toBe("private, no-store");
});
it("saves parent and exactly two optional coach addresses in the authorized team", async () => {
  const player = {
    playerId: "a".repeat(64),
    email: "",
    parentEmail: "parent@example.com",
  };
  expect((await put(player)).status).toBe(200);
  expect(m.save).toHaveBeenCalledWith("authorized-team", player);
  const coaches = { kind: "coaches", emails: ["coach@example.com", ""] };
  expect((await put(coaches)).status).toBe(200);
  expect(m.saveCoaches).toHaveBeenCalledWith("authorized-team", coaches.emails);
  for (const invalid of [
    { ...player, parentEmail: "invalid" },
    { ...coaches, emails: ["a@example.com", "b@example.com", "c@example.com"] },
    { ...coaches, organizationId: "other" },
  ])
    expect((await put(invalid)).status).toBe(400);
});
