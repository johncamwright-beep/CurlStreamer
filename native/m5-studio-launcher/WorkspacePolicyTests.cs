using System;
using System.IO;
internal static class WorkspacePolicyTests
{
    private static void Assert(bool pass) { if (!pass) throw new Exception("Workspace boundary regression"); }
    private static int Main()
    {
        const string origin = "https://studio.example", id = "11111111-1111-4111-8111-111111111111";
        foreach (var path in new[] { "/games/" + id, "/games/" + id + "/studio", "/score/" + id, "/games/" + id + "/edit" })
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
        Console.WriteLine("PASS: workspace origin/game isolation, private handoff scope and loopback boundaries.");
        return 0;
    }
}
