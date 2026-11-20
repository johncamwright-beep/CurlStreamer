// Local 48 kHz microphone processing. Capture thread owns ProcessFrame/Reset/Dispose.
using System;
using System.IO;
using System.Runtime.InteropServices;

internal sealed class UsbAudioProcessing : IDisposable
{
    internal const int BlockFrames = 480;
    // One block for collecting input, one for RNNoise's overlap-add synthesis.
    internal const int LatencyFrames = 960;
    private const int LoadLibrarySearchDllLoadDir = 0x100, LoadLibrarySearchSystem32 = 0x800;
    private readonly Channel[] channels;
    private readonly object settingsGate = new object();
    private static readonly object nativeInitializationGate = new object();
    private Settings requested = new Settings("off", 0);
    private Settings active;
    private IntPtr library;
    private CreateState create;
    private DestroyState destroy;
    private ProcessBlock process;
    private int position, dryPosition, appliedHum;
    private float wetMix, humMix;
    private bool disposed;
    internal bool NoiseReductionAvailable { get; private set; }
    internal string Error { get; private set; }

    internal UsbAudioProcessing(int channelCount, string nativeDllPath)
    {
        if (channelCount < 1 || channelCount > 32) throw new ArgumentOutOfRangeException("channelCount");
        channels = new Channel[channelCount];
        for (int i = 0; i < channels.Length; i++) channels[i] = new Channel();
        try {
            if (String.IsNullOrEmpty(nativeDllPath) || !Path.IsPathRooted(nativeDllPath)) throw new ArgumentException("An absolute RNNoise library path is required.");
            string path = Path.GetFullPath(nativeDllPath);
            if (!String.Equals(Path.GetExtension(path), ".dll", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("RNNoise must be a DLL.");
            library = LoadLibraryEx(path, IntPtr.Zero, LoadLibrarySearchDllLoadDir | LoadLibrarySearchSystem32);
            if (library == IntPtr.Zero) throw new InvalidOperationException("RNNoise could not be loaded.");
            create = (CreateState)Marshal.GetDelegateForFunctionPointer(Export("rnnoise_create"), typeof(CreateState));
            destroy = (DestroyState)Marshal.GetDelegateForFunctionPointer(Export("rnnoise_destroy"), typeof(DestroyState));
            process = (ProcessBlock)Marshal.GetDelegateForFunctionPointer(Export("rnnoise_process_frame"), typeof(ProcessBlock));
            for (int i = 0; i < channels.Length; i++) {
                channels[i].state = create(IntPtr.Zero);
                if (channels[i].state == IntPtr.Zero) throw new InvalidOperationException("RNNoise state allocation failed.");
            }
            // Upstream's shared FFT tables initialize lazily. Serialize its first
            // silent call so simultaneous capture owners cannot race initialization.
            lock (nativeInitializationGate) process(channels[0].state, channels[0].wet, channels[0].input);
            destroy(channels[0].state); channels[0].state = create(IntPtr.Zero);
            if (channels[0].state == IntPtr.Zero) throw new InvalidOperationException("RNNoise state allocation failed.");
            NoiseReductionAvailable = true;
        } catch {
            ReleaseNative();
            // Keep capture usable, and never present a missing denoiser as active.
            Error = "Noise reduction is unavailable. Check the Studio audio processing installation.";
        }
        active = requested;
    }

    internal void Configure(string noiseReduction, int humFrequency)
    {
        if (noiseReduction != "off" && noiseReduction != "gentle" && noiseReduction != "strong") throw new ArgumentOutOfRangeException("noiseReduction");
        if (humFrequency != 0 && humFrequency != 50 && humFrequency != 60) throw new ArgumentOutOfRangeException("humFrequency");
        lock (settingsGate) {
            if (disposed) throw new ObjectDisposedException("UsbAudioProcessing");
            if (requested.noise != noiseReduction || requested.hum != humFrequency) requested = new Settings(noiseReduction, humFrequency);
        }
    }

    // input/output are caller-owned and reused; this method allocates no buffers.
    internal void ProcessFrame(float[] input, float[] output)
    {
        if (disposed) throw new ObjectDisposedException("UsbAudioProcessing");
        if (input == null || output == null || input.Length != channels.Length || output.Length != channels.Length) throw new ArgumentException("A sample for every capture channel is required.");
        Settings settings;
        lock (settingsGate) settings = requested;
        active = settings;
        float target = !NoiseReductionAvailable || active.noise == "off" ? 0f : active.noise == "gentle" ? .55f : 1f;
        wetMix = Approach(wetMix, target, 1f / BlockFrames);
        // Fade the old notches out before retuning; then fade the new pair in.
        humMix = Approach(humMix, appliedHum == active.hum && active.hum != 0 ? 1f : 0f, 1f / BlockFrames);
        if (appliedHum != active.hum && humMix == 0) {
            appliedHum = active.hum;
            for (int c = 0; c < channels.Length; c++) { channels[c].fundamental.Configure(appliedHum); channels[c].harmonic.Configure(appliedHum * 2); }
        }
        for (int c = 0; c < channels.Length; c++) {
            var channel = channels[c];
            // Preserve ordinary overload headroom while preventing pathological
            // finite floats from overflowing the filter/interpolation arithmetic.
            float raw = Math.Max(-16f, Math.Min(16f, Finite(input[c])));
            float filtered = channel.harmonic.Process(channel.fundamental.Process(raw));
            float value = raw + (filtered - raw) * humMix;
            float dry = channel.dry[dryPosition];
            channel.dry[dryPosition] = value;
            // RNNoise expects PCM16-scale floating point. Saturate only its analysis
            // branch; bypass and the gentle dry branch preserve floating headroom.
            channel.input[position] = Math.Max(-1f, Math.Min(1f, value)) * 32768f;
            float wet = channel.wet[position];
            output[c] = Finite(dry + (wet - dry) * wetMix);
        }
        dryPosition = (dryPosition + 1) % LatencyFrames;
        if (++position == BlockFrames) {
            position = 0;
            if (NoiseReductionAvailable) {
                for (int c = 0; c < channels.Length; c++) {
                    var channel = channels[c];
                    process(channel.state, channel.wet, channel.input);
                    for (int i = 0; i < BlockFrames; i++) channel.wet[i] = Finite(channel.wet[i] / 32768f);
                }
            }
        }
    }

    internal void Reset()
    {
        if (disposed) throw new ObjectDisposedException("UsbAudioProcessing");
        position = dryPosition = 0; wetMix = humMix = 0; appliedHum = active.hum;
        for (int c = 0; c < channels.Length; c++) {
            var channel = channels[c];
            Array.Clear(channel.input, 0, channel.input.Length); Array.Clear(channel.wet, 0, channel.wet.Length); Array.Clear(channel.dry, 0, channel.dry.Length);
            channel.fundamental.Configure(active.hum); channel.harmonic.Configure(active.hum * 2);
        }
        if (NoiseReductionAvailable) {
            for (int c = 0; c < channels.Length; c++) {
                var channel = channels[c];
                destroy(channel.state); channel.state = create(IntPtr.Zero);
                if (channel.state == IntPtr.Zero) { ReleaseNative(); Error = "Noise reduction stopped. Check the Studio audio processing installation."; break; }
            }
        }
    }

    public void Dispose()
    {
        lock (settingsGate) { if (disposed) return; disposed = true; }
        ReleaseNative();
    }

    private void ReleaseNative()
    {
        NoiseReductionAvailable = false;
        for (int i = 0; i < channels.Length; i++) if (channels[i].state != IntPtr.Zero) { if (destroy != null) destroy(channels[i].state); channels[i].state = IntPtr.Zero; }
        if (library != IntPtr.Zero) { FreeLibrary(library); library = IntPtr.Zero; }
    }
    private IntPtr Export(string name) { var address = GetProcAddress(library, name); if (address == IntPtr.Zero) throw new InvalidOperationException("RNNoise export missing."); return address; }
    private static float Finite(float value) { return Single.IsNaN(value) || Single.IsInfinity(value) ? 0f : value; }
    private static float Approach(float current, float target, float step) { return current < target ? Math.Min(target, current + step) : Math.Max(target, current - step); }
    private sealed class Settings { internal readonly string noise; internal readonly int hum; internal Settings(string noise, int hum) { this.noise = noise; this.hum = hum; } }
    private sealed class Channel {
        internal IntPtr state;
        internal readonly float[] input = new float[BlockFrames], wet = new float[BlockFrames], dry = new float[LatencyFrames];
        internal readonly Notch fundamental = new Notch(), harmonic = new Notch();
    }
    // RBJ notch at mains frequency and its first harmonic, Q=20. Transposed DF-II.
    private sealed class Notch {
        private double b0 = 1, b1, b2, a1, a2, z1, z2;
        internal void Configure(int frequency) {
            z1 = z2 = 0;
            if (frequency == 0) { b0 = 1; b1 = b2 = a1 = a2 = 0; return; }
            double omega = 2 * Math.PI * frequency / 48000, alpha = Math.Sin(omega) / 40, divisor = 1 + alpha;
            b0 = 1 / divisor; b1 = -2 * Math.Cos(omega) / divisor; b2 = b0; a1 = b1; a2 = (1 - alpha) / divisor;
        }
        internal float Process(float input) { double output = b0 * input + z1; z1 = b1 * input - a1 * output + z2; z2 = b2 * input - a2 * output; return (float)output; }
    }
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr CreateState(IntPtr model);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void DestroyState(IntPtr state);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate float ProcessBlock(IntPtr state, [Out] float[] output, [In] float[] input);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadLibraryEx(string fileName, IntPtr file, int flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)] private static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool FreeLibrary(IntPtr module);
}
