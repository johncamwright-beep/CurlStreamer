import { afterEach, expect, it, vi } from "vitest";
import { generateShotTrackerNarrative } from "./shot-tracker-ai";
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));
import { setTimeout as delay } from "node:timers/promises";
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
  vi.restoreAllMocks();
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
  expect(body.max_output_tokens).toBe(3200);
  const schema = body.text.format.schema;
  const resolve = (node: Record<string, any>): Record<string, any> =>
    node.$ref ? resolve(schema.$defs[node.$ref.split("/").pop()]) : node;
  expect(resolve(schema.properties.practice).maxItems).toBe(2);
  expect(body.text.format.strict).toBe(true);
  expect(
    resolve(resolve(schema.properties.summary).properties.text).pattern,
  ).toBe("^[^0-9<>]*$");
  expect(body.input).not.toContain("PRIVATE NAME");
  expect(body.instructions).toContain("No player names");
  expect(
    resolve(
      resolve(resolve(schema.properties.summary).properties.evidence).items,
    ).enum,
  ).toEqual(["overall"]);
  expect(JSON.stringify(schema).match(/"enum":\["overall"\]/g)).toHaveLength(1);
});
function generated(text: string, evidence = "overall") {
  const finding = { text, evidence: [evidence] };
  return Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              summary: finding,
              strengths: [finding],
              priorities: [finding],
              practice: [finding],
              review: [finding],
            }),
          },
        ],
      },
    ],
  });
}
it("repairs rejected collective prose once without resending rejected content", async () => {
  configure();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      generated("A player needs PRIVATE REJECTED COMMENTARY."),
    )
    .mockResolvedValueOnce(generated("Our team can practise shared targets."));
  vi.stubGlobal("fetch", fetcher);
  const result = await generateShotTrackerNarrative(input, "team", []);
  expect(result.summary.text).toBe("Our team can practise shared targets.");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const retry = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(retry.instructions).toContain("Individual commentary in team report");
  expect(JSON.stringify(retry)).not.toContain("PRIVATE REJECTED COMMENTARY");
  expect(fetcher.mock.calls[0][1].signal).toBe(fetcher.mock.calls[1][1].signal);
});
it("bounds validation repair and still rejects unsupported evidence", async () => {
  configure();
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(generated("Our team can practise.", "invented")),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(generateShotTrackerNarrative(input, "team", [])).rejects.toThrow(
    "Unknown evidence",
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "insufficient_quota",
])("classifies %s without exposing upstream details", async (code) => {
  configure();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code, message: "private account details" } },
          { status: 429 },
        ),
      ),
  );
  await expect(generateShotTrackerNarrative(input, "team", [])).rejects.toThrow(
    "Report provider unavailable",
  );
  expect(log).toHaveBeenCalledWith("Shot Tracker AI request failed", {
    status: 429,
    code,
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "private account details",
  );
});
it("honors temporary throttling delays and bounds retries", async () => {
  configure();
  const throttled = () =>
    Response.json(
      { error: { code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": "2" } },
    );
  const fetcher = vi
    .fn()
    .mockImplementationOnce(throttled)
    .mockResolvedValueOnce(generated("Our team can practise shared targets."));
  vi.stubGlobal("fetch", fetcher);
  await generateShotTrackerNarrative(input, "team", []);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(vi.mocked(delay).mock.calls.at(-1)?.[0]).toBeGreaterThanOrEqual(2000);
  fetcher.mockReset().mockImplementation(throttled);
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(generateShotTrackerNarrative(input, "team", [])).rejects.toThrow(
    "Report provider unavailable",
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("defers long server waits and does not retry canceled requests", async () => {
  configure();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { error: { code: "rate_limit_exceeded" } },
        { status: 429, headers: { "Retry-After": "120" } },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(generateShotTrackerNarrative(input, "team", [])).rejects.toThrow(
    "Report provider unavailable",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const aborted = AbortSignal.abort();
  await expect(
    generateShotTrackerNarrative(input, "team", [], aborted),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not expose upstream failures or accept truncated responses", async () => {
  configure();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
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
  expect(log).toHaveBeenCalledWith("Shot Tracker AI request failed", {
    status: 500,
    code: "unavailable",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "private credential details",
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
