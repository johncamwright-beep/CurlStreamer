// Offline DSP fixtures: never opens a capture device or sends audio over a network.
using System;
using System.Diagnostics;

internal static class UsbAudioProcessingTests
{
    private static int Main(string[] args)
    {
        if (args.Length < 1 || args.Length > 2) throw new ArgumentException("Pass the absolute verified RNNoise DLL path and optionally a PCM16 mono 48 kHz speech WAV.");
        string dll = args[0];
        using (var missing = new UsbAudioProcessing(1, System.IO.Path.Combine(System.IO.Path.GetDirectoryName(dll), "missing.dll"))) {
            Require(!missing.NoiseReductionAvailable && !String.IsNullOrEmpty(missing.Error), "Missing DLL must be visibly unavailable.");
            missing.Configure("strong", 0);
            var input = new float[1]; var output = new float[1];
            for (int n = 0; n < 3000; n++) { input[0] = n == 0 ? 2f : 0f; missing.ProcessFrame(input, output); Require(output[0] == (n == UsbAudioProcessing.LatencyFrames ? 2f : 0f), "Unavailable RNNoise must preserve delayed dry headroom."); }
        }
        using (var processor = new UsbAudioProcessing(4, dll)) {
            Require(processor.NoiseReductionAvailable, processor.Error ?? "RNNoise unavailable.");
            var input = new float[4]; var output = new float[4];
            for (int n = 0; n < 4000; n++) {
                for (int c = 0; c < 4; c++) input[c] = n == 10 + c * 137 ? 1.5f + c : 0f;
                processor.ProcessFrame(input, output);
                for (int c = 0; c < 4; c++) Require(output[c] == (n == UsbAudioProcessing.LatencyFrames + 10 + c * 137 ? 1.5f + c : 0f), "Bypass delay/headroom/channel isolation.");
            }
            processor.Configure("strong", 60);
            for (int n = 0; n < 2500; n++) { for (int c = 0; c < 4; c++) input[c] = n % 2 == 0 ? Single.MaxValue : -Single.MaxValue; processor.ProcessFrame(input, output); for (int c = 0; c < 4; c++) Require(Finite(output[c]), "Extreme finite input poisoned output."); }
            processor.Configure("strong", 50);
            for (int n = 0; n < 2500; n++) { for (int c = 0; c < 4; c++) input[c] = c == 0 ? Single.NaN : Single.PositiveInfinity; processor.ProcessFrame(input, output); for (int c = 0; c < 4; c++) Require(Finite(output[c]), "Nonfinite input poisoned output."); }
            // Reset at a partial block discards both delayed dry and recurrent wet history.
            processor.Reset(); Array.Clear(input, 0, input.Length);
            for (int n = 0; n < 4000; n++) { processor.ProcessFrame(input, output); for (int c = 0; c < 4; c++) Require(Math.Abs(output[c]) < 1e-8, "Reset leaked prior channel audio."); }
        }
        using (var processor = new UsbAudioProcessing(2, dll)) {
            var input = new float[2]; var output = new float[2];
            for (int n = 0; n < 12000; n++) {
                if (n == 1237) processor.Configure("strong", 60);
                if (n == 4111) processor.Configure("gentle", 50);
                if (n == 8113) processor.Configure("off", 0);
                input[0] = input[1] = (float)(.02 * Math.Sin(2 * Math.PI * 211 * n / 48000));
                processor.ProcessFrame(input, output);
                Require(Finite(output[0]) && output[0] == output[1], "Mid-block settings changed channel alignment.");
                if (n > 10100) Require(Math.Abs(output[0] - .02 * Math.Sin(2 * Math.PI * 211 * (n - UsbAudioProcessing.LatencyFrames) / 48000)) < 1e-7, "Returning to bypass did not restore delayed dry samples.");
            }
        }
        var fixture = Noise(48000 * 4);
        var strong = Run(dll, fixture, "strong", 0, new[] { 37, 128, 11, 481, 1, 960 });
        var partitioned = Run(dll, fixture, "strong", 0, new[] { 480 });
        for (int i = 0; i < strong.Length; i++) Require(strong[i] == partitioned[i], "Packet boundaries changed processing.");
        double noiseRatio = Rms(strong, 48000 * 2) / Rms(fixture, 48000 * 2);
        Console.WriteLine("PASS: noise RMS ratio " + noiseRatio.ToString("F4") + " (" + (20 * Math.Log10(noiseRatio)).ToString("F1") + " dB).");
        Require(noiseRatio < .95, "RNNoise did not attenuate stationary noise.");
        var fan = new float[fixture.Length]; double low = 0;
        for (int i = 0; i < fan.Length; i++) { low = .97 * low + .03 * fixture[i]; fan[i] = (float)(low * 6); }
        var fanReduced = Run(dll, fan, "strong", 0, new[] { 480 });
        double fanRatio = Rms(fanReduced, 48000 * 2) / Rms(fan, 48000 * 2);
        Console.WriteLine("Fan RMS ratio " + fanRatio.ToString("F4") + " (" + (20 * Math.Log10(fanRatio)).ToString("F1") + " dB).");
        Require(fanRatio < .1, "RNNoise did not suppress fan-like colored noise.");
        var fanGentle = Run(dll, fan, "gentle", 0, new[] { 480 });
        double gentleFanRatio = Rms(fanGentle, 48000 * 2) / Rms(fan, 48000 * 2);
        Require(gentleFanRatio < .5 && gentleFanRatio > .4, "Gentle blend did not retain aligned dry floor.");
        Console.WriteLine("PASS: gentle fan RMS ratio " + gentleFanRatio.ToString("F3") + ".");
        var hum = new float[48000 * 4];
        for (int i = 0; i < hum.Length; i++) hum[i] = (float)(.1 * Math.Sin(2 * Math.PI * 60 * i / 48000) + .1 * Math.Sin(2 * Math.PI * 120 * i / 48000));
        var dehum = Run(dll, hum, "off", 60, new[] { 480 });
        double humRatio = Rms(dehum, 48000 * 2) / Rms(hum, 48000 * 2);
        Require(humRatio < .02, "Mains notches failed to suppress fundamental and harmonic.");
        Console.WriteLine("PASS: hum RMS ratio " + humRatio.ToString("F6") + ".");
        // Harmonic voice proxy at quiet, ordinary and overload levels. This verifies
        // preservation bounds/alignment, not subjective intelligibility or accent quality.
        foreach (float amplitude in new[] { .002f, .15f, 1.4f }) {
            var voice = new float[48000 * 3];
            for (int i = 0; i < voice.Length; i++) { double phase = 2 * Math.PI * 173 * i / 48000; voice[i] = amplitude * (float)(Math.Sin(phase) + .3 * Math.Sin(phase * 2) + .15 * Math.Sin(phase * 3)); }
            var gentle = Run(dll, voice, "gentle", 0, new[] { 127, 401 });
            double ratio = Rms(gentle, 48000) / Rms(voice, 48000);
            Require(ratio > .40 && ratio < 1.3, "Gentle mode lost quiet/loud voice proxy or amplified it.");
            int lag = BestLag(voice, gentle, 900, 1020);
            Console.WriteLine("PASS: voice proxy amplitude " + amplitude + ", RMS ratio " + ratio.ToString("F3") + ", delay " + lag + " samples.");
            Require(Math.Abs(lag - UsbAudioProcessing.LatencyFrames) < 5, "Dry/wet phase alignment differs from reported latency.");
        }
        // RNNoise's impulse response should peak at the same fixed delay as bypass.
        var impulse = new float[6000]; impulse[2000] = .8f;
        var response = Run(dll, impulse, "strong", 0, new[] { 13, 257 });
        int peak = 0; for (int i = 0; i < response.Length; i++) if (Math.Abs(response[i]) > Math.Abs(response[peak])) peak = i;
        Require(peak - 2000 == UsbAudioProcessing.LatencyFrames, "Measured RNNoise impulse delay differs from bypass.");
        Console.WriteLine("PASS: measured wet impulse delay " + (peak - 2000) + " samples (" + ((peak - 2000) / 48.0) + " ms).");
        if (args.Length == 2) SpeechFixture(dll, args[1]);
        using (var processor = new UsbAudioProcessing(4, dll)) {
            processor.Configure("strong", 60); var input = new float[4]; var output = new float[4];
            var watch = Stopwatch.StartNew();
            for (int i = 0; i < 48000 * 5; i++) { for (int c = 0; c < 4; c++) input[c] = fixture[i % fixture.Length]; processor.ProcessFrame(input, output); }
            watch.Stop(); Require(watch.Elapsed.TotalSeconds < 5, "Four-channel DSP cannot keep up with real time.");
            Console.WriteLine("PASS: four-channel 5 s audio processed in " + watch.Elapsed.TotalMilliseconds.ToString("F0") + " ms (CPU benchmark, no capture device).");
        }
        Console.WriteLine("PASS: unavailable fallback, bypass, headroom, channels, nonfinite input, reset, partitions, hum, noise, voice proxy, alignment, CPU.");
        return 0;
    }
    private static float[] Run(string dll, float[] fixture, string mode, int hum, int[] partitions) {
        var result = new float[fixture.Length + UsbAudioProcessing.LatencyFrames];
        using (var processor = new UsbAudioProcessing(1, dll)) {
            Require(processor.NoiseReductionAvailable, "RNNoise unavailable in fixture."); processor.Configure(mode, hum);
            var input = new float[1]; var output = new float[1]; int offset = 0, chunk = 0;
            while (offset < result.Length) { int end = Math.Min(result.Length, offset + partitions[chunk++ % partitions.Length]); for (; offset < end; offset++) { input[0] = offset < fixture.Length ? fixture[offset] : 0; processor.ProcessFrame(input, output); result[offset] = output[0]; } }
        }
        return result;
    }
    private static float[] Noise(int frames) { var result = new float[frames]; uint seed = 17583; for (int i = 0; i < frames; i++) { seed = unchecked(seed * 1664525 + 1013904223); result[i] = ((seed >> 8) / 16777216f * 2 - 1) * .025f; } return result; }
    private static void SpeechFixture(string dll, string path) {
        float[] speech;
        using (var reader = new System.IO.BinaryReader(System.IO.File.OpenRead(path))) {
            Require(new String(reader.ReadChars(4)) == "RIFF", "Speech fixture is not RIFF."); reader.ReadInt32(); Require(new String(reader.ReadChars(4)) == "WAVE", "Speech fixture is not WAVE.");
            bool format = false; speech = null;
            while (reader.BaseStream.Position + 8 <= reader.BaseStream.Length) {
                string chunk = new String(reader.ReadChars(4)); int size = reader.ReadInt32(); long end = reader.BaseStream.Position + size;
                if (chunk == "fmt ") { format = reader.ReadInt16() == 1 && reader.ReadInt16() == 1 && reader.ReadInt32() == 48000; reader.ReadInt32(); reader.ReadInt16(); format = format && reader.ReadInt16() == 16; }
                if (chunk == "data") { Require(format, "Speech fixture must be PCM16 mono 48 kHz."); speech = new float[size / 2 + 96000]; for (int i = 0; i < size / 2; i++) speech[i] = reader.ReadInt16() / 32768f; break; }
                reader.BaseStream.Position = end + size % 2;
            }
        }
        Require(speech != null, "No speech samples.");
        var noise = Noise(speech.Length); double low = 0; var noisy = new float[speech.Length];
        for (int i = 0; i < speech.Length; i++) { low = .97 * low + .03 * noise[i]; noisy[i] = speech[i] * .3f + (float)(low * 6); }
        foreach (string mode in new[] { "gentle", "strong" }) {
            var enhanced = Run(dll, noisy, mode, 0, new[] { 37, 511 });
            double dot = 0, cleanEnergy = 0, outputEnergy = 0;
            for (int i = 4800; i < speech.Length - 96000; i++) { double clean = speech[i] * .3, output = enhanced[i + UsbAudioProcessing.LatencyFrames]; dot += clean * output; cleanEnergy += clean * clean; outputEnergy += output * output; }
            double correlation = dot / Math.Sqrt(cleanEnergy * outputEnergy);
            Require(correlation > .85, "Speech-with-fan fixture lost speech waveform correlation.");
            double pauseRatio = Rms(enhanced, enhanced.Length - 48000) / Rms(noisy, noisy.Length - 48000);
            Require(pauseRatio < (mode == "gentle" ? .55 : .1), "Speech pause fan noise was not suppressed.");
            Console.WriteLine("PASS: Windows TTS + fan " + mode + ", speech correlation " + correlation.ToString("F3") + ", pause RMS ratio " + pauseRatio.ToString("F4") + ".");
            WriteWave(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(path), "speech-fan-" + mode + ".wav"), enhanced);
        }
        WriteWave(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(path), "speech-fan-noisy.wav"), noisy);
    }
    private static void WriteWave(string path, float[] samples) {
        using (var writer = new System.IO.BinaryWriter(System.IO.File.Create(path))) { writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + samples.Length * 2); writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16); writer.Write((short)1); writer.Write((short)1); writer.Write(48000); writer.Write(96000); writer.Write((short)2); writer.Write((short)16); writer.Write(System.Text.Encoding.ASCII.GetBytes("data")); writer.Write(samples.Length * 2); for (int i = 0; i < samples.Length; i++) writer.Write((short)(Math.Max(-1, Math.Min(1, samples[i])) * 32767)); }
    }
    private static double Rms(float[] samples, int skip) { double sum = 0; for (int i = skip; i < samples.Length; i++) sum += samples[i] * samples[i]; return Math.Sqrt(sum / (samples.Length - skip)); }
    private static int BestLag(float[] dry, float[] wet, int low, int high) { int best = low; double maximum = Double.MinValue; for (int lag = low; lag <= high; lag++) { double score = 0; for (int i = 48000; i < Math.Min(dry.Length, 60000); i++) score += dry[i] * wet[i + lag]; if (score > maximum) { maximum = score; best = lag; } } return best; }
    private static bool Finite(float value) { return !Single.IsNaN(value) && !Single.IsInfinity(value); }
    private static void Require(bool success, string message) { if (!success) throw new Exception(message); }
}
