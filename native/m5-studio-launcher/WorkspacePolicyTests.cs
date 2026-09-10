using System;
using System.IO;
internal static class WorkspacePolicyTests
{
    private static void Assert(bool pass) { if (!pass) throw new Exception("Workspace boundary regression"); }
    private static int Main()
    {
        const string origin = "https://studio.example", id = "11111111-1111-4111-8111-111111111111";
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
