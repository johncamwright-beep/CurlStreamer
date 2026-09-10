// WASAPI input helper.  It intentionally opens an endpoint only after Start is called.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

internal sealed class UsbAudioEndpoint
{
    public string id;
    public string name;
}

internal sealed class UsbAudioChannelSnapshot
{
    public float peak;
    public float rms;
    public bool muted;
    public float level;
}

internal sealed class UsbAudioSnapshot
{
    public bool running;
    public int sampleRate;
    public UsbAudioChannelSnapshot[] channels;
    public string error;
}

// The callback is made on a background MTA thread.  It receives interleaved-free mono
// float PCM and the endpoint's actual sample rate.  It never opens an output endpoint.
internal sealed class UsbAudio : IDisposable
{
    private const int EDataFlowCapture = 1, DeviceStateActive = 1;
    private const int ClsCtxAll = 23, SharedMode = 0, StreamEventCallback = 0x40000;
    private const uint BufferSilent = 2;
    private readonly object gate = new object();
    private Action<float[], int> onMono;
    private Thread worker;
    private ManualResetEvent cancel;
    private ManualResetEvent ready;
    private IntPtr audioEvent;
    private bool running, disposed;
    private string error;
    private int sampleRate, channelCount;
    private float[] peaks, rms, levels;
    private bool[] muted;

    internal event Action<Exception> DeviceLost;

    internal UsbAudio() { }
    internal UsbAudio(Action<float[], int> monoCallback)
    {
        if (monoCallback == null) throw new ArgumentNullException("monoCallback");
        onMono = monoCallback;
    }

    internal static UsbAudioEndpoint[] EnumerateActiveCaptureEndpoints()
    {
        var result = new List<UsbAudioEndpoint>();
        IMMDeviceEnumerator enumerator = null;
        IMMDeviceCollection collection = null;
        int initialized = Native.CoInitializeEx(IntPtr.Zero, 0);
        bool uninitialize = initialized >= 0;
        if (initialized < 0 && initialized != unchecked((int)0x80010106)) Marshal.ThrowExceptionForHR(initialized);
        try {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            enumerator.EnumAudioEndpoints(EDataFlowCapture, DeviceStateActive, out collection);
            uint count; collection.GetCount(out count);
            for (uint i = 0; i < count; i++) {
                IMMDevice device = null;
                IntPtr id = IntPtr.Zero;
                try {
                    collection.Item(i, out device); device.GetId(out id);
                    result.Add(new UsbAudioEndpoint { id = Marshal.PtrToStringUni(id), name = FriendlyName(device) });
                } finally {
                    if (id != IntPtr.Zero) Marshal.FreeCoTaskMem(id);
                    ReleaseCom(device);
                }
            }
            return result.ToArray();
        } finally { ReleaseCom(collection); ReleaseCom(enumerator); if (uninitialize) Native.CoUninitialize(); }
    }

    internal static UsbAudioEndpoint[] Enumerate() { return EnumerateActiveCaptureEndpoints(); }

    internal void Start(string deviceId)
    {
        if (String.IsNullOrEmpty(deviceId)) throw new ArgumentException("An active capture device id is required.", "deviceId");
        ManualResetEvent started;
        lock (gate) {
            ThrowIfDisposed();
            if (onMono == null) throw new InvalidOperationException("A mono audio callback is required.");
            if (worker != null) throw new InvalidOperationException("USB audio capture is already started.");
            error = null; sampleRate = 0; channelCount = 0; peaks = rms = levels = null; muted = null;
            cancel = new ManualResetEvent(false); ready = new ManualResetEvent(false);
            started = ready;
            worker = new Thread(() => CaptureThread(deviceId)) { IsBackground = true, Name = "CurlStreamer WASAPI capture" };
            worker.SetApartmentState(ApartmentState.MTA); worker.Start();
        }
        if (!started.WaitOne(5000)) { Stop(); started.Dispose(); throw new TimeoutException("The capture endpoint did not start within five seconds."); }
        lock (gate) {
            try { if (!running) throw new InvalidOperationException(error ?? "The capture endpoint could not be opened."); }
            finally { if (ready == started) ready = null; started.Dispose(); }
        }
    }

    internal void Start(string deviceId, Action<float[], int> monoCallback)
    {
        if (monoCallback == null) throw new ArgumentNullException("monoCallback");
        lock (gate) { if (worker != null) throw new InvalidOperationException("USB audio capture is already started."); onMono = monoCallback; }
        Start(deviceId);
    }

