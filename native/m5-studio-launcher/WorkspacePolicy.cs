using System;
using System.IO;
using System.Text.RegularExpressions;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal static class WorkspacePolicy
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    internal static string ExistingDirectory(string folder)
    {
        // Resolve Windows package redirection before passing the folder to Explorer.
        using (var handle = CreateFile(folder, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new IOException();
            var path = new StringBuilder(32768);
            var length = GetFinalPathNameByHandle(handle, path, (uint)path.Capacity, 0);
            if (length == 0 || length >= path.Capacity) throw new IOException();
            var result = path.ToString();
            if (!Regex.IsMatch(result, @"^\\\\\?\\[A-Za-z]:\\")) throw new IOException();
            return result.Substring(4);
        }
    }
    internal static bool RestartYouTube(string pairing, string streaming)
    {
        return pairing == "stopped" || pairing == "failed" || streaming == "stopped" || streaming == "failed";
    }
    internal static bool SameOrigin(string value, string origin)
    {
        Uri url;
        return Uri.TryCreate(value, UriKind.Absolute, out url) && url.Scheme == "https" &&
            url.UserInfo.Length == 0 && url.GetLeftPart(UriPartial.Authority) == origin;
    }
    internal static string Game(string value, string origin)
    {
        if (!SameOrigin(value, origin)) return null;
        var match = Regex.Match(new Uri(value).AbsolutePath, @"^/(?:games|score|broadcast)/([a-fA-F0-9-]{36})(?:/(?:studio|edit))?/?$");
        Guid id;
        return match.Success && Guid.TryParse(match.Groups[1].Value, out id) ? id.ToString() : null;
    }
    internal static string Code(string source, string origin, string gameId)
    {
        if (!SameOrigin(source, origin)) throw new InvalidDataException();
        var url = new Uri(source);
        if (url.AbsolutePath != "/studio-m3/" + gameId + "/program" || url.Query.Length != 0 ||
            !Regex.IsMatch(url.Fragment, @"^#code=[A-Za-z0-9_-]{43}$")) throw new InvalidDataException();
        return url.Fragment.Substring(6);
    }
    internal static bool Loopback(string address)
    {
        Uri uri;
        return Uri.TryCreate(address, UriKind.Absolute, out uri) && uri.Scheme == "http" &&
            uri.Host == "127.0.0.1" && uri.Port > 0 && uri.Port <= 65535 &&
            uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0;
    }
}

internal static class ProgramPreview
{
    internal static byte[] Read(string previewMapping) {
        const string prefix = "Local\\CurlStreamerPreview-";
        const int bitmapLength = 54 + 1280 * 720 * 4;
        if (previewMapping == null || !previewMapping.StartsWith(prefix) || previewMapping.Length != prefix.Length + 32) return null;
        foreach (char c in previewMapping.Substring(prefix.Length)) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) return null;
        using (var mapping = System.IO.MemoryMappedFiles.MemoryMappedFile.OpenExisting(previewMapping, System.IO.MemoryMappedFiles.MemoryMappedFileRights.Read))
        using (var view = mapping.CreateViewAccessor(0, 16 + bitmapLength, System.IO.MemoryMappedFiles.MemoryMappedFileAccess.Read)) {
            for (int attempt = 0; attempt < 4; attempt++) {
            var before = view.ReadInt32(0);
            if (before <= 0 || view.ReadInt32(4) != bitmapLength) return null;
            if ((before & 1) != 0) { System.Threading.Thread.Sleep(1); continue; }
            var age = DateTime.UtcNow - DateTime.FromFileTimeUtc(view.ReadInt64(8));
            if (age.TotalSeconds < -1 || age.TotalSeconds > 3) return null;
            System.Threading.Thread.MemoryBarrier();
            byte[] bytes = new byte[bitmapLength]; view.ReadArray(16, bytes, 0, bytes.Length);
            System.Threading.Thread.MemoryBarrier();
            if (before != view.ReadInt32(0)) continue;
            if (bytes[0] != 'B' || bytes[1] != 'M') return null;
            return bytes;
            }
            return null;
        }
    }
}
