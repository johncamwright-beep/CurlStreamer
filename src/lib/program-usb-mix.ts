/** Remove low rumble and balance speech before the final peak protection. */
export function createProgramUsbMix(context: BaseAudioContext) {
  const input = context.createGain();
  const lowCut = context.createBiquadFilter();
  lowCut.type = "highpass";
  lowCut.frequency.value = 80;
  // Web Audio expresses high-pass Q in dB; this is a non-resonant Butterworth.
  lowCut.Q.value = 20 * Math.log10(Math.SQRT1_2);
  const speech = context.createDynamicsCompressor();
  speech.threshold.value = -28;
  speech.knee.value = 12;
  speech.ratio.value = 4;
  speech.attack.value = 0.005;
  speech.release.value = 0.25;
  // Lift quiet speech after compression, so loud inputs do not get the full lift.
  const makeup = context.createGain();
  makeup.gain.value = 2;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -6;
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
      (magnitude <= 0.8
        ? magnitude
        : 0.8 + 0.08 * Math.tanh((magnitude - 0.8) / 0.08));
  }
  safety.curve = curve;
  input.connect(lowCut);
  lowCut.connect(speech);
  speech.connect(makeup);
  makeup.connect(compressor);
  compressor.connect(safety);
  safety.connect(context.destination);
  return {
    input,
    disconnect() {
      input.disconnect();
      lowCut.disconnect();
      speech.disconnect();
      makeup.disconnect();
      compressor.disconnect();
      safety.disconnect();
    },
  };
}
