import { afterEach, expect, it, vi } from "vitest";

const mixes: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
vi.mock("./program-usb-mix", () => ({
  createProgramUsbMix: vi.fn(() => {
    const mix = { input: {} as AudioNode, disconnect: vi.fn() };
    mixes.push(mix);
    return mix;
  }),
}));

import { acquireProgramAudioOutput } from "./program-audio-output";

afterEach(() => {
  vi.unstubAllGlobals();
  mixes.length = 0;
});

it("keeps the shared program output alive until the last phone or USB source releases it", () => {
  const close = vi.fn().mockResolvedValue(undefined);
  const AudioContext = vi.fn(() => ({ close }));
  vi.stubGlobal("AudioContext", AudioContext);

  const first = acquireProgramAudioOutput();
  const second = acquireProgramAudioOutput();

  expect(first.context).toBe(second.context);
  first.release();
  first.release();
  expect(close).not.toHaveBeenCalled();
  expect(mixes[0].disconnect).not.toHaveBeenCalled();

  second.release();
  expect(mixes[0].disconnect).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
