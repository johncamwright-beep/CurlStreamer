using System;
using System.IO;
using System.Collections.Generic;
internal static class WorkspacePolicyTests
{
    private static void Assert(bool pass) { if (!pass) throw new Exception("Workspace boundary regression"); }
    private static int Main()
    {
        foreach (var phase in new[] { "starting", "armed", "paused" }) Assert(WorkspacePolicy.KeepAwake(phase));
        foreach (var phase in new[] { null, "idle", "stopped", "failed", "stopping" }) Assert(!WorkspacePolicy.KeepAwake(phase));
        var recoverySteps = new List<string>();
        var stoppedSender = new System.Threading.Tasks.TaskCompletionSource<bool>();
        var reconnect = WorkspacePolicy.RecoverYouTube(
            () => { recoverySteps.Add("disconnect"); return stoppedSender.Task; },
            () => true,
            () => { recoverySteps.Add("connect"); return System.Threading.Tasks.Task.FromResult(true); });
        Assert(recoverySteps.Count == 1 && !reconnect.IsCompleted);
        stoppedSender.SetResult(true); reconnect.GetAwaiter().GetResult();
        Assert(String.Join(",", recoverySteps) == "disconnect,connect");
        var currentGame = true; var reconnected = false; var fenced = false;
        try {
            WorkspacePolicy.RecoverYouTube(
                () => { currentGame = false; return System.Threading.Tasks.Task.FromResult(true); },
                () => currentGame,
                () => { reconnected = true; return System.Threading.Tasks.Task.FromResult(true); }).GetAwaiter().GetResult();
        } catch (InvalidOperationException) { fenced = true; }
        Assert(fenced && !reconnected);
        fenced = false;
        try {
            WorkspacePolicy.RecoverYouTube(
                () => { throw new InvalidOperationException(); }, () => true,
                () => { reconnected = true; return System.Threading.Tasks.Task.FromResult(true); }).GetAwaiter().GetResult();
        } catch (InvalidOperationException) { fenced = true; }
        Assert(fenced && !reconnected);
        const string origin = "https://studio.example", id = "11111111-1111-4111-8111-111111111111";
        const string otherId = "22222222-2222-4222-8222-222222222222";
        foreach (var path in new[] { "/dashboard", "/account", "/score/" + id }) {
            Assert(WorkspacePolicy.SessionMessage(origin + path, origin + path, origin));
            Assert(!WorkspacePolicy.SessionMessage("https://attacker.example" + path, origin + path, origin));
        }
        Assert(!WorkspacePolicy.SessionMessage(origin + "/score/" + id, origin + "/account", origin));
        var sessionCommand = new Dictionary<string, object> { { "type", "studio-youtube-hold" }, { "gameId", id }, { "nonce", Guid.NewGuid().ToString("D") } };
        Assert(WorkspacePolicy.SessionPresentation(sessionCommand, null, id));
        Assert(WorkspacePolicy.SessionPresentation(sessionCommand, otherId, id));
        Assert(!WorkspacePolicy.SessionPresentation(sessionCommand, id, otherId));
        Assert(!WorkspacePolicy.SessionPresentation(sessionCommand, id, null));
        sessionCommand["type"] = "studio-ending-prepare";
        Assert(WorkspacePolicy.SessionPresentation(sessionCommand, id, id));
        Assert(!WorkspacePolicy.SessionPresentation(sessionCommand, null, id));
        Assert(!WorkspacePolicy.SessionPresentation(sessionCommand, otherId, id));
        sessionCommand["type"] = "studio-youtube-resume"; sessionCommand["nonce"] = "invalid";
        Assert(!WorkspacePolicy.SessionPresentation(sessionCommand, id, id));
        sessionCommand["nonce"] = Guid.NewGuid().ToString("D"); sessionCommand["url"] = "http://attacker.example";
        Assert(!WorkspacePolicy.SessionPresentation(sessionCommand, id, id));
        Assert(WorkspacePolicy.KeepUsbSession(id, id, true));
        Assert(!WorkspacePolicy.KeepUsbSession(id, otherId, true));
        Assert(!WorkspacePolicy.KeepUsbSession(id, id, false));
        Assert(!WorkspacePolicy.KeepUsbSession(id, null, false));
        Assert(WorkspacePolicy.CanStartSession(null, id));
        Assert(WorkspacePolicy.CanStartSession(id, id));
        Assert(!WorkspacePolicy.CanStartSession(id, otherId));
        Assert(WorkspacePolicy.CanConfigureSession(id, null));
        Assert(WorkspacePolicy.CanConfigureSession(id, id));
        Assert(!WorkspacePolicy.CanConfigureSession(otherId, id));
        Assert(!WorkspacePolicy.CanConfigureSession(null, id));
        var zoomRequest = new Dictionary<string, object> { { "action", "zoom-camera" }, { "gameId", id }, { "cameraRole", "camera-home" }, { "generation", 3 }, { "value", 2.5m }, { "nonce", Guid.NewGuid().ToString("D") } };
        string role, nonce; int generation; double zoom;
        Assert(WorkspacePolicy.CameraZoomRequest(zoomRequest, id, id, out role, out generation, out zoom, out nonce));
        Assert(role == "camera-home" && generation == 3 && zoom == 2.5);
        Assert(!WorkspacePolicy.CameraZoomRequest(zoomRequest, null, id, out role, out generation, out zoom, out nonce));
        Assert(!WorkspacePolicy.CameraZoomRequest(zoomRequest, id, "other-game", out role, out generation, out zoom, out nonce));
        foreach (var invalid in new object[] { true, "2", 0.9, 4.1, 2.55, Double.NaN, Double.PositiveInfinity }) {
            var request = new Dictionary<string, object>(zoomRequest); request["value"] = invalid;
            Assert(!WorkspacePolicy.CameraZoomRequest(request, id, id, out role, out generation, out zoom, out nonce));
        }
        foreach (var field in new[] { "gameId", "cameraRole", "generation", "nonce" }) {
            var request = new Dictionary<string, object>(zoomRequest); request[field] = "invalid";
            Assert(!WorkspacePolicy.CameraZoomRequest(request, id, id, out role, out generation, out zoom, out nonce));
        }
        var extraZoomField = new Dictionary<string, object>(zoomRequest); extraZoomField["url"] = "http://other.example";
        Assert(!WorkspacePolicy.CameraZoomRequest(extraZoomField, id, id, out role, out generation, out zoom, out nonce));
        var zoomSources = new Dictionary<string, object> { { "camera-home", new Dictionary<string, object> { { "kind", "tapo" }, { "generation", 3 } } } };
        Assert(WorkspacePolicy.CameraZoomSource(zoomSources, "camera-home", 3));
        Assert(!WorkspacePolicy.CameraZoomSource(zoomSources, "camera-home", 2));
        Assert(!WorkspacePolicy.CameraZoomSource(zoomSources, "camera-away", 3));
        var otherSource = new Dictionary<string, object> { { "kind", "rtsp" }, { "generation", 8 }, { "zoom", 3.0 } };
        zoomSources["camera-away"] = otherSource;
        var receivedSources = new Dictionary<string, object> {
            { "camera-home", new Dictionary<string, object> { { "kind", "tapo" }, { "generation", 3 }, { "zoom", 2.5 } } },
            { "camera-away", new Dictionary<string, object> { { "kind", "rtsp" }, { "generation", 8 }, { "zoom", 1.0 } } }
        };
        var mergedSources = (Dictionary<string, object>)WorkspacePolicy.MergeCameraZoomInputs(zoomSources, receivedSources, "camera-home", 3);
        Assert(Object.ReferenceEquals(mergedSources["camera-away"], otherSource));
        Assert((double)((Dictionary<string, object>)mergedSources["camera-home"])["zoom"] == 2.5);
        bool staleZoomDenied = false;
        try { WorkspacePolicy.MergeCameraZoomInputs(zoomSources, receivedSources, "camera-home", 2); } catch (InvalidDataException) { staleZoomDenied = true; }
        Assert(staleZoomDenied);
        ((Dictionary<string, object>)zoomSources["camera-home"])["kind"] = "phone";
        Assert(!WorkspacePolicy.CameraZoomSource(zoomSources, "camera-home", 3));
        Assert(WorkspacePolicy.Microphone(origin, origin + "/score/" + id, origin, id, true));
        Assert(!WorkspacePolicy.Microphone(origin, origin + "/score/" + id, origin, id, false));
        Assert(!WorkspacePolicy.Microphone("https://other.example", origin + "/score/" + id, origin, id, true));
        Assert(!WorkspacePolicy.Microphone(origin, origin + "/dashboard", origin, id, true));
        Assert(!WorkspacePolicy.Microphone(origin, origin + "/score/" + id, origin, null, true));
        Assert(!WorkspacePolicy.Microphone(origin, "https://other.example/score/" + id, origin, id, true));
        foreach (var path in new[] { "/games/" + id, "/games/" + id + "/studio", "/score/" + id, "/games/" + id + "/edit", "/broadcast/" + id })
            Assert(WorkspacePolicy.Game(origin + path, origin) == id);
        foreach (var value in new[] { "https://studio.example.attacker/games/" + id, "http://studio.example/games/" + id, origin + ":444/games/" + id, "https://user:pass@studio.example/games/" + id, origin + "/games/new", origin + "/games/not-a-game", origin + "/studio-m3/" + id + "/program" })
            Assert(WorkspacePolicy.Game(value, origin) == null);
        var source = origin + "/studio-m3/" + id + "/program#code=" + new string('a', 43);
        Assert(WorkspacePolicy.Code(source, origin, id) == new string('a', 43));
        foreach (var value in new[] { source.Replace("studio.example", "other.example"), source.Replace(id, "22222222-2222-4222-8222-222222222222"), source.Replace("#", "?token=secret#"), source + "&command=stream", source.Replace("program#", "program/elsewhere#") }) {
            bool denied = false; try { WorkspacePolicy.Code(value, origin, id); } catch (InvalidDataException) { denied = true; }
            Assert(denied);
        }
        Assert(WorkspacePolicy.Loopback("http://127.0.0.1:12345"));
        foreach (var address in new[] { "http://localhost:12345", "https://127.0.0.1:12345", "http://127.0.0.1:12345/command", "http://user@127.0.0.1:12345", "http://127.0.0.1:12345?secret=x" }) Assert(!WorkspacePolicy.Loopback(address));
        Assert(WorkspacePolicy.YouTubeAccountConnection(origin + "/api/settings/youtube/oauth/start", origin));
        foreach (var value in new[] { "https://attacker.example/api/settings/youtube/oauth/start", origin + "/api/settings/youtube/oauth/start?redirect=evil", origin + "/api/settings/youtube/oauth/start#secret", origin + "/api/settings/youtube/oauth/callback", "https://user@studio.example/api/settings/youtube/oauth/start" })
            Assert(!WorkspacePolicy.YouTubeAccountConnection(value, origin));
        Assert(WorkspacePolicy.YouTubeFailure("youtube_reconnect_required").Contains("regular browser"));
        Assert(!WorkspacePolicy.YouTubeFailure("secret-token").Contains("secret-token"));
        Assert(WorkspacePolicy.RestartYouTube("stopped", "stopped"));
        Assert(WorkspacePolicy.ExternalYouTube("https://www.youtube.com/watch?v=abcdefgh_-1"));
        Assert(WorkspacePolicy.ExternalYouTube("https://studio.youtube.com/channel/example"));
        foreach (var value in new[] { "http://www.youtube.com/watch?v=abcdefgh_-1", "https://www.youtube.com.attacker/watch?v=abcdefgh_-1", "https://user@www.youtube.com/watch?v=abcdefgh_-1", "https://www.youtube.com:444/watch?v=abcdefgh_-1", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/redirect?v=abcdefgh_-1", "https://www.youtube.com/watch?v=abcdefgh_-1&redirect=x" }) Assert(!WorkspacePolicy.ExternalYouTube(value));
        Assert(WorkspacePolicy.RestartYouTube("failed", "idle"));
        Assert(WorkspacePolicy.RestartYouTube("paired", "failed"));
        Assert(!WorkspacePolicy.RestartYouTube("unpaired", "idle"));
        Assert(!WorkspacePolicy.RestartYouTube("paired", "armed"));
        Assert(ProgramPreview.Read(null) == null);
        Assert(ProgramPreview.Read("Local\\OtherProgram") == null);
        var mappingName = "Local\\CurlStreamerPreview-" + Guid.NewGuid().ToString("N");
        const int bitmapLength = 54 + 1280 * 720 * 4;
        using (var mapping = System.IO.MemoryMappedFiles.MemoryMappedFile.CreateNew(mappingName, 16 + bitmapLength))
        using (var view = mapping.CreateViewAccessor()) {
            view.Write(0, 2); view.Write(4, bitmapLength); view.Write(8, DateTime.UtcNow.ToFileTimeUtc());
            view.Write(16, (byte)'B'); view.Write(17, (byte)'M');
            Assert(ProgramPreview.Read(mappingName).Length == bitmapLength);
            view.Write(0, 3); Assert(ProgramPreview.Read(mappingName) == null);
            view.Write(0, 4); view.Write(8, DateTime.UtcNow.AddSeconds(-10).ToFileTimeUtc());
            Assert(ProgramPreview.Read(mappingName) == null);
        }
        Console.WriteLine("PASS: workspace origin/game isolation, private handoff scope and loopback boundaries.");
        return 0;
    }
}
