export const maxCoachClipBytes = 40 * 1024 * 1024;

/** Read the bounded OBS MP4 movie header without loading a decoder or polling a service. */
export function coachMp4Duration(bytes: Buffer): number {
  function boxes(
    start: number,
    end: number,
    movie = false,
  ): number | undefined {
    let offset = start;
    while (offset + 8 <= end) {
      const size = bytes.readUInt32BE(offset);
      if (size < 8 || offset + size > end)
        throw Error("Invalid coach recording");
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      const payload = offset + 8;
      if (type === "moov" && !movie) return boxes(payload, offset + size, true);
      if (type === "mvhd" && movie) {
        const version = bytes[payload];
        const required = version === 1 ? 32 : 20;
        if (version > 1 || size - 8 < required)
          throw Error("Invalid coach duration");
        const scale = bytes.readUInt32BE(payload + (version === 1 ? 20 : 12));
        const ticks =
          version === 1
            ? Number(bytes.readBigUInt64BE(payload + 24))
            : bytes.readUInt32BE(payload + 16);
        const seconds = ticks / scale;
        if (
          !scale ||
          !Number.isFinite(seconds) ||
          seconds <= 0 ||
          seconds > 125
        )
          throw Error("Invalid coach duration");
        return seconds;
      }
      offset += size;
    }
    return undefined;
  }
  if (bytes.length > maxCoachClipBytes)
    throw Error("Coach recording too large");
  const duration = boxes(0, bytes.length);
  if (!duration) throw Error("Coach recording has no duration");
  return duration;
}
