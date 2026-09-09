// Real WebView2 test with intercepted fixture resources and a fresh profile.
// No account, hosted game, controller, recording or broadcast is touched.
using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
internal static class WorkspaceHandoffTests
{
    [STAThread]
    private static int Main()
    {
        const string origin = "https://studio.example", id = "11111111-1111-4111-8111-111111111111";
        var root = AppDomain.CurrentDomain.BaseDirectory;
        var config = Path.Combine(root, "studio.json");
        File.WriteAllText(config, "{\"website\":\"" + origin + "\"}");
        string hash;
        using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(config))).Replace("-", "").ToLowerInvariant();
        Application.EnableVisualStyles();
        var form = new Workspace(origin + "/games/" + id, "", "", hash, Path.Combine(root, "FixtureProfile"));
        form.ShowInTaskbar = false; form.Opacity = 0;
        var web = (WebView2)typeof(Workspace).GetField("web", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form);
        var prepare = typeof(Workspace).GetMethod("PrepareGrant", BindingFlags.Instance | BindingFlags.NonPublic);
        var output = Path.Combine(root, "handoff-result.txt");
        int mode = 0, requests = 0, result = 1; bool ran = false;
        var timeout = new Timer { Interval = 60000 };
        timeout.Tick += (s, e) => { File.WriteAllText(output, "FAIL: WebView fixture timed out."); Environment.Exit(1); };
        timeout.Start();
        web.CoreWebView2InitializationCompleted += (s, e) => {
            File.AppendAllText(Path.Combine(root, "fixture-progress.txt"), "Initialized: " + e.IsSuccess + "\n");
            if (!e.IsSuccess) return;
            var core = web.CoreWebView2;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (sender, args) => {
                if (args.Request.Uri.StartsWith(origin + "/__studio-preview/")) return;
                var api = args.Request.Uri.Contains("/api/games/");
                if (api) requests++;
                var body = api ? "{\"sourceUrl\":\"" + origin + "/studio-m3/" + (mode == 1 ? "22222222-2222-4222-8222-222222222222" : id) + "/program#code=" + new string('a',43) + "\"}" : "<!doctype html><title>Fixture game</title><h1>Fixture game</h1>";
                args.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(body)), api && mode == 2 ? 401 : 200, "Fixture", "Content-Type: " + (api ? "application/json" : "text/html"));
            };
            core.NavigationCompleted += async (sender, args) => {
                File.AppendAllText(Path.Combine(root, "fixture-progress.txt"), "Navigation: " + args.IsSuccess + "\n");
                if (ran || !args.IsSuccess) return; ran = true;
                await Task.Delay(100);
                try {
                    var code = await (Task<string>)prepare.Invoke(form, new object[] { id });
                    File.AppendAllText(Path.Combine(root, "fixture-progress.txt"), "First handoff completed\n");
                    if (code != new string('a',43) || requests != 1) throw new Exception("Automatic grant handoff failed.");
                    mode = 1; bool refused = false;
                    try { await (Task<string>)prepare.Invoke(form, new object[] { id }); } catch { refused = true; }
                    if (!refused) throw new Exception("Cross-game grant accepted.");
                    mode = 2; refused = false;
                    try { await (Task<string>)prepare.Invoke(form, new object[] { id }); } catch (Exception error) { refused = error.Message.Contains("Sign in"); }
                    if (!refused) throw new Exception("Account denial was not preserved.");
                    var mappingName = "Local\\CurlStreamerPreview-" + Guid.NewGuid().ToString("N");
                    byte[] picture;
                    using (var bitmap = new System.Drawing.Bitmap(640, 360, System.Drawing.Imaging.PixelFormat.Format32bppRgb))
                    using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
                    using (var imageStream = new MemoryStream()) {
                        graphics.Clear(System.Drawing.Color.Red); bitmap.Save(imageStream, System.Drawing.Imaging.ImageFormat.Bmp); picture = imageStream.ToArray();
                    }
                    using (var mapping = System.IO.MemoryMappedFiles.MemoryMappedFile.CreateNew(mappingName, 16 + picture.Length))
                    using (var view = mapping.CreateViewAccessor()) {
                        view.Write(0, 2); view.Write(4, picture.Length); view.Write(8, DateTime.UtcNow.ToFileTimeUtc()); view.WriteArray(16, picture, 0, picture.Length);
                        foreach (var field in new[] { "selectedGame", "runningGame" }) typeof(Workspace).GetField(field, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, id);
                        typeof(Workspace).GetField("previewMapping", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, mappingName);
                        typeof(Workspace).GetField("recording", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, true);
                        await CheckPreview(core, origin + "/__studio-preview/" + id, true);
                        await CheckPreview(core, origin + "/__studio-preview/22222222-2222-4222-8222-222222222222", false);
                        view.Write(8, DateTime.UtcNow.AddSeconds(-10).ToFileTimeUtc());
                        await CheckPreview(core, origin + "/__studio-preview/" + id + "?stale=1", false);
                        typeof(Workspace).GetField("recording", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, false);
                    }
                    File.WriteAllText(output, "PASS: native WebView2 grant handoff, cross-game/account refusal, actual preview image decode, cross-game preview denial and stale-frame denial; no real media or accounts.");
                    result = 0;
                } catch (Exception error) { File.WriteAllText(output, "FAIL: " + error.GetType().Name + " " + error.Message); }
                finally { timeout.Stop(); form.Close(); }
            };
        };
        Application.Run(form);
        return result;
    }
    private static async Task CheckPreview(CoreWebView2 core, string url, bool expected) {
        await core.ExecuteScriptAsync("window.previewResult=null;var image=new Image();image.onload=()=>window.previewResult=image.naturalWidth===640&&image.naturalHeight===360;image.onerror=()=>window.previewResult=false;image.src='" + url + "';document.body.appendChild(image);");
        string actual = "null";
        for (int i = 0; i < 30 && actual == "null"; i++) { await Task.Delay(100); actual = await core.ExecuteScriptAsync("window.previewResult"); }
        if (actual != (expected ? "true" : "false")) throw new Exception("Preview image boundary failed: " + actual);
    }
}
