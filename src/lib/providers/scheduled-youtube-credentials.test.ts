import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));
import { getScheduledYouTubeCredentials } from "./scheduled-youtube-credentials";

const user = { id: "11111111-1111-4111-8111-111111111111" } as User;
const game = "22222222-2222-4222-8222-222222222222";
describe("scheduled game YouTube credentials", () => {
  beforeEach(() => rpc.mockReset());

  it("binds the credential request to the verified user and selected game", async () => {
    const credentials = {
      organization_id: "33333333-3333-4333-8333-333333333333",
      encrypted_credentials: "encrypted",
      channel_id: "channel",
      connection_version: 1,
    };
    rpc.mockResolvedValue({ data: [credentials], error: null });
    await expect(getScheduledYouTubeCredentials(user, game)).resolves.toEqual(
      credentials,
    );
    expect(rpc).toHaveBeenCalledWith("get_scheduled_youtube_credentials", {
      p_user_id: user.id,
      p_game_id: game,
    });
  });

  it("does not fall back to account credentials when game authorization fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(getScheduledYouTubeCredentials(user, game)).rejects.toThrow(
      "youtube_credentials_failed",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reports a missing connection without returning credentials", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getScheduledYouTubeCredentials(user, game)).rejects.toThrow(
      "youtube_reconnect_required",
    );
  });
});
