const sampleRate = 48_000;
const maxQueuedBytes = (sampleRate / 2) * Float32Array.BYTES_PER_ELEMENT;

/** A short-lived mono PCM transport. It deliberately has no persistence: a
 * slow or disconnected renderer loses oldest audio instead of adding delay. */
export function createM4UsbAudioQueue() {
  let chunks: Buffer[] = [];
  let bytes = 0;
  let generation = 0;
  let pushedPackets = 0,
    pushedSamples = 0,
    drainedPackets = 0,
    drainedSamples = 0;
  let peak = 0,
    square = 0,
    observedSamples = 0;

  const reset = () => {
    for (const chunk of chunks) chunk.fill(0);
    chunks = [];
    bytes = 0;
    generation++;
  };
  const push = (pcm: Buffer) => {
    if (!pcm.length) return reset();
    if (pcm.length % Float32Array.BYTES_PER_ELEMENT)
      throw new Error("invalid_pcm");
    for (
      let index = 0;
      index < pcm.length;
      index += Float32Array.BYTES_PER_ELEMENT
    ) {
      const value = pcm.readFloatLE(index);
      if (!Number.isFinite(value)) throw new Error("invalid_pcm");
      peak = Math.max(peak, Math.abs(value));
      square += value * value;
      observedSamples++;
    }
    pushedPackets++;
    pushedSamples += pcm.length / Float32Array.BYTES_PER_ELEMENT;
    chunks.push(Buffer.from(pcm));
    bytes += pcm.length;
    while (bytes > maxQueuedBytes && chunks.length) {
      const oldest = chunks.shift()!;
      bytes -= oldest.length;
      oldest.fill(0);
    }
  };
  const drain = () => {
    if (!chunks.length) return { generation, pcm: Buffer.alloc(0) };
    const pcm = Buffer.concat(chunks);
    drainedPackets++;
    drainedSamples += pcm.length / Float32Array.BYTES_PER_ELEMENT;
    chunks = [];
    bytes = 0;
    return { generation, pcm };
  };
  const snapshot = () => ({
    pushedPackets,
    pushedSamples,
    drainedPackets,
    drainedSamples,
    peak,
    rms: observedSamples ? Math.sqrt(square / observedSamples) : 0,
  });
  return { push, drain, reset, snapshot };
}
