import { expect, it } from "vitest";
import { localLaptopAddress, localClipSchema } from "./local-clip";
it("allows only private laptop HTTP addresses without credentials or paths", () => {
  expect(localLaptopAddress("http://192.168.8.188:3189")).toBe(
    "http://192.168.8.188:3189",
  );
  for (const address of [
    "https://192.168.8.188:3189",
    "http://example.com",
    "http://8.8.8.8",
    "http://user:pass@192.168.1.2",
    "http://192.168.1.2/path",
    "http://192.168.1.2?token=x",
  ])
    expect(() => localLaptopAddress(address)).toThrow();
});
it("bounds clip metadata to the last two minutes of one identified game", () => {
  const clip = {
    gameId: "11111111-1111-4111-8111-111111111111",
    duration: 125,
    minimum: 5,
    capturedAt: "2026-11-10T15:00:00.000Z",
  };
  expect(localClipSchema.safeParse(clip).success).toBe(true);
  for (const changes of [
    { minimum: 0 },
    { duration: 126 },
    { gameId: "other" },
    { minimum: 125 },
    { capturedAt: "invalid" },
  ])
    expect(localClipSchema.safeParse({ ...clip, ...changes }).success).toBe(
      false,
    );
});
