import { afterEach, expect, it, vi } from "vitest";
import { generateShotTrackerNarrative } from "./shot-tracker-ai";
const input = {
  key: "team",
  title: "PRIVATE NAME",
  evidence: [
    {
      id: "overall",
      label: "Shooting",
      value: "75%",
      sample: 40,
      confidence: "event" as const,
    },
  ],
  limitations: [],
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function configure() {
  vi.stubEnv("SHOT_TRACKER_AI_ENABLED", "true");
  vi.stubEnv("SHOT_TRACKER_AI_MODEL", "configured-test-model");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
}
it("sends only aggregate evidence to a fixed server provider and validates structured output", async () => {
  configure();
  const f = {
    text: "Our team can repeat the target drill.",
    evidence: ["overall"],
  };
  const narrative = {
    summary: f,
    strengths: [f],
    priorities: [f],
    practice: [f],
    review: [f],
  };
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(narrative) }],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await generateShotTrackerNarrative(input, "team", [])).toEqual(
    narrative,
  );
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/responses");
  const body = JSON.parse(init.body);
  expect(body.store).toBe(false);
  expect(body.text.format.strict).toBe(true);
  expect(body.input).not.toContain("PRIVATE NAME");
  expect(body.instructions).toContain("No player names");
});
it("does not expose upstream failures or accept truncated responses", async () => {
  configure();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("private credential details", { status: 500 }),
      ),
  );
  await expect(generateShotTrackerNarrative(input, "team", [])).rejects.toThrow(
    "Report provider unavailable",
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(Response.json({ status: "incomplete", output: [] })),
  );
  await expect(generateShotTrackerNarrative(input, "team", [])).rejects.toThrow(
    "incomplete",
  );
});
