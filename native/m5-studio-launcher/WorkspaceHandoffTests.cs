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
            if (!e.IsSuccess) return;
            var core = web.CoreWebView2;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (sender, args) => {
                var api = args.Request.Uri.Contains("/api/games/");
                if (api) requests++;
                var body = api ? "{\"sourceUrl\":\"" + origin + "/studio-m3/" + (mode == 1 ? "22222222-2222-4222-8222-222222222222" : id) + "/program#code=" + new string('a',43) + "\"}" : "<!doctype html><title>Fixture game</title><h1>Fixture game</h1>";
                args.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(body)), api && mode == 2 ? 401 : 200, "Fixture", "Content-Type: " + (api ? "application/json" : "text/html"));
            };
            core.NavigationCompleted += async (sender, args) => {
                if (ran || !args.IsSuccess) return; ran = true;
                await Task.Delay(100);
                try {
                    var code = await (Task<string>)prepare.Invoke(form, new object[] { id });
                    if (code != new string('a',43) || requests != 1) throw new Exception("Automatic grant handoff failed.");
                    mode = 1; bool refused = false;
                    try { await (Task<string>)prepare.Invoke(form, new object[] { id }); } catch { refused = true; }
                    if (!refused) throw new Exception("Cross-game grant accepted.");
                    mode = 2; refused = false;
                    try { await (Task<string>)prepare.Invoke(form, new object[] { id }); } catch (Exception error) { refused = error.Message.Contains("Sign in"); }
                    if (!refused) throw new Exception("Account denial was not preserved.");
                    File.WriteAllText(output, "PASS: native WebView2 automatic grant handoff, cross-game refusal, account denial; no real media or accounts.");
                    result = 0;
                } catch (Exception error) { File.WriteAllText(output, "FAIL: " + error.GetType().Name + " " + error.Message); }
                finally { timeout.Stop(); form.Close(); }
            };
        };
        Application.Run(form);
        return result;
    }
}
