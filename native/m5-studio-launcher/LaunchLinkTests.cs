using System;
using System.IO;
internal static class LaunchLinkTests
{
    private static int Main()
    {
        var page = "https://curlstreamer.vercel.app/games/11111111-1111-4111-8111-111111111111";
        var link = "curlstreamer://open?game=" + Uri.EscapeDataString(page);
        if (Studio.ReadLaunchGame(link) != page) throw new Exception("Game not preserved");
        foreach (var invalid in new[] {
            "https://example.com", link + "&command=record", link + "#secret", link.Replace("//open", "//other"),
            "curlstreamer://open?game=" + Uri.EscapeDataString(page + "#code=secret"),
            "curlstreamer://open?game=" + Uri.EscapeDataString(page + "?token=secret"),
            "curlstreamer://open?game=" + Uri.EscapeDataString(page.Replace("https:", "http:")),
            "curlstreamer://open?game=" + Uri.EscapeDataString(page.Replace("https://", "https://user:password@")),
            "curlstreamer://open?game=" + Uri.EscapeDataString(page.Replace("11111111-1111-4111-8111-111111111111", "------------------------------------"))
        }) {
            bool rejected = false;
            try { Studio.ReadLaunchGame(invalid); } catch (InvalidDataException) { rejected = true; }
            if (!rejected) throw new Exception("Invalid launch input accepted");
        }
        Console.WriteLine("PASS: launch URL selects only a game; extra commands, secrets and malformed URLs rejected.");
        return 0;
    }
}
