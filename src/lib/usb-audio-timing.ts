const leadSeconds = 0.12;
const maximumAheadSeconds = 0.35;

/** Keep PCM packets contiguous through ordinary delivery jitter. Only rebuffer
 * after a real underrun or excessive backlog, never at every packet boundary. */
export function usbAudioStart(nextAt: number, now: number) {
  const reset = nextAt > now + maximumAheadSeconds;
  const rebuffer = reset || nextAt < now + 0.005;
  return { reset, rebuffer, at: rebuffer ? now + leadSeconds : nextAt };
}
