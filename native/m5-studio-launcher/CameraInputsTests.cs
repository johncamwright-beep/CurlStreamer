using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

internal static class CameraInputsTests
{
    private static int Main() {
        foreach (var host in new[] { "10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.20" }) if (!CameraInputs.PrivateIPv4(host)) throw new Exception("Private IPv4 rejected.");
        foreach (var host in new[] { "127.0.0.1", "8.8.8.8", "169.254.1.1", "172.32.0.1", "192.168.001.1", "192.168.1.1/path", "192.168.1.1\n", "::1" }) if (CameraInputs.PrivateIPv4(host)) throw new Exception("Invalid destination accepted.");
        var directory = Path.Combine(Path.GetTempPath(), "CurlStreamer-CameraInputs-" + Guid.NewGuid().ToString("N"));
        try {
            const string secret = "test-camera-local-secret";
            var sources = new Dictionary<string, Dictionary<string, object>> { { "camera-home", CameraInputs.Tapo("192.168.1.20", "local-user", secret, "stream1", 90) }, { "camera-away", CameraInputs.Phone() } };
            CameraInputs.Save(directory, sources);
            if (Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(directory, "CameraInputs.dat"))).Contains(secret)) throw new Exception("Password persisted as plaintext.");
            var loaded = CameraInputs.Load(directory);
            if ((string)loaded["camera-home"]["password"] != secret || (string)loaded["camera-away"]["kind"] != "phone") throw new Exception("Encrypted settings did not round trip.");
            sources["camera-home"] = CameraInputs.Phone(); CameraInputs.Save(directory, sources);
            if ((string)CameraInputs.Load(directory)["camera-home"]["kind"] != "phone") throw new Exception("Explicit source switch did not persist.");
            File.WriteAllBytes(Path.Combine(directory, "CameraInputs.dat"), new byte[] { 1, 2, 3 });
            bool rejected = false; try { CameraInputs.Load(directory); } catch { rejected = true; }
            if (!rejected) throw new Exception("Corrupt encrypted settings accepted.");
        } finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
        Console.WriteLine("PASS: private camera hosts, DPAPI encrypted round trip, explicit source switch and corrupt settings rejection.");
        return 0;
    }
}
