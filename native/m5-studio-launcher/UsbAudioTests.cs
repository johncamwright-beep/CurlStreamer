// Synthetic decoder/mixer checks.  This executable never opens a Windows endpoint.
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;

internal static class UsbAudioTests
{
    private static int Main(string[] args)
    {
        if (Marshal.SizeOf(typeof(PropVariant)) != 24) throw new Exception("PROPVARIANT x64 layout is not 24 bytes.");
        Check(new byte[] { 0, 0x80 }, UsbAudioSampleFormat.Pcm, 2, -1f, "PCM16 negative full scale");
        Check(new byte[] { 0xff, 0xff, 0x7f }, UsbAudioSampleFormat.Pcm, 3, 0.9999999f, "PCM24 positive full scale");
        Check(new byte[] { 0, 0, 0, 0x80 }, UsbAudioSampleFormat.Pcm, 4, -1f, "PCM32 negative full scale");
        Check(BitConverter.GetBytes(0.5f), UsbAudioSampleFormat.Float32, 4, 0.5f, "Float32");
        Check(BitConverter.GetBytes(1.5f), UsbAudioSampleFormat.Float32, 4, 1.5f, "Float32 headroom");
        Check(BitConverter.GetBytes(-2f), UsbAudioSampleFormat.Float32, 4, -2f, "Float32 negative headroom");
        Check(BitConverter.GetBytes(Single.NaN), UsbAudioSampleFormat.Float32, 4, 0f, "Float32 NaN normalization");
        Check(BitConverter.GetBytes(Single.PositiveInfinity), UsbAudioSampleFormat.Float32, 4, 0f, "Float32 infinity normalization");
        if (UsbAudio.MixMono(.25f, 4) != .25f || UsbAudio.MixMono(.25f, 2) != .25f || UsbAudio.MixMono(1f, 0) != 0f || UsbAudio.MixMono(2f, 4) != 2f) throw new Exception("Mono mix lost microphone level or float headroom.");
        CheckFourChannelPacket();
        CheckPeakPublication();
        if (args.Length == 1 && args[0] != "--enumerate") CheckProcessingPacket(args[0]);
        Console.WriteLine("PASS: PCM16/24/32, float headroom, mute, mono mixing, interval peaks and full-scale hold.");
        if (args.Length == 1 && args[0] == "--enumerate") {
            var endpoints = UsbAudio.Enumerate();
            Console.WriteLine("PASS: enumerated " + endpoints.Length + " active capture endpoint(s).");
        }
        return 0;
    }

