import { expect, it } from "vitest";
import { selectPhoneAudioTrack } from "./phone-audio-track";

it("reuses a warm microphone, then the live published track, across remote audio polls", async () => {
  const microphone = {
    kind: "audio",
    readyState: "live",
    enabled: false,
  } as unknown as MediaStreamTrack;

  const first = selectPhoneAudioTrack(undefined, microphone);
  expect(first).toEqual({ track: microphone, alreadyPublished: false });

  microphone.enabled = true;
  const laterPoll = selectPhoneAudioTrack(microphone, undefined);
  expect(laterPoll).toEqual({ track: microphone, alreadyPublished: true });
});
