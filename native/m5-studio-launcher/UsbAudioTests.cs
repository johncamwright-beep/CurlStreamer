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
        Check(BitConverter.GetBytes(Single.NaN), UsbAudioSampleFormat.Float32, 4, 0f, "Float32 NaN normalization");
        if (UsbAudio.MixMono(.25f, 4) != .25f || UsbAudio.MixMono(.25f, 2) != .25f || UsbAudio.MixMono(1f, 0) != 0f || UsbAudio.MixMono(2f, 4) != 2f) throw new Exception("Mono mix lost microphone level or float headroom.");
        CheckFourChannelPacket();
        Console.WriteLine("PASS: PCM16/24/32, float normalization, mute and mono mixing.");
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
        if (!audio.Snapshot().channels[1].muted) throw new Exception("Master mute changed an individual microphone selection.");
        var peaks = (float[])Get(audio, "peaks"); var rms = (float[])Get(audio, "rms");
        for (int i = 0; i < 4; i++) if (Math.Abs(peaks[i] - Math.Abs(values[i])) > .00001f || Math.Abs(rms[i] - Math.Abs(values[i])) > .00001f) throw new Exception("Per-channel meter indexing failed.");
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
