import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  correct: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/providers/completed-result", () => ({
  readCompletedResult: mocks.read,
  correctCompletedResult: mocks.correct,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { GET, PATCH } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const input = {
  requestId: "22222222-2222-4222-8222-222222222222",
  expectedRevision: 10,
  reason: "Scored end was recorded for the wrong team",
  ends: [{ end: 1, team: "away", points: 2, blank: false }],
};
const request = (body: unknown) =>
  new Request(`https://site.invalid/api/games/${id}/result`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
describe("completed result correction route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.read.mockResolvedValue({
      ok: true,
      value: { revision: 10, completion: {} },
    });
    mocks.correct.mockResolvedValue({
      ok: true,
      value: { revision: 11, completion: {} },
    });
  });
  it("returns noncacheable account-scoped snapshots and validates corrections before RPC", async () => {
    const read = await GET(new Request("https://site.invalid"), context);
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(read.headers.get("vary")).toBe("Cookie, Authorization");
    expect(
      (await PATCH(request({ ...input, actorUserId: id }), context)).status,
    ).toBe(400);
    expect(mocks.correct).not.toHaveBeenCalled();
    expect((await PATCH(request(input), context)).status).toBe(200);
    expect(mocks.correct).toHaveBeenCalledWith(id, input);
  });
  it("keeps denied and stale corrections distinct without provider teardown", async () => {
    for (const [kind, status] of [
      ["authorization", 403],
      ["conflict", 409],
      ["terminal", 409],
      ["service", 503],
    ]) {
      mocks.correct.mockResolvedValue({ ok: false, kind });
      expect((await PATCH(request(input), context)).status).toBe(status);
    }
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("does not turn a committed correction into failure when cache invalidation fails", async () => {
    mocks.revalidate.mockImplementation(() => {
      throw Error("cache unavailable");
    });
    const saved = await PATCH(request(input), context);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ revision: 11, completion: {} });
  });
});
