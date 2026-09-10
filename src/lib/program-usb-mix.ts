/** Preserve quiet speech; control peaks after summing the independent USB inputs. */
export function createProgramUsbMix(context: BaseAudioContext) {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -6;
  compressor.knee.value = 6;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;

  // A bounded safety stage catches attack transients. Normal levels remain linear.
  const safety = context.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    curve[i] =
      Math.sign(x) *
      (magnitude <= 0.9
        ? magnitude
        : 0.9 + 0.08 * Math.tanh((magnitude - 0.9) / 0.08));
  }
  safety.curve = curve;
  compressor.connect(safety);
  safety.connect(context.destination);
  return {
    input: compressor,
    disconnect() {
      compressor.disconnect();
      safety.disconnect();
    },
  };
}
