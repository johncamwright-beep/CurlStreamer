import { afterEach, describe, expect, it, vi } from "vitest";
import { createM4ProgramPresentation } from "./m4-program-presentation";

afterEach(() => vi.useRealTimers());
describe("private program presentation", () => {
  it("retains a held picture through preparation and restores hold on cancel", async () => {
    const control = createM4ProgramPresentation(() => true);
    const held = control.set("hold");
    control.acknowledge("current", 1);
    await held;
    const prepared = control.set("preparing-end");
    expect(control.snapshot()).toMatchObject({
      mode: "preparing-end",
      holdPicture: true,
    });
    expect(control.closing()).toBe(false);
    control.acknowledge("current", 2);
    await prepared;
    const cancelled = control.set("live");
    control.acknowledge("current", 3);
    await expect(cancelled).resolves.toMatchObject({ mode: "hold" });
  });
  it("preparing cannot extend authority or assert a final result", async () => {
    const control = createM4ProgramPresentation(() => true);
    const prepared = control.set("preparing-end");
    control.acknowledge("current", 1);
    await prepared;
    expect(control.closing()).toBe(false);
    expect(control.snapshot().completion).toBeUndefined();
  });
  it("rejects old-document and old-generation acknowledgements", async () => {
    let instance = "first";
    const control = createM4ProgramPresentation((value) => value === instance);
    const held = control.set("hold");
    expect(control.acknowledge("other", 1)).toBe(false);
    expect(control.acknowledge("first", 0)).toBe(false);
    instance = "reloaded";
    expect(control.snapshot().mode).toBe("hold");
    expect(control.acknowledge("first", 1)).toBe(false);
    expect(control.acknowledge("reloaded", 1)).toBe(true);
    await expect(held).resolves.toMatchObject({ mode: "hold", generation: 1 });
  });
  it("keeps hold sticky when paint confirmation times out", async () => {
    vi.useFakeTimers();
    const control = createM4ProgramPresentation(() => true);
    const result = expect(control.set("hold")).rejects.toThrow(
      "presentation_paint_unconfirmed",
    );
    await vi.advanceTimersByTimeAsync(5001);
    await result;
    expect(control.snapshot().mode).toBe("hold");
  });
  it("cannot allow a delayed hold receipt to supersede resume", async () => {
    const control = createM4ProgramPresentation(() => true);
    const rejected = expect(control.set("hold")).rejects.toThrow(
      "presentation_superseded",
    );
    const resumed = control.set("live");
    expect(control.acknowledge("current", 1)).toBe(false);
    expect(control.acknowledge("current", 2)).toBe(true);
    await rejected;
    await expect(resumed).resolves.toMatchObject({ mode: "live" });
  });
  it("bounds closing and requires a committed completion snapshot", async () => {
    vi.useFakeTimers();
    const control = createM4ProgramPresentation(() => true);
    await expect(control.set("ended")).rejects.toThrow();
    const completion = {
      homeName: "Home",
      awayName: "Away",
      eventName: "League",
      result: {
        outcome: "home_win" as const,
        label: "Home wins",
        totals: { home: 5, away: 3 },
      },
    };
    await expect(
      control.set("ended", completion, Date.now() + 31000),
    ).rejects.toThrow("closing_deadline_invalid");
    const result = control.set("ended", completion, Date.now() + 15000);
    control.acknowledge("current", 1);
    await result;
    expect(control.closing()).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(control.closing()).toBe(false);
  });
  it("counts dwell from paint and rejects a renderer replacement", async () => {
    vi.useFakeTimers();
    let current = true;
    const control = createM4ProgramPresentation(() => current);
    const held = control.set("hold");
    control.acknowledge("current", 1);
    await held;
    const result = expect(control.dwell()).rejects.toThrow(
      "presentation_superseded",
    );
    current = false;
    await vi.advanceTimersByTimeAsync(5000);
    await result;
  });
});