    private static void CheckFourChannelPacket()
    {
        var output = new List<float[]>();
        var audio = new UsbAudio((samples, rate) => output.Add(samples));
        Set(audio, "channelCount", 4); Set(audio, "peaks", new float[4]); Set(audio, "rms", new float[4]);
        Set(audio, "running", true); Set(audio, "clippedUntil", new long[4]);
        Set(audio, "levels", new[] { 1f, 1f, 1f, 1f }); Set(audio, "muted", new[] { false, true, false, false });
        var values = new[] { .25f, -.5f, .75f, -.25f }; var bytes = new byte[16];
        for (int i = 0; i < values.Length; i++) Array.Copy(BitConverter.GetBytes(values[i]), 0, bytes, i * 4, 4);
        var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try {
            var wave = new WaveFormat { channels = 4, sampleRate = 48000, blockAlign = 16, bytesPerSample = 4, format = UsbAudioSampleFormat.Float32, IsSupported = true };
            typeof(UsbAudio).GetMethod("ProcessPacket", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(audio, new object[] { pin.AddrOfPinnedObject(), 1, false, wave });
            audio.SetAllMuted(true);
            typeof(UsbAudio).GetMethod("ProcessPacket", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(audio, new object[] { pin.AddrOfPinnedObject(), 1, false, wave });
            audio.SetAllMuted(false);
            typeof(UsbAudio).GetMethod("ProcessPacket", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(audio, new object[] { pin.AddrOfPinnedObject(), 1, false, wave });
        } finally { pin.Free(); }
        if (output.Count != 3 || output[0][0] != .75f || output[1][0] != 0f || output[2][0] != .75f) throw new Exception("Master mute failed to silence or restore the mix.");
        var snapshot = audio.Snapshot();
        if (!snapshot.channels[1].muted) throw new Exception("Master mute changed an individual microphone selection.");
        for (int i = 0; i < 4; i++) if (Math.Abs(snapshot.channels[i].peak - Math.Abs(values[i])) > .00001f || Math.Abs(snapshot.channels[i].rms - Math.Abs(values[i])) > .00001f) throw new Exception("Per-channel meter indexing failed.");
    }

    private static void CheckPeakPublication()
    {
        var output = new List<float[]>();
        var audio = new UsbAudio((samples, rate) => output.Add(samples));
        Set(audio, "channelCount", 1); Set(audio, "running", true);
        Set(audio, "peaks", new float[1]); Set(audio, "rms", new float[1]); Set(audio, "clippedUntil", new long[1]);
        Set(audio, "levels", new[] { .5f }); Set(audio, "muted", new[] { false });
        Packet(audio, 1.5f); Packet(audio, .1f);
        var first = audio.Snapshot().channels[0];
        if (first.peak != 1f || !first.clipped || Math.Abs(first.rms - .1f) > .00001f || output[0][0] != .75f)
            throw new Exception("Input peak must survive a quieter packet; float overload must reach the fader without hard clipping.");
        if (audio.Snapshot().channels[0].peak != 0f || !audio.Snapshot().channels[0].clipped)
            throw new Exception("Published peaks must reset while full-scale warning stays latched.");
        Set(audio, "clippedUntil", new long[] { System.Diagnostics.Stopwatch.GetTimestamp() - 1 });
        Packet(audio, .2f);
        var after = audio.Snapshot().channels[0];
        if (after.clipped || Math.Abs(after.peak - .2f) > .00001f) throw new Exception("Full-scale warning did not expire.");
        Set(audio, "meterLastPacketAt", 0L);
        var stale = audio.Snapshot().channels[0];
        if (stale.peak != 0f || stale.rms != 0f) throw new Exception("Stalled capture displayed an old input level.");
        foreach (var mode in new[] { "bad", null }) {
            try { audio.SetProcessing(mode, 60); throw new Exception("Invalid processing mode accepted."); }
            catch (ArgumentOutOfRangeException) { }
        }
        try { audio.SetProcessing("off", 55); throw new Exception("Invalid hum frequency accepted."); }
        catch (ArgumentOutOfRangeException) { }
    }

    private static void Packet(UsbAudio audio, float value)
    {
        var bytes = BitConverter.GetBytes(value); var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try {
            var wave = new WaveFormat { channels = 1, sampleRate = 48000, blockAlign = 4, bytesPerSample = 4, format = UsbAudioSampleFormat.Float32, IsSupported = true };
            typeof(UsbAudio).GetMethod("ProcessPacket", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(audio, new object[] { pin.AddrOfPinnedObject(), 1, false, wave });
        } finally { pin.Free(); }
    }

    private static void CheckProcessingPacket(string dll)
    {
        using (var processor = new UsbAudioProcessing(4, dll)) {
            if (!processor.NoiseReductionAvailable) throw new Exception(processor.Error);
            var output = new List<float[]>();
            var audio = new UsbAudio((samples, rate) => output.Add(samples));
            Set(audio, "channelCount", 4); Set(audio, "running", true); Set(audio, "processor", processor);
            Set(audio, "peaks", new float[4]); Set(audio, "rms", new float[4]); Set(audio, "clippedUntil", new long[4]);
            Set(audio, "levels", new[] { .5f, 1f, .25f, 1f }); Set(audio, "muted", new[] { false, true, false, false });
            const int frames = 2400;
            var bytes = new byte[frames * 16];
            float[] impulses = { 1.5f, 2f, -2f, .25f };
            for (int c = 0; c < 4; c++) Array.Copy(BitConverter.GetBytes(impulses[c]), 0, bytes, (c * 137 * 4 + c) * 4, 4);
            var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            try {
                var wave = new WaveFormat { channels = 4, sampleRate = 48000, blockAlign = 16, bytesPerSample = 4, format = UsbAudioSampleFormat.Float32, IsSupported = true };
                var method = typeof(UsbAudio).GetMethod("ProcessPacket", BindingFlags.Instance | BindingFlags.NonPublic);
                // A boundary in the middle of a 480-sample processing block must
                // not drop, repeat or misalign any physical microphone.
                method.Invoke(audio, new object[] { pin.AddrOfPinnedObject(), 317, false, wave });
                method.Invoke(audio, new object[] { IntPtr.Add(pin.AddrOfPinnedObject(), 317 * 16), frames - 317, false, wave });
            } finally { pin.Free(); }
            var mixed = new List<float>(); foreach (var packet in output) mixed.AddRange(packet);
            for (int n = 0; n < frames; n++) {
                float expected = n == 960 ? .75f : n == 960 + 2 * 137 ? -.5f : n == 960 + 3 * 137 ? .25f : 0f;
                if (mixed[n] != expected) throw new Exception("Capture-to-processor-to-fader mixing lost channel alignment, mute or float headroom.");
            }
            var snapshot = audio.Snapshot();
            if (!snapshot.channels[0].clipped || !snapshot.channels[1].clipped || !snapshot.channels[2].clipped || snapshot.channels[3].clipped)
                throw new Exception("Raw full-scale meters incorrectly followed processing/faders/mute.");
            audio.SetProcessing("gentle", 60);
            snapshot = audio.Snapshot();
            if (!snapshot.processing.available || snapshot.processing.noiseReduction != "gentle" || snapshot.processing.humFrequency != 60)
                throw new Exception("Actual processing selection was not published.");
            Console.WriteLine("PASS: real per-channel processor integrated before mute/faders, across partial capture packets.");
        }
    }
    private static void Set(object target, string name, object value) { typeof(UsbAudio).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(target, value); }
    private static object Get(object target, string name) { return typeof(UsbAudio).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(target); }

    private static void Check(byte[] value, UsbAudioSampleFormat format, int bytes, float expected, string label)
    {
        var pin = GCHandle.Alloc(value, GCHandleType.Pinned);
        try {
            var actual = UsbAudio.DecodeSample(pin.AddrOfPinnedObject(), 0, format, bytes);
            if (Math.Abs(actual - expected) > 0.00001f) throw new Exception(label + " failed: " + actual);
        } finally { pin.Free(); }
    }
}
