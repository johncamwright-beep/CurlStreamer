using System;
using System.IO;
using System.Text.RegularExpressions;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Collections.Generic;

internal static class WorkspacePolicy
{
    internal static bool KeepAwake(string streaming)
    {
        return streaming == "starting" || streaming == "armed" || streaming == "paused";
    }
    internal static bool SessionMessage(string source, string page, string origin)
    {
        // Reject stale documents as well as external origins. Account/dashboard
        // pages can observe and hold the current session, but cannot prepare one.
        return SameOrigin(source, origin) && SameOrigin(page, origin) && source == page;
    }
    internal static bool SessionPresentation(Dictionary<string, object> request, string selectedGame, string runningGame)
    {
        object type, game, nonce; Guid parsed;
        if (request == null || runningGame == null || !request.TryGetValue("type", out type) ||
            !request.TryGetValue("gameId", out game) || !Object.Equals(game, runningGame) ||
            !request.TryGetValue("nonce", out nonce) || !(nonce is string) ||
            !Guid.TryParseExact((string)nonce, "D", out parsed)) return false;
        if (Object.Equals(type, "studio-youtube-hold") || Object.Equals(type, "studio-youtube-resume")) return request.Count == 3;
        return selectedGame == runningGame &&
            ((Object.Equals(type, "studio-ending-show") && request.Count == 5) ||
             (request.Count == 3 && (Object.Equals(type, "studio-ending-prepare") || Object.Equals(type, "studio-ending-cancel") || Object.Equals(type, "studio-ending-finish"))));
    }
    internal static bool KeepUsbSession(string usbGame, string runningGame, bool active)
    {
        return active && usbGame != null && usbGame == runningGame;
    }
    internal static bool CanStartSession(string runningGame, string requestedGame)
    {
        return requestedGame != null && (runningGame == null || runningGame == requestedGame);
    }
    internal static bool CanConfigureSession(string selectedGame, string runningGame)
    {
        return selectedGame != null && (runningGame == null || selectedGame == runningGame);
    }
    internal static bool CameraZoomRequest(Dictionary<string, object> request, string selectedGame, string runningGame,
        out string role, out int generation, out double zoom, out string nonce)
    {
        role = nonce = null; generation = 0; zoom = 1;
        object action, game, cameraRole, sourceGeneration, value, requestNonce; Guid parsedNonce;
        if (request == null || request.Count != 6 || selectedGame == null || selectedGame != runningGame ||
            !request.TryGetValue("action", out action) || !Object.Equals(action, "zoom-camera") ||
            !request.TryGetValue("gameId", out game) || !Object.Equals(game, runningGame) ||
            !request.TryGetValue("cameraRole", out cameraRole) || !(cameraRole is string) ||
            ((string)cameraRole != "camera-home" && (string)cameraRole != "camera-away") ||
            !request.TryGetValue("generation", out sourceGeneration) || !(sourceGeneration is int) || (int)sourceGeneration < 0 ||
            !request.TryGetValue("value", out value) || !(value is int || value is decimal || value is double) ||
            !request.TryGetValue("nonce", out requestNonce) || !(requestNonce is string) ||
            !Guid.TryParseExact((string)requestNonce, "D", out parsedNonce)) return false;
        var requestedZoom = Convert.ToDouble(value);
        if (Double.IsNaN(requestedZoom) || Double.IsInfinity(requestedZoom) || requestedZoom < 1 || requestedZoom > 4 ||
            Math.Abs(requestedZoom * 10 - Math.Round(requestedZoom * 10)) > 0.000001) return false;
        role = (string)cameraRole; generation = (int)sourceGeneration; zoom = requestedZoom; nonce = (string)requestNonce;
        return true;
    }
    internal static bool CameraZoomSource(object inputs, string role, int generation)
    {
        var map = inputs as Dictionary<string, object>; object slot, sourceGeneration, kind;
        var source = map != null && map.TryGetValue(role, out slot) ? slot as Dictionary<string, object> : null;
        return source != null && source.TryGetValue("kind", out kind) && (Object.Equals(kind, "tapo") || Object.Equals(kind, "rtsp")) &&
            source.TryGetValue("generation", out sourceGeneration) && sourceGeneration is int && (int)sourceGeneration == generation;
    }
    internal static object MergeCameraZoomInputs(object current, object received, string role, int generation)
    {
        if (!CameraZoomSource(current, role, generation) || !CameraZoomSource(received, role, generation)) throw new InvalidDataException();
        var merged = new Dictionary<string, object>((Dictionary<string, object>)current);
        merged[role] = ((Dictionary<string, object>)received)[role];
        return merged;
    }
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
    internal static async System.Threading.Tasks.Task RecoverYouTube(
        Func<System.Threading.Tasks.Task> disconnect, Func<bool> currentGame,
        Func<System.Threading.Tasks.Task> connect)
    {
        if (!currentGame()) throw new InvalidOperationException();
        // The previous sender must exit before a new once-only session is paired.
        await disconnect();
        if (!currentGame()) throw new InvalidOperationException();
        await connect();
    }
    internal static bool SameOrigin(string value, string origin)
    {
        Uri url;
        return Uri.TryCreate(value, UriKind.Absolute, out url) && url.Scheme == "https" &&
            url.UserInfo.Length == 0 && url.GetLeftPart(UriPartial.Authority) == origin;
    }
    internal static bool Microphone(string request, string page, string origin, string selectedGame, bool userInitiated)
    {
        return userInitiated && selectedGame != null && SameOrigin(request, origin) &&
            Game(page, origin) == selectedGame && new Uri(page).AbsolutePath == "/score/" + selectedGame;
    }
    internal static bool YouTubeAccountConnection(string value, string origin)
    {
        return SameOrigin(value, origin) &&
            new Uri(value).AbsolutePath == "/api/settings/youtube/oauth/start" &&
            new Uri(value).Query.Length == 0 && new Uri(value).Fragment.Length == 0;
    }
    internal static string YouTubeFailure(string code)
    {
        switch (code) {
            case "youtube_broadcast_terminal":
            case "stopped":
                return "YouTube has ended this broadcast and cannot resume its saved link. Open YouTube settings to review it. A new broadcast needs a new game; this game's score and recording are kept.";
            case "studio_recovery_pending":
                return "The previous Studio connection is still expiring. Wait up to 35 seconds, then reconnect to this game's saved YouTube link.";
            case "youtube_reconnect_required":
                return "Reconnect your existing YouTube channel in Account & Settings > YouTube Settings using your regular browser, then try again.";
            case "subscription_required":
                return "Broadcast access is required. Open Account & Settings > Trial & subscription.";
            case "broadcast_operation_uncertain":
            case "broadcast_discovery_incomplete":
                return "YouTube broadcast recovery is pending. Check the game's YouTube status before trying again.";
            default:
                return "YouTube could not prepare this broadcast. Test the connection in Account & Settings > YouTube Settings before retrying.";
        }
    }
    internal static bool ExternalYouTube(string value)
    {
        Uri url;
        if (!Uri.TryCreate(value, UriKind.Absolute, out url) || url.Scheme != "https" ||
            !url.IsDefaultPort || url.UserInfo.Length != 0) return false;
        return url.Host == "studio.youtube.com" ||
            (url.Host == "www.youtube.com" && url.AbsolutePath == "/watch" &&
             Regex.IsMatch(url.Query, @"^\?v=[A-Za-z0-9_-]{11}$") && url.Fragment.Length == 0);
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
