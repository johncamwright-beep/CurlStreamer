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
                if (args.Request.Uri.Contains("/studio-m4")) body = args.Request.Uri.EndsWith("/desktop-pairing") ? "{\"code\":\"" + new string('b',43) + "\"}" : "{\"status\":\"prepared\"}";
                args.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(body)), api && mode == 2 ? 401 : 200, "Fixture", "Content-Type: " + (api ? "application/json" : "text/html"));
            };
            core.NavigationCompleted += async (sender, args) => {
                File.AppendAllText(Path.Combine(root, "fixture-progress.txt"), "Navigation: " + args.IsSuccess + "\n");
                if (ran || !args.IsSuccess) return; ran = true;
                await Task.Delay(100);
                try {
                    typeof(Workspace).GetField("busy",BindingFlags.Instance|BindingFlags.NonPublic).SetValue(form,true);
                    await core.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'studio-session-title',gameId:'"+id+"',title:'Title during setup'});"); await Task.Delay(100);
                    if((string)typeof(Workspace).GetField("sessionTitle",BindingFlags.Instance|BindingFlags.NonPublic).GetValue(form)!="Title during setup") throw new Exception("Title arriving before controller assignment was discarded.");
                    typeof(Workspace).GetField("busy",BindingFlags.Instance|BindingFlags.NonPublic).SetValue(form,false);
                    var code = await (Task<string>)prepare.Invoke(form, new object[] { id });
                    File.AppendAllText(Path.Combine(root, "fixture-progress.txt"), "First handoff completed\n");
                    if (code != new string('a',43) || requests != 1) throw new Exception("Automatic grant handoff failed.");
                    mode = 1; bool refused = false;
                    try { await (Task<string>)prepare.Invoke(form, new object[] { id }); } catch { refused = true; }
                    if (!refused) throw new Exception("Cross-game grant accepted.");
                    mode = 2; refused = false;
                    try { await (Task<string>)prepare.Invoke(form, new object[] { id }); } catch (Exception error) { refused = error.Message.Contains("Sign in"); }
                    if (!refused) throw new Exception("Account denial was not preserved.");
                    var youtube = typeof(Workspace).GetMethod("WebsiteYouTube", BindingFlags.Instance | BindingFlags.NonPublic);
                    mode = 0;
                    if (await (Task<string>)youtube.Invoke(form, new object[] { id, "", new { action = "prepare" } }) != "prepared") throw new Exception("YouTube prepare handoff failed.");
                    if (await (Task<string>)youtube.Invoke(form, new object[] { id, "/desktop-pairing", new { challenge = new string('c',64) } }) != new string('b',43)) throw new Exception("YouTube pairing handoff failed.");
                    mode = 2; refused = false;
                    try { await (Task<string>)youtube.Invoke(form, new object[] { id, "", new { action = "prepare" } }); } catch { refused = true; }
                    if (!refused) throw new Exception("YouTube account denial was not preserved.");
                    var remember = typeof(Workspace).GetMethod("RememberGame", BindingFlags.Instance | BindingFlags.NonPublic);
                    var remembered = typeof(Workspace).GetMethod("RememberedGame", BindingFlags.Instance | BindingFlags.NonPublic);
                    remember.Invoke(form, new object[] { id });
                    if ((string)remembered.Invoke(form, null) != id) throw new Exception("Resume game not persisted.");
                    var resumePath = Path.Combine(root, "FixtureProfile", "resume-game.json");
                    File.WriteAllText(resumePath, "{\"origin\":\"https://other.example\",\"gameId\":\"" + id + "\"}");
                    if (remembered.Invoke(form, null) != null) throw new Exception("Cross-origin saved game accepted.");
                    remember.Invoke(form, new object[] { id });
                    var scoringLoaded = new TaskCompletionSource<bool>();
                    EventHandler<CoreWebView2NavigationCompletedEventArgs> scoringNavigation = (sender2,args2) => scoringLoaded.TrySetResult(args2.IsSuccess);
                    core.NavigationCompleted += scoringNavigation;
                    core.Navigate(origin + "/score/" + id);
                    if (!await scoringLoaded.Task) throw new Exception("Fixture scoring navigation failed.");
                    core.NavigationCompleted -= scoringNavigation;
                    await core.ExecuteScriptAsync("window.endRequested=false;window.addEventListener('studio-end-game-request',e=>{window.endRequested=e.detail.gameId==='" + id + "';window.chrome.webview.postMessage({type:'studio-end-game-opened',gameId:e.detail.gameId});});");
                    await (Task)typeof(Workspace).GetMethod("RequestEndGame", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(form, new object[] { id });
                    for (int i=0;i<20 && await core.ExecuteScriptAsync("window.endRequested")!="true";i++) await Task.Delay(100);
                    if (await core.ExecuteScriptAsync("window.endRequested")!="true") throw new Exception("Close did not request final-score review.");
                    await core.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'studio-end-game-cancelled',gameId:'" + id + "'});");
                    await Task.Delay(100);
                    if (typeof(Workspace).GetField("closeAfterGame", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form) != null) throw new Exception("Cancelled review retained close intent.");
                    var mappingName = "Local\\CurlStreamerPreview-" + Guid.NewGuid().ToString("N");
                    byte[] picture;
                    using (var bitmap = new System.Drawing.Bitmap(1280, 720, System.Drawing.Imaging.PixelFormat.Format32bppRgb))
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
                    // A successful command publishes while busy; completing it
                    // must clear the web button even when later polling stops.
                    await core.ExecuteScriptAsync("window.youtubeEvents=[];window.addEventListener('studio-youtube-status',e=>window.youtubeEvents.push(e.detail));");
                    var publish = typeof(Workspace).GetMethod("PublishYouTubeStatus", BindingFlags.Instance | BindingFlags.NonPublic);
                    var readyState = new System.Collections.Generic.Dictionary<string, object> { { "streamingAvailable", true }, { "streaming", "armed" }, { "broadcast", "live" }, { "youtubeReception", "confirmed" }, { "canReconnect", true }, { "localOutput", new System.Collections.Generic.Dictionary<string, object> { { "state", "active" } } } };
                    typeof(Workspace).GetField("busy", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, true);
                    publish.Invoke(form, new object[] { readyState });
                    typeof(Workspace).GetField("busy", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, false);
                    publish.Invoke(form, new object[] { readyState });
                    if (await core.ExecuteScriptAsync("window.youtubeEvents.length===2&&window.youtubeEvents[0].busy&&!window.youtubeEvents[1].busy&&window.youtubeEvents[1].live") != "true") throw new Exception("YouTube busy status did not settle.");
                    var youtubeError = typeof(Workspace).GetField("youtubeError", BindingFlags.Instance | BindingFlags.NonPublic);
                    youtubeError.SetValue(form, "Fixture command failed.");
                    publish.Invoke(form, new object[] { readyState });
                    if (await core.ExecuteScriptAsync("window.youtubeEvents.at(-1).live&&window.youtubeEvents.at(-1).streaming==='armed'&&window.youtubeEvents.at(-1).outputActive&&window.youtubeEvents.at(-1).canReconnect") != "true") throw new Exception("A command error hid confirmed output or reconnect capability.");
                    youtubeError.SetValue(form, "");
                    publish.Invoke(form, new object[] { null });
                    if (await core.ExecuteScriptAsync("!window.youtubeEvents.at(-1).available&&!window.youtubeEvents.at(-1).busy&&!window.youtubeEvents.at(-1).live&&window.youtubeEvents.at(-1).streaming==='failed'") != "true") throw new Exception("Controller exit retained pending/live status.");
                    // Use the fixture process only as a liveness sentinel. No
                    // controller/camera/audio device is opened by this test.
                    var flags = BindingFlags.Instance | BindingFlags.NonPublic;
                    ((Timer)typeof(Workspace).GetField("usbTimer", flags).GetValue(form)).Stop();
                    typeof(Workspace).GetField("child", flags).SetValue(form, System.Diagnostics.Process.GetCurrentProcess());
                    typeof(Workspace).GetField("recording", flags).SetValue(form, true);
                    typeof(Workspace).GetField("usbGame", flags).SetValue(form, id);
                    typeof(Workspace).GetField("lastState", flags).SetValue(form, readyState);
                    await core.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'studio-game-ready',gameId:'"+id+"'});window.chrome.webview.postMessage({type:'studio-session-title',gameId:'"+id+"',title:'Fixture current game'});");
                    await Task.Delay(100);
                    if((string)typeof(Workspace).GetField("sessionTitle",flags).GetValue(form)!="Fixture current game") throw new Exception("Backward-compatible Ready plus separate title did not update the current session.");
                    await core.ExecuteScriptAsync("window.navRequest=null;window.addEventListener('studio-navigation-request',e=>window.navRequest=e.detail);");
                    core.Navigate(origin + "/account");
                    for (int i=0;i<20&&await core.ExecuteScriptAsync("window.navRequest===null")=="true";i++) await Task.Delay(50);
                    if (await core.ExecuteScriptAsync("window.navRequest.gameId==='"+id+"'&&window.navRequest.href==='"+origin+"/account'")!="true" || core.Source!=origin+"/score/"+id) throw new Exception("Full navigation bypassed session review.");
                    var navigationNonce = (string)typeof(Workspace).GetField("pendingNavigationNonce",flags).GetValue(form);
                    core.Navigate(origin+"/dashboard"); await Task.Delay(100);
                    if((string)typeof(Workspace).GetField("pendingNavigationNonce",flags).GetValue(form)!=navigationNonce ||
                        (string)typeof(Workspace).GetField("pendingNavigation",flags).GetValue(form)!=origin+"/account") throw new Exception("A second navigation replaced the pending correlated choice.");
                    readyState["canHoldStream"] = true;
                    var delayedHold = new DelayedHold();
                    using (var fakeLocal = new System.Net.Http.HttpClient(delayedHold)) {
                        typeof(Workspace).GetField("local",flags).SetValue(form,fakeLocal);
                        typeof(Workspace).GetField("localAddress",flags).SetValue(form,"http://127.0.0.1:12345");
                        var resolve = typeof(Workspace).GetMethod("ResolveNavigation",flags);
                        var message = new System.Collections.Generic.Dictionary<string,object> { {"type","studio-navigation-resolve"},{"gameId",id},{"nonce",navigationNonce},{"decision","pause"} };
                        var pause = (Task)resolve.Invoke(form,new object[]{message});
                        if (!(bool)typeof(Workspace).GetField("busy",flags).GetValue(form)) throw new Exception("Hold did not wait for correlated native completion.");
                        message["decision"]="stay";
                        await (Task)resolve.Invoke(form,new object[]{message});
                        delayedHold.Complete(); await pause;
                        if(core.Source!=origin+"/score/"+id || typeof(Workspace).GetField("pendingNavigation",flags).GetValue(form)!=null) throw new Exception("Late pause ignored Stay and navigated away.");
                        typeof(Workspace).GetField("local",flags).SetValue(form,null);
                        typeof(Workspace).GetField("localAddress",flags).SetValue(form,null);
                    }
                    core.Navigate(origin+"/account"); await Task.Delay(100);
                    await core.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'studio-navigation-resolve',gameId:window.navRequest.gameId,nonce:window.navRequest.nonce,decision:'continue'});");
                    for (int i=0;i<40&&core.Source!=origin+"/account";i++) await Task.Delay(50);
                    await Task.Delay(150);
                    await core.ExecuteScriptAsync("window.session=null;window.addEventListener('studio-session-status',e=>window.session=e.detail);window.chrome.webview.postMessage({type:'studio-session-observe'});");
                    for(int i=0;i<20&&await core.ExecuteScriptAsync("window.session===null")=="true";i++) await Task.Delay(50);
                    if(await core.ExecuteScriptAsync("window.session.active&&window.session.gameId==='"+id+"'&&window.session.outputActive&&window.session.live")!="true") throw new Exception("Account page did not receive trusted global session.");
                    if ((string)typeof(Workspace).GetField("usbGame",flags).GetValue(form)!=id) throw new Exception("Account navigation stopped retained USB session.");
                    const string otherId = "22222222-2222-4222-8222-222222222222";
                    typeof(Workspace).GetField("gameEnded",flags).SetValue(form,true);
                    var endingDeadline = DateTime.UtcNow.AddSeconds(30);
                    typeof(Workspace).GetField("endingUntil",flags).SetValue(form,endingDeadline);
                    core.Navigate(origin+"/score/"+otherId);
                    for(int i=0;i<40&&core.Source!=origin+"/score/"+otherId;i++)await Task.Delay(50);
                    await Task.Delay(150);
                    await core.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'studio-game-ready',gameId:'"+otherId+"',title:'Other game'});window.chrome.webview.postMessage({type:'studio-game-ended',gameId:'"+otherId+"'});");
                    await Task.Delay(100);
                    await (Task)typeof(Workspace).GetMethod("UsbCommand",flags).Invoke(form,new object[]{new System.Collections.Generic.Dictionary<string,object>{{"type","studio-usb-stop"},{"gameId",otherId}}});
                    if ((string)typeof(Workspace).GetField("runningGame",flags).GetValue(form)!=id || !(bool)typeof(Workspace).GetField("recording",flags).GetValue(form) || (string)typeof(Workspace).GetField("usbGame",flags).GetValue(form)!=id) throw new Exception("Another game's ready message replaced active program/audio.");
                    if(!(bool)typeof(Workspace).GetField("gameEnded",flags).GetValue(form) || (string)typeof(Workspace).GetField("lastGame",flags).GetValue(form)!=id || (string)remembered.Invoke(form,null)!=id) throw new Exception("Foreign game navigation or readiness changed active ending/recovery state.");
                    await core.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'studio-session-title',gameId:'"+otherId+"',title:'Wrong session title'});"); await Task.Delay(100);
                    if((string)typeof(Workspace).GetField("sessionTitle",flags).GetValue(form)!="Fixture current game") throw new Exception("Another game's title overwrote the retained session.");
                    typeof(Workspace).GetMethod("OpenCameraSettings",flags).Invoke(form,new object[]{"camera-home"});
                    if((bool)typeof(Workspace).GetField("cameraSettingsOpen",flags).GetValue(form)) throw new Exception("Another game's settings mutated the retained session.");
                    typeof(Workspace).GetField("lastState",flags).SetValue(form,new System.Collections.Generic.Dictionary<string,object> {
                        {"cameraInputs",new System.Collections.Generic.Dictionary<string,object>{{"camera-home",new System.Collections.Generic.Dictionary<string,object>{{"connectionEnabled",false},{"phase","idle"}}}}},
                        {"cameraStatus",new System.Collections.Generic.Dictionary<string,object>{{"camera-home",true}}}
                    });
                    if(!((string)typeof(Workspace).GetMethod("CameraInputStatus",flags).Invoke(form,new object[]{"camera-home"})).Contains("Tap Connect")) throw new Exception("Saved OFF source claimed stale fresh video.");
                    typeof(Workspace).GetField("lastState",flags).SetValue(form,readyState);
                    await core.ExecuteScriptAsync("window.session=null;window.addEventListener('studio-session-status',e=>window.session=e.detail);window.chrome.webview.postMessage({type:'studio-session-observe'});");
                    for(int i=0;i<20&&await core.ExecuteScriptAsync("window.session===null")=="true";i++)await Task.Delay(50);
                    typeof(Workspace).GetField("recording",flags).SetValue(form,false);
                    typeof(Workspace).GetField("usbGame",flags).SetValue(form,null);
                    typeof(Workspace).GetField("child",flags).SetValue(form,null);
                    typeof(Workspace).GetMethod("PublishSessionStatus",flags).Invoke(form,null);
                    if(await core.ExecuteScriptAsync("!window.session.active&&window.session.gameId===null&&!window.session.outputActive&&!window.session.live")!="true") throw new Exception("Completed session retained global live state.");
                    // Restore selected game for the existing failed-exit checks.
                    core.Navigate(origin+"/score/"+id);
                    for(int i=0;i<40&&core.Source!=origin+"/score/"+id;i++)await Task.Delay(50);
                    await Task.Delay(150);
                    await core.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'studio-game-ready',gameId:'"+id+"'});"); await Task.Delay(100);
                    if(!(bool)typeof(Workspace).GetField("gameEnded",flags).GetValue(form) || (DateTime)typeof(Workspace).GetField("endingUntil",flags).GetValue(form)!=endingDeadline) throw new Exception("Returning same-game Ready cancelled ending cleanup.");
                    await core.ExecuteScriptAsync("window.youtubeEvents=[];window.addEventListener('studio-youtube-status',e=>window.youtubeEvents.push(e.detail));");
                    var testNode = Environment.GetEnvironmentVariable("CURLCAST_TEST_NODE");
                    using (var stopped = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(testNode, "-e \"process.exit(7)\"") { UseShellExecute = false, CreateNoWindow = true })) {
                        typeof(Workspace).GetField("child", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, stopped);
                        typeof(Workspace).GetField("busy", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, true);
                        typeof(Workspace).GetField("recording", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, true);
                        var ready = new TaskCompletionSource<string>(); var exited = new TaskCompletionSource<bool>();
                        typeof(Workspace).GetMethod("ObserveExit", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(form, new object[] { stopped, ready, exited, new Func<bool>(() => false) });
                        if (await exited.Task) throw new Exception("Unexpected exit was reported clean.");
                        for (int i = 0; i < 20 && (bool)typeof(Workspace).GetField("recording", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form); i++) await Task.Delay(100);
                        if ((bool)typeof(Workspace).GetField("recording", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form)) throw new Exception("Busy operation suppressed controller-offline handling.");
                        if (!File.ReadAllText(Path.Combine(root, "FixtureProfile", "controller-exit.json")).Contains("\"exitCode\":7")) throw new Exception("Controller exit evidence missing.");
                        if (await core.ExecuteScriptAsync("!window.youtubeEvents.at(-1).busy&&window.youtubeEvents.at(-1).message.includes('controller stopped')") != "true") throw new Exception("Controller exit left web preparation hanging.");
                        typeof(Workspace).GetField("exited", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, exited);
                        await (Task)typeof(Workspace).GetMethod("CloseController", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(form, null);
                        if (typeof(Workspace).GetField("child", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form) != null || !File.Exists(Path.Combine(root,"FixtureProfile","recording-warning.json"))) throw new Exception("Dead controller blocked restart or lost cleanup warning.");
                        typeof(Workspace).GetField("busy", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, false);
                    }
                    File.WriteAllText(output, "PASS: native WebView2 handoff/preview boundaries, global account session, correlated navigation fallback, USB retention, cross-game replacement refusal, completed/failed session cleanup; no real media or accounts.");
                    result = 0;
                } catch (Exception error) { File.WriteAllText(output, "FAIL: " + error.GetType().Name + " " + error.Message); }
                finally { timeout.Stop(); typeof(Workspace).GetField("mayClose", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, true); form.Close(); }
            };
        };
        Application.Run(form);
        return result;
    }
    private static async Task CheckPreview(CoreWebView2 core, string url, bool expected) {
        await core.ExecuteScriptAsync("window.previewResult=null;var image=new Image();image.onload=()=>window.previewResult=image.naturalWidth===1280&&image.naturalHeight===720;image.onerror=()=>window.previewResult=false;image.src='" + url + "';document.body.appendChild(image);");
        string actual = "null";
        for (int i = 0; i < 30 && actual == "null"; i++) { await Task.Delay(100); actual = await core.ExecuteScriptAsync("window.previewResult"); }
        if (actual != (expected ? "true" : "false")) throw new Exception("Preview image boundary failed: " + actual);
    }
    private sealed class DelayedHold : System.Net.Http.HttpMessageHandler {
        private readonly TaskCompletionSource<System.Net.Http.HttpResponseMessage> response = new TaskCompletionSource<System.Net.Http.HttpResponseMessage>();
        protected override Task<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage request, System.Threading.CancellationToken cancellationToken) { return response.Task; }
        internal void Complete() {
            response.SetResult(new System.Net.Http.HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new System.Net.Http.StringContent("{\"program\":\"recording\",\"streaming\":\"armed\",\"broadcast\":\"live\",\"presentation\":{\"mode\":\"hold\"},\"localOutput\":{\"state\":\"active\"}}") });
        }
    }
}
