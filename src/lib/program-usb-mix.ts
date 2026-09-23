/** Lift quiet speech and reduce shouting before the final peak protection. */
export function createProgramUsbMix(context: BaseAudioContext) {
  const input = context.createGain();
  input.gain.value = 4; // 12 dB speech lift, independent of the number of microphones.
  const speech = context.createDynamicsCompressor();
  speech.threshold.value = -22;
  speech.knee.value = 12;
  speech.ratio.value = 6;
  speech.attack.value = 0.005;
  speech.release.value = 0.35;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -3;
  compressor.knee.value = 0;
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
  input.connect(speech);
  speech.connect(compressor);
  compressor.connect(safety);
  safety.connect(context.destination);
  return {
    input,
    disconnect() {
      input.disconnect();
      speech.disconnect();
      compressor.disconnect();
      safety.disconnect();
    },
  };
}
