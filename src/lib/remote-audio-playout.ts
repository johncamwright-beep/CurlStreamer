/** Chromium needs a playing media element to drive remote WebRTC audio decoding.
 * It stays muted: the shared WebAudio graph is the only audible program output. */
export function createRemoteAudioPlayout(stream: MediaStream) {
  const element = document.createElement("audio");
  element.muted = true;
  element.srcObject = stream;
  return {
    start: () =>
      element.paused
        ? element.play().catch(() => undefined)
        : Promise.resolve(),
    stop() {
      element.pause();
      element.srcObject = null;
    },
  };
}
