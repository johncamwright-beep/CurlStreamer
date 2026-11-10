using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class CameraInputsTests
{
    private static void Reject(Action action) { bool rejected = false; try { action(); } catch { rejected = true; } if (!rejected) throw new Exception("Invalid camera settings accepted."); }
    private static void WriteLegacy(string directory, Dictionary<string, Dictionary<string, object>> sources) {
        Directory.CreateDirectory(directory);
        var bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(sources));
        try {
            var entropy = Encoding.UTF8.GetBytes("CurlStreamer.Studio.CameraInputs.v1");
            File.WriteAllBytes(Path.Combine(directory, "CameraInputs.dat"), ProtectedData.Protect(bytes, entropy, DataProtectionScope.CurrentUser));
        } finally { Array.Clear(bytes, 0, bytes.Length); }
    }
    private static int Main() {
        CameraInputs.Rtsp("192.168.1.20", 554, "user", "p@ss#:%", "/live", 0);
        CameraInputs.Rtsp("192.168.1.20", 554, "user", "short-é", "/live", 0);
        CameraInputs.Rtsp("192.168.1.20", 554, "u", new string('a', 125), "/live", 0);
        Reject(() => CameraInputs.Rtsp("192.168.1.20", 554, "u", new string('a', 126), "/live", 0));
        Reject(() => CameraInputs.Rtsp("192.168.1.20", 554, "user", new string('@', 41), "/live", 0));
        Reject(() => CameraInputs.Rtsp("192.168.1.20", 554, "user", new string('é', 21), "/live", 0));
        CameraInputs.Tapo("192.168.1.20", "user", new string('@', 80), "stream1", 0);
        var legacySaved = CameraInputs.ParseAddress("192.168.1.20", 554, "user", new string('@', 80), "/stream1", 90, true);
        if ((string)legacySaved["kind"] != "tapo" || (string)legacySaved["password"] != new string('@', 80) || (string)legacySaved["stream"] != "stream1") throw new Exception("Tapo preset did not preserve legacy login.");
        var pastedTapo = CameraInputs.ParseAddress("rtsp://user:" + new string('a', 160) + "@192.168.1.20/stream2", 554, "", "", "/stream1", 0, true);
        if ((string)pastedTapo["kind"] != "tapo" || (string)pastedTapo["stream"] != "stream2") throw new Exception("Pasted Tapo preset migrated unexpectedly.");
        var escaped = CameraInputs.ParseAddress("rtsp://192.168.1.20/live%2Ftrack?token=a%26b&value=x%2Fy", 554, "", "", "/", 0);
        if ((string)escaped["path"] != "/live%2Ftrack?token=a%26b&value=x%2Fy") throw new Exception("Escaped RTSP path or query changed.");
        var anonymous = CameraInputs.Rtsp("192.168.1.20", 8554, "", "", "/live?channel=1", 0);
        if ((string)anonymous["kind"] != "rtsp" || (int)anonymous["port"] != 8554) throw new Exception("Anonymous custom RTSP rejected.");
        var pasted = CameraInputs.ParseAddress("rtsp://local%40user:private%3Asecret@192.168.1.20:8554/live?channel=1", 554, "", "", "/", 270);
        if ((string)pasted["host"] != "192.168.1.20" || (string)pasted["username"] != "local@user" || (string)pasted["password"] != "private:secret" || (string)pasted["path"] != "/live?channel=1" || (int)pasted["port"] != 8554) throw new Exception("Pasted address did not parse locally.");
        var defaultPort = CameraInputs.ParseAddress("rtsp://192.168.1.20/stream1", 1234, "", "", "/", 0);
        if ((int)defaultPort["port"] != 554) throw new Exception("Default RTSP port incorrect.");
        foreach (var path in new[] { "live", "/has space", "/bad#fragment", "/bad\\path", "/bad\n", "/bad\u007f", new string('/', 1025) }) Reject(() => CameraInputs.Rtsp("192.168.1.20", 554, "", "", path, 0));
        foreach (var port in new[] { 0, 65536 }) Reject(() => CameraInputs.Rtsp("192.168.1.20", port, "", "", "/", 0));
        foreach (var address in new[] { "rtsp://8.8.8.8/live", "rtsp://camera.local/live", "https://192.168.1.20/live", "rtsp://192.168.001.20/live", "rtsp://192.168.1.20/live#fragment" }) Reject(() => CameraInputs.ParseAddress(address, 554, "", "", "/", 0));
        Reject(() => CameraInputs.Rtsp("192.168.1.20", 554, "bad\u0001", "", "/", 0));
        Reject(() => CameraInputs.Rtsp("192.168.1.20", 554, "", "", "/", 45));
        var extra = new Dictionary<string, object>(anonymous); extra["extra"] = "unexpected"; Reject(() => CameraInputs.Validate(extra));

        foreach (var host in new[] { "10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.20" }) if (!CameraInputs.PrivateIPv4(host)) throw new Exception("Private IPv4 rejected.");
        foreach (var host in new[] { "127.0.0.1", "8.8.8.8", "169.254.1.1", "172.32.0.1", "192.168.001.1", "192.168.1.1/path", "192.168.1.1\n", "::1" }) if (CameraInputs.PrivateIPv4(host)) throw new Exception("Invalid destination accepted.");
        var directory = Path.Combine(Path.GetTempPath(), "CurlStreamer-CameraInputs-" + Guid.NewGuid().ToString("N"));
        var legacy = Path.Combine(directory, "legacy");
        var stable = Path.Combine(directory, "stable");
        var stableFile = Path.Combine(stable, "CameraInputs.dat");
        try {
            const string secret = "test-camera-local-secret";
            var sources = new Dictionary<string, Dictionary<string, object>> { { "camera-home", CameraInputs.Tapo("192.168.1.20", "local-user", secret, "stream1", 90) }, { "camera-away", CameraInputs.Phone() } };
            if (CameraInputs.LoadProfile(stable, legacy).Count != 0 || Directory.Exists(stable)) throw new Exception("Fresh profile unexpectedly wrote camera settings.");
            WriteLegacy(legacy, sources);
            var loaded = CameraInputs.LoadProfile(stable, legacy);
            if ((string)loaded["camera-home"]["password"] != secret || (string)loaded["camera-away"]["kind"] != "phone") throw new Exception("Legacy settings did not migrate.");
            if ((string)CameraInputs.Load(legacy)["camera-home"]["password"] != secret) throw new Exception("The legacy profile changed during migration.");
            if (Encoding.UTF8.GetString(File.ReadAllBytes(stableFile)).Contains(secret)) throw new Exception("Password persisted as plaintext.");
            using (var start = new ManualResetEventSlim(false)) {
                var first = Task.Run(() => { start.Wait(); CameraInputs.SaveSlot(stable, legacy, "camera-home", pasted); });
                var second = Task.Run(() => { start.Wait(); CameraInputs.SaveSlot(stable, legacy, "camera-away", anonymous); });
                start.Set();
                Task.WaitAll(first, second);
            }
            var rtspLoaded = CameraInputs.LoadProfile(stable, Path.Combine(directory, "different-launch-context"));
            if ((string)rtspLoaded["camera-home"]["password"] != "private:secret" || (int)rtspLoaded["camera-away"]["port"] != 8554) throw new Exception("Generic RTSP settings did not round trip.");
            CameraInputs.SaveSlot(stable, legacy, "camera-home", CameraInputs.Phone());
            var phone = CameraInputs.LoadProfile(stable, legacy)["camera-home"];
            var active = CameraInputs.ActiveSource(phone);
            if (active.Count != 1 || (string)active["kind"] != "phone") throw new Exception("Explicit source switch or controller payload is incorrect.");
            var previousIp = CameraInputs.RememberedIp(phone);
            if ((string)previousIp["password"] != "private:secret" || (int)previousIp["rotation"] != 270) throw new Exception("Switching to Phone lost the previous IP source.");
            if (Encoding.UTF8.GetString(File.ReadAllBytes(stableFile)).Contains("private:secret")) throw new Exception("Remembered RTSP password persisted as plaintext.");
            CameraInputs.SaveSlot(stable, legacy, "camera-home", previousIp);
            if ((string)CameraInputs.LoadProfile(stable, legacy)["camera-home"]["kind"] != "rtsp") throw new Exception("Returning to the previous IP source failed.");
            File.WriteAllBytes(stableFile, new byte[] { 1, 2, 3 });
            Reject(() => CameraInputs.LoadProfile(stable, legacy));
            Reject(() => CameraInputs.SaveSlot(stable, legacy, "camera-home", pasted));
            if (new FileInfo(stableFile).Length != 3) throw new Exception("A failed save replaced unreadable settings.");
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
        Console.WriteLine("PASS: camera validation, encrypted legacy migration, concurrent slot updates, Phone/IP round trip and corrupt settings rejection.");
        return 0;
    }
}
