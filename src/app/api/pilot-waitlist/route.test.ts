import { beforeEach, describe, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
const scheduled = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => scheduled.push(fn),
}));
vi.mock("@/lib/providers/waitlist-notification", () => ({
  notifyWaitlistSignup: notify,
}));
vi.mock("@/lib/providers/pilot-waitlist", () => ({ savePilotInterest: save }));
import { POST } from "./route";
const body = {
  email: "TEST@example.com",
  team: "Example",
  consent: true,
  website: "",
};
const request = (data: unknown = body, origin = "https://curlstreamer.app") =>
  new Request("https://curlstreamer.app/api/pilot-waitlist", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-vercel-forwarded-for": "192.0.2.1",
    },
    body: JSON.stringify(data),
  });
describe("pilot waitlist", () => {
  beforeEach(() => {
    save.mockReset();
    save.mockResolvedValue("saved");
    scheduled.length = 0;
    notify.mockReset();
  });
  it("normalizes email and saves only opted-in interest", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(save).toHaveBeenCalledWith(
      "test@example.com",
      "Example",
      "192.0.2.1",
    );
  });
  it("rejects invalid emails and missing consent without storing anything", async () => {
    for (const data of [
      { ...body, email: "bad" },
      { ...body, consent: false },
    ])
      expect((await POST(request(data))).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects cross-origin submissions", async () => {
    expect(
      (await POST(request(body, "https://unrelated.example"))).status,
    ).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
  it("ignores honeypot submissions", async () => {
    expect((await POST(request({ ...body, website: "spam" }))).status).toBe(
      200,
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("reports throttling and persistence errors without claiming success", async () => {
    save.mockResolvedValueOnce("limited");
    expect((await POST(request())).status).toBe(429);
    save.mockRejectedValueOnce(new Error("secret database details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
  it("rejects oversized requests", async () => {
    expect(
      (await POST(request({ ...body, team: "x".repeat(5000) }))).status,
    ).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });
  it("schedules email after persistence and keeps signup success if notification fails", async () => {
    notify.mockRejectedValue(new Error("mail unavailable"));
    expect((await POST(request())).status).toBe(200);
    expect(notify).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await expect(scheduled[0]()).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith("test@example.com");
  });
  it("does not schedule notifications for spam or rate-limited submissions", async () => {
    await POST(request({ ...body, website: "spam" }));
    save.mockResolvedValue("limited");
    await POST(request());
    expect(scheduled).toHaveLength(0);
  });
});
