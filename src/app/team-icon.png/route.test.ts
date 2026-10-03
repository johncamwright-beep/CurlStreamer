import { beforeEach, describe, expect, it, vi } from "vitest";

const { headers, readFile, readPublishedTeamProfile, sharp } = vi.hoisted(
  () => ({
    headers: vi.fn(),
    readFile: vi.fn(),
    readPublishedTeamProfile: vi.fn(),
    sharp: vi.fn(),
  }),
);

vi.mock("next/headers", () => ({ headers }));
vi.mock("node:fs/promises", () => ({ readFile }));
vi.mock("@/lib/providers/public-team-profile", () => ({
  readPublishedTeamProfile,
}));
vi.mock("sharp", () => ({ default: sharp }));

import { GET } from "./route";

function configureSharp() {
  sharp.mockImplementation((input: Buffer) => ({
    metadata: () =>
      input.toString() === "invalid"
        ? Promise.reject(new Error("invalid image"))
        : Promise.resolve({}),
    resize: () => ({
      png: () => ({ toBuffer: () => Promise.resolve(Buffer.from("png")) }),
    }),
  }));
}

describe("team favicon route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    headers.mockResolvedValue({
      get: (name: string) =>
        name === "host" ? "benning.curlstreamer.app" : null,
    });
    readFile.mockResolvedValue(Buffer.from("fallback"));
    readPublishedTeamProfile.mockResolvedValue({ logo_url: null });
    configureSharp();
  });

  it("uses the branded fallback when a streamed upload exceeds the size cap", async () => {
    readPublishedTeamProfile.mockResolvedValue({
      logo_url:
        "https://project.supabase.co/storage/v1/object/public/team-public-media/benning/logo",
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
              controller.enqueue(new Uint8Array(1));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from("png"),
    );
    expect(
      sharp.mock.calls.some(
        ([input]) => Buffer.from(input).toString() === "fallback",
      ),
    ).toBe(true);
  });

  it("uses the branded fallback when an upload cannot be decoded", async () => {
    readPublishedTeamProfile.mockResolvedValue({
      logo_url:
        "https://project.supabase.co/storage/v1/object/public/team-public-media/benning/logo",
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid", { status: 200 })),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from("png"),
    );
    expect(
      sharp.mock.calls.filter(
        ([input]) => Buffer.from(input).toString() === "invalid",
      ),
    ).toHaveLength(1);
  });
});