    // Stop signals the event-driven capture loop and waits a bounded five seconds.  COM
    // objects remain owned by the worker until it releases them, even after a timeout.
    internal void Stop()
    {
        Thread thread; ManualResetEvent stop; IntPtr signal;
        lock (gate) { thread = worker; stop = cancel; signal = audioEvent;
            if (thread != null) { if (stop != null) stop.Set(); if (signal != IntPtr.Zero) Native.SetEvent(signal); }
        }
        if (thread == null) return;
        if (!thread.Join(5000)) throw new TimeoutException("Capture did not stop within five seconds.");
    }

    internal UsbAudioSnapshot Snapshot()
    {
        lock (gate) {
            var channels = new UsbAudioChannelSnapshot[channelCount];
            for (int i = 0; i < channelCount; i++) channels[i] = new UsbAudioChannelSnapshot {
                peak = running ? Clamp(peaks[i], 0f, 1f) : 0f, rms = running ? Clamp(rms[i], 0f, 1f) : 0f, muted = muted[i], level = levels[i]
            };
            return new UsbAudioSnapshot { running = running, sampleRate = sampleRate, channels = channels, error = error };
        }
    }

    internal void SetChannel(int index, bool mute, float level)
    {
        if (Single.IsNaN(level) || Single.IsInfinity(level)) throw new ArgumentOutOfRangeException("level");
        lock (gate) {
            if (index < 0 || index >= channelCount) throw new ArgumentOutOfRangeException("index");
            muted[index] = mute; levels[index] = Clamp(level, 0f, 4f);
        }
    }

    public void Dispose() { if (!disposed) { try { Stop(); } finally { disposed = true; } } }

    private void CaptureThread(string deviceId)
    {
        IMMDeviceEnumerator enumerator = null; IMMDevice device = null; IAudioClient client = null; IAudioCaptureClient capture = null;
        IntPtr format = IntPtr.Zero, evt = IntPtr.Zero;
        int initialized = Native.CoInitializeEx(IntPtr.Zero, 0); // MTA
        bool uninitialize = initialized >= 0;
        try {
            if (initialized < 0) Marshal.ThrowExceptionForHR(initialized);
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            enumerator.GetDevice(deviceId, out device);
            var iidClient = typeof(IAudioClient).GUID; device.Activate(ref iidClient, ClsCtxAll, IntPtr.Zero, out client);
            // Bypass Windows signal processing, which can duplicate a mono mix
            // across a multichannel endpoint. Never silently fall back to mixed input.
            var properties = new AudioClientProperties { size = 16, offload = 0, category = 0, options = 1 };
            ((IAudioClient2)client).SetClientProperties(ref properties);
            client.GetMixFormat(out format);
            var wave = WaveFormat.Read(format);
            if (!wave.IsSupported) throw new NotSupportedException("The selected endpoint mix format is not PCM or IEEE float 16, 24, or 32-bit audio.");
            if (wave.sampleRate != 48000) throw new NotSupportedException("The selected endpoint must use a 48 kHz shared-mode mix format.");
            evt = Native.CreateEvent(IntPtr.Zero, false, false, null);
            if (evt == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            client.Initialize(SharedMode, StreamEventCallback, 0, 0, format, IntPtr.Zero);
            client.SetEventHandle(evt);
            var iidCapture = typeof(IAudioCaptureClient).GUID; client.GetService(ref iidCapture, out capture);
            lock (gate) {
                audioEvent = evt; sampleRate = wave.sampleRate; channelCount = wave.channels;
                peaks = new float[channelCount]; rms = new float[channelCount]; levels = new float[channelCount]; muted = new bool[channelCount];
                for (int i = 0; i < channelCount; i++) levels[i] = 1f;
                running = true;
            }
            client.Start();
            ready.Set();
            var handles = new[] { evt, cancel.SafeWaitHandle.DangerousGetHandle() };
            while (true) {
                uint wait = Native.WaitForMultipleObjects(2, handles, false, 1000);
                if (wait == 1) break;
                if (wait == 0) Drain(capture, wave);
                else if (wait != 258) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "WASAPI capture wait failed.");
            }
            client.Stop();
        } catch (Exception ex) {
            lock (gate) { running = false; error = "USB audio capture stopped: " + SafeMessage(ex); }
            try { var lost = DeviceLost; if (lost != null) lost(ex); } catch { }
            lock (gate) { if (ready != null) ready.Set(); }
        } finally {
            lock (gate) { running = false; audioEvent = IntPtr.Zero; }
            ReleaseCom(capture); ReleaseCom(client); ReleaseCom(device); ReleaseCom(enumerator);
            if (format != IntPtr.Zero) Marshal.FreeCoTaskMem(format);
            if (evt != IntPtr.Zero) Native.CloseHandle(evt);
            if (uninitialize) { try { Native.CoUninitialize(); } catch { } }
            lock (gate) { worker = null; if (cancel != null) cancel.Dispose(); cancel = null; ready = null; }
        }
    }

