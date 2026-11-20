import { expect, it, vi } from "vitest";
const admin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/providers/platform-admin", () => ({
  platformAdminContext: admin,
}));
import { GET } from "./route";

it.each([true, false])(
  "reports server-confirmed admin visibility: %s",
  async (allowed) => {
    admin.mockResolvedValueOnce(allowed ? { id: "admin" } : null);
    const response = await GET();
    expect(await response.json()).toEqual({ platformAdmin: allowed });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  },
);
it("hides administration when the permission check fails", async () => {
  admin.mockRejectedValueOnce(new Error("unavailable"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ platformAdmin: false });
});