    private void Drain(IAudioCaptureClient capture, WaveFormat wave)
    {
        uint available; capture.GetNextPacketSize(out available);
        while (available != 0) {
            IntPtr data; uint frames, flags; ulong position, timestamp;
            capture.GetBuffer(out data, out frames, out flags, out position, out timestamp);
            try { ProcessPacket(data, checked((int)frames), (flags & BufferSilent) != 0, wave); }
            finally { capture.ReleaseBuffer(frames); }
            capture.GetNextPacketSize(out available);
        }
    }

    private void ProcessPacket(IntPtr data, int frames, bool silent, WaveFormat wave)
    {
        if (frames <= 0) return;
        var output = new float[frames]; var packetPeak = new float[wave.channels]; var squares = new double[wave.channels];
        bool[] localMuted; float[] localLevels;
        lock (gate) { localMuted = (bool[])muted.Clone(); localLevels = (float[])levels.Clone(); }
        for (int frame = 0; frame < frames; frame++) {
            double mixed = 0;
            for (int ch = 0; ch < wave.channels; ch++) {
                float value = silent ? 0f : DecodeSample(data, frame * wave.blockAlign + ch * wave.bytesPerSample, wave.format, wave.bytesPerSample);
                float absolute = Math.Abs(value); if (absolute > packetPeak[ch]) packetPeak[ch] = absolute; squares[ch] += value * value;
                if (!localMuted[ch]) mixed += value * localLevels[ch];
            }
            // Divide by the physical channel count, not enabled sources: muting a
            // channel must not make every remaining channel louder.
            output[frame] = MixMono((float)mixed, wave.channels);
        }
        lock (gate) for (int ch = 0; ch < wave.channels; ch++) { peaks[ch] = packetPeak[ch]; rms[ch] = (float)Math.Sqrt(squares[ch] / frames); }
        try { onMono(output, wave.sampleRate); } catch (Exception ex) { lock (gate) error = "USB audio callback failed: " + SafeMessage(ex); }
    }

    internal static float DecodeSample(IntPtr data, int offset, UsbAudioSampleFormat format, int bytes)
    {
        if (format == UsbAudioSampleFormat.Float32) return Normalize(Int32Bits.ToFloat(Marshal.ReadInt32(data, offset)));
        if (bytes == 2) return Normalize(Marshal.ReadInt16(data, offset) / 32768f);
        if (bytes == 3) {
            int value = Marshal.ReadByte(data, offset) | (Marshal.ReadByte(data, offset + 1) << 8) | (Marshal.ReadByte(data, offset + 2) << 16);
            if ((value & 0x800000) != 0) value |= unchecked((int)0xff000000);
            return Normalize(value / 8388608f);
        }
        return Normalize(Marshal.ReadInt32(data, offset) / 2147483648f);
    }

    internal static float MixMono(float sum, int activeChannels) { return activeChannels == 0 ? 0f : Clamp(sum / activeChannels, -1f, 1f); }

    private static string FriendlyName(IMMDevice device)
    {
        IPropertyStore properties = null;
        try {
            device.OpenPropertyStore(0, out properties); PropVariant value; properties.GetValue(ref PropertyKeys.FriendlyName, out value);
            try { return value.vt == 31 && value.pointer != IntPtr.Zero ? Marshal.PtrToStringUni(value.pointer) : "Audio input"; }
            finally { Native.PropVariantClear(ref value); }
        } finally { ReleaseCom(properties); }
    }
    private static void ReleaseCom(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    private void ThrowIfDisposed() { if (disposed) throw new ObjectDisposedException("UsbAudio"); }
    private static string SafeMessage(Exception ex) { return String.IsNullOrEmpty(ex.Message) ? ex.GetType().Name : ex.Message; }
    private static float Clamp(float value, float min, float max) { return value < min ? min : value > max ? max : value; }
    private static float Normalize(float value) { return Single.IsNaN(value) || Single.IsInfinity(value) ? 0f : Clamp(value, -1f, 1f); }
}

internal enum UsbAudioSampleFormat { Pcm, Float32 }
internal struct WaveFormat
{
    internal int channels, sampleRate, blockAlign, bytesPerSample; internal UsbAudioSampleFormat format; internal bool IsSupported;
    internal static WaveFormat Read(IntPtr value) {
        ushort tag = unchecked((ushort)Marshal.ReadInt16(value, 0)), ch = unchecked((ushort)Marshal.ReadInt16(value, 2));
        int rate = Marshal.ReadInt32(value, 4), align = unchecked((ushort)Marshal.ReadInt16(value, 12)), bits = unchecked((ushort)Marshal.ReadInt16(value, 14));
        bool floating = tag == 3;
        if (tag == 0xfffe && Marshal.ReadInt16(value, 16) >= 22) {
            var sub = (Guid)Marshal.PtrToStructure(IntPtr.Add(value, 24), typeof(Guid));
            floating = sub == new Guid("00000003-0000-0010-8000-00aa00389b71");
            tag = floating ? (ushort)3 : (sub == new Guid("00000001-0000-0010-8000-00aa00389b71") ? (ushort)1 : (ushort)0);
        }
        int bytes = bits / 8;
        return new WaveFormat { channels = ch, sampleRate = rate, blockAlign = align, bytesPerSample = bytes, format = floating ? UsbAudioSampleFormat.Float32 : UsbAudioSampleFormat.Pcm,
            IsSupported = ch > 0 && ch <= 32 && rate > 0 && align >= ch * bytes && ((tag == 1 && (bits == 16 || bits == 24 || bits == 32)) || (tag == 3 && bits == 32)) };
    }
}

[StructLayout(LayoutKind.Explicit)] internal struct Int32Bits { [FieldOffset(0)] internal int integer; [FieldOffset(0)] internal float single; internal static float ToFloat(int value) { return new Int32Bits { integer = value }.single; } }
[StructLayout(LayoutKind.Sequential)] internal struct PropertyKey { internal Guid formatId; internal uint propertyId; }
[StructLayout(LayoutKind.Explicit, Size = 24)] internal struct PropVariant { [FieldOffset(0)] internal ushort vt; [FieldOffset(8)] internal IntPtr pointer; }
internal static class PropertyKeys { internal static PropertyKey FriendlyName = new PropertyKey { formatId = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), propertyId = 14 }; }

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ClassInterface(ClassInterfaceType.None)] internal class MMDeviceEnumeratorComObject { }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")] internal interface IMMDeviceEnumerator { void EnumAudioEndpoints(int flow, int state, [MarshalAs(UnmanagedType.Interface)] out IMMDeviceCollection devices); void GetDefaultAudioEndpoint(int flow, int role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device); void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device); void RegisterEndpointNotificationCallback(IntPtr notification); void UnregisterEndpointNotificationCallback(IntPtr notification); }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")] internal interface IMMDeviceCollection { void GetCount(out uint count); void Item(uint index, out IMMDevice device); }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")] internal interface IMMDevice { void Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.Interface)] out IAudioClient audioClient); void OpenPropertyStore(int access, out IPropertyStore properties); void GetId(out IntPtr id); void GetState(out int state); }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")] internal interface IPropertyStore { void GetCount(out uint count); void GetAt(uint index, out PropertyKey key); void GetValue(ref PropertyKey key, out PropVariant value); void SetValue(ref PropertyKey key, ref PropVariant value); void Commit(); }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")] internal interface IAudioClient { void Initialize(int shareMode, int flags, long duration, long periodicity, IntPtr format, IntPtr session); void GetBufferSize(out uint frames); void GetStreamLatency(out long latency); void GetCurrentPadding(out uint padding); void IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest); void GetMixFormat(out IntPtr format); void GetDevicePeriod(out long defaultPeriod, out long minimumPeriod); void Start(); void Stop(); void Reset(); void SetEventHandle(IntPtr handle); void GetService(ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAudioCaptureClient service); }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")] internal interface IAudioCaptureClient { void GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition); void ReleaseBuffer(uint frames); void GetNextPacketSize(out uint frames); }
internal static class Native { [DllImport("ole32.dll")] internal static extern int CoInitializeEx(IntPtr reserved, int model); [DllImport("ole32.dll")] internal static extern void CoUninitialize(); [DllImport("ole32.dll")] internal static extern int PropVariantClear(ref PropVariant value); [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr CreateEvent(IntPtr attributes, bool manual, bool initial, string name); [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetEvent(IntPtr handle); [DllImport("kernel32.dll")] internal static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint milliseconds); [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle); }

[StructLayout(LayoutKind.Sequential)] internal struct AudioClientProperties { internal uint size; internal int offload, category, options; }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("726778CD-F60A-4EDA-82DE-E47610CD78AA")] internal interface IAudioClient2 { void Initialize(int shareMode, int flags, long duration, long periodicity, IntPtr format, IntPtr session); void GetBufferSize(out uint frames); void GetStreamLatency(out long latency); void GetCurrentPadding(out uint padding); void IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest); void GetMixFormat(out IntPtr format); void GetDevicePeriod(out long defaultPeriod, out long minimumPeriod); void Start(); void Stop(); void Reset(); void SetEventHandle(IntPtr handle); void GetService(ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAudioCaptureClient service);  void IsOffloadCapable(int category, out int capable); void SetClientProperties(ref AudioClientProperties properties); void GetBufferSizeLimits(IntPtr format, int eventDriven, out long minimum, out long maximum); }
