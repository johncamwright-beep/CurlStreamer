// Real WebView2 test with intercepted fixture resources and a fresh profile.
// No account, hosted game, controller, recording or broadcast is touched.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
        var fixtureProfile = Path.Combine(root, "FixtureProfile");
        CameraInputs.SaveSlot(fixtureProfile, null, "camera-home",
            CameraInputs.Tapo("192.168.1.20", "fixture-local-camera-user", "fixture-local-camera-password", "stream2", 90));
        var form = new Workspace(origin + "/games/" + id, "", "", hash, fixtureProfile);
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
                    await CheckCameraSettings(form, core, id, fixtureProfile);
                    await core.ExecuteScriptAsync("window.closeSupported=false;window.addEventListener('studio-session-status',e=>window.closeSupported=e.detail.canCloseWorkspace===true);window.chrome.webview.postMessage({type:'studio-session-observe'});");
                    for (int i=0;i<20 && await core.ExecuteScriptAsync("window.closeSupported")!="true";i++) await Task.Delay(100);
                    if (await core.ExecuteScriptAsync("window.closeSupported")!="true") throw new Exception("The game did not receive the native close capability.");
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
                    var leaveHold = new DelayedHold();
                    using (var fakeLocal = new System.Net.Http.HttpClient(leaveHold)) {
                        typeof(Workspace).GetField("local",flags).SetValue(form,fakeLocal);
                        typeof(Workspace).GetField("localAddress",flags).SetValue(form,"http://127.0.0.1:12345");
                        typeof(Workspace).GetField("lastState",flags).SetValue(form,readyState);
                        var holdNonce = "88888888-8888-4888-8888-888888888888";
                        await core.ExecuteScriptAsync("window.leaveHold=null;window.addEventListener('studio-game-leave-result',e=>{window.leaveHold=e.detail;if(e.detail.ok&&e.detail.nonce==='" + holdNonce + "')location.assign('/dashboard');});window.chrome.webview.postMessage({type:'studio-game-leave',gameId:'" + id + "',nonce:'" + holdNonce + "'});");
                        for (int i=0;i<20 && leaveHold.RequestBody==null;i++) await Task.Delay(50);
                        if (leaveHold.RequestBody == null || !leaveHold.RequestBody.Contains("hold-stream") || core.Source != origin + "/score/" + id)
                            throw new Exception("Pause and leave did not wait for the native hold acknowledgement.");
                        leaveHold.Complete();
                        for (int i=0;i<40 && core.Source!=origin+"/dashboard";i++) await Task.Delay(50);
                        if (core.Source != origin + "/dashboard" ||
                            (string)typeof(Workspace).GetField("runningGame",flags).GetValue(form) != id ||
                            (string)typeof(Workspace).GetField("usbGame",flags).GetValue(form) != id ||
                            typeof(Workspace).GetField("leaveDashboardGame",flags).GetValue(form) != null)
                            throw new Exception("Pause and leave interrupted the program or failed to consume a single Dashboard navigation.");
                        typeof(Workspace).GetField("local",flags).SetValue(form,null);
                        typeof(Workspace).GetField("localAddress",flags).SetValue(form,null);
                    }
                    core.Navigate(origin+"/score/"+id);
                    for (int i=0;i<40 && core.Source!=origin+"/score/"+id;i++) await Task.Delay(50);
                    await Task.Delay(150);
                    await core.ExecuteScriptAsync("window.navRequest=null;window.addEventListener('studio-navigation-request',e=>window.navRequest=e.detail);");
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
                    await PostCameraSettings(core, otherId, "camera-home");
                    if(CameraSettings(form) != null) throw new Exception("Another game's settings opened over the retained session.");
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
                    typeof(Workspace).GetField("gameEnded",flags).SetValue(form,false);
                    await core.ExecuteScriptAsync("window.leaveReceipts=[];window.addEventListener('studio-game-leave-result',e=>window.leaveReceipts.push(e.detail));window.chrome.webview.postMessage({type:'studio-game-leave',gameId:'"+otherId+"',nonce:'33333333-3333-4333-8333-333333333333'});");
                    await Task.Delay(100);
                    if(await core.ExecuteScriptAsync("window.leaveReceipts.length")!="0") throw new Exception("Foreign leave request accepted.");
                    var requestsBeforeLeave = requests;
                    await core.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'studio-game-leave',gameId:'"+id+"',nonce:'44444444-4444-4444-8444-444444444444'});");
                    for(int i=0;i<30&&await core.ExecuteScriptAsync("window.leaveReceipts.length")=="0";i++) await Task.Delay(50);
                    if(await core.ExecuteScriptAsync("window.leaveReceipts.length===1&&window.leaveReceipts[0].ok&&window.leaveReceipts[0].nonce==='44444444-4444-4444-8444-444444444444'")!="true") throw new Exception("Clean leave did not acknowledge matching request.");
                    if((string)remembered.Invoke(form,null)!=id || (bool)typeof(Workspace).GetField("gameEnded",flags).GetValue(form) || requests!=requestsBeforeLeave) throw new Exception("Leave finalized the game or lost its resume target.");
                    // A wedged, unarmed preview may be stopped without waiting for
                    // the broadcast cleanup deadline. A live sender must never take that route.
                    using (var preview = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(testNode, "-e \"setInterval(()=>{},60000)\"") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true })) {
                        try {
                            typeof(Workspace).GetField("child",flags).SetValue(form,preview);
                            typeof(Workspace).GetField("runningGame",flags).SetValue(form,id);
                            typeof(Workspace).GetField("recording",flags).SetValue(form,true);
                            typeof(Workspace).GetField("lastState",flags).SetValue(form,readyState);
                            var previewExit = new TaskCompletionSource<bool>();
                            typeof(Workspace).GetField("exited",flags).SetValue(form,previewExit);
                            typeof(Workspace).GetMethod("ObserveExit",flags).Invoke(form,new object[] { preview, new TaskCompletionSource<string>(), previewExit, new Func<bool>(() => false) });
                            var leave = "window.chrome.webview.postMessage({type:'studio-game-leave',gameId:'"+id+"',previewOnly:true,nonce:'";
                            await core.ExecuteScriptAsync("window.leaveReceipts=[];"+leave+"55555555-5555-4555-8555-555555555555'});");
                            for(int i=0;i<30&&await core.ExecuteScriptAsync("window.leaveReceipts.length")=="0";i++) await Task.Delay(50);
                            if(await core.ExecuteScriptAsync("window.leaveReceipts.length===1&&!window.leaveReceipts[0].ok")!="true" || preview.HasExited)
                                throw new Exception("Preview-only leave interrupted live output.");
                            typeof(Workspace).GetField("lastState",flags).SetValue(form,new System.Collections.Generic.Dictionary<string,object> { { "streaming", "idle" }, { "pairing", "unpaired" }, { "broadcast", "live" } });
                            await core.ExecuteScriptAsync("window.leaveReceipts=[];"+leave+"66666666-6666-4666-8666-666666666666'});");
                            for(int i=0;i<240&&await core.ExecuteScriptAsync("window.leaveReceipts.length")=="0";i++) await Task.Delay(50);
                            if(await core.ExecuteScriptAsync("window.leaveReceipts.length===1&&window.leaveReceipts[0].ok")!="true" ||
                                typeof(Workspace).GetField("child",flags).GetValue(form)!=null || (string)remembered.Invoke(form,null)!=id || requests!=requestsBeforeLeave)
                                throw new Exception("Unarmed preview did not close promptly or left a changed game.");
                        } finally {
                            try { if (!preview.HasExited) { preview.Kill(); preview.WaitForExit(5000); } } catch (InvalidOperationException) { }
                        }
                    }
                    // A paused and busy sender must close without the hosted final-card flow.
                    // Simulate an owned controller whose only successful operation is stdin close.
                    var pausedChild = new System.Diagnostics.Process {
                        StartInfo = new System.Diagnostics.ProcessStartInfo(testNode, "-e \"process.stdin.on('data',x=>{if(String(x).trim()==='close')process.stdout.write('CLOSED\\n',()=>process.exit(0));});\"") {
                            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true
                        }
                    };
                    bool cleanupConfirmed = false;
                    pausedChild.OutputDataReceived += (sender3, args3) => { if (args3.Data == "CLOSED") cleanupConfirmed = true; };
                    pausedChild.Start(); pausedChild.BeginOutputReadLine();
                    var pausedExit = new TaskCompletionSource<bool>();
                    typeof(Workspace).GetField("child",flags).SetValue(form, pausedChild);
                    typeof(Workspace).GetField("exited",flags).SetValue(form, pausedExit);
                    typeof(Workspace).GetField("runningGame",flags).SetValue(form, id);
                    typeof(Workspace).GetField("recording",flags).SetValue(form, true);
                    typeof(Workspace).GetField("busy",flags).SetValue(form, true);
                    typeof(Workspace).GetField("lastState",flags).SetValue(form, new Dictionary<string,object> {
                        { "streaming", "paused" }, { "broadcast", "live" }, { "pairing", "paired" }, { "programAuthorityEnded", true }
                    });
                    typeof(Workspace).GetMethod("ObserveExit",flags).Invoke(form, new object[] {
                        pausedChild, new TaskCompletionSource<string>(), pausedExit, new Func<bool>(() => cleanupConfirmed)
                    });
                    var closeNonce = "77777777-7777-4777-8777-777777777777";
                    var postClose = "window.chrome.webview.postMessage({type:'studio-close-workspace',nonce:'" + closeNonce + "',gameId:'";
                    try {
                        await core.ExecuteScriptAsync(postClose + otherId + "'});");
                        await Task.Delay(100);
                        if (pausedChild.HasExited || (bool)typeof(Workspace).GetField("closing",flags).GetValue(form))
                            throw new Exception("Cross-game Studio close was accepted.");
                        form.FormClosed += (sender3, args3) => {
                            try {
                                if (!pausedExit.Task.IsCompleted || !pausedExit.Task.Result ||
                                    typeof(Workspace).GetField("child",flags).GetValue(form) != null ||
                                    (string)remembered.Invoke(form,null) != id ||
                                    (bool)typeof(Workspace).GetField("gameEnded",flags).GetValue(form) || requests != requestsBeforeLeave)
                                    throw new Exception("Workspace close did not cleanly stop the paused sender or leave the game resumable.");
                                File.WriteAllText(output, "PASS: native WebView2 handoff, preview and camera boundaries; scoped recovery closed a busy, expired paused sender without finishing its game.");
                                result = 0;
                            } catch (Exception error) { File.WriteAllText(output, "FAIL: " + error.Message); }
                            finally { timeout.Stop(); }
                        };
                        await core.ExecuteScriptAsync(postClose + id + "'});");
                    } catch {
                        if (!pausedChild.HasExited) { pausedChild.Kill(); pausedChild.WaitForExit(5000); }
                        throw;
                    }
                    return; // Let the native close command drive FormClosed.
                } catch (Exception error) { File.WriteAllText(output, "FAIL: " + error.GetType().Name + " " + error.Message); }
                timeout.Stop(); typeof(Workspace).GetField("mayClose", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, true); form.Close();
            };
        };
        Application.Run(form);
        return result;
    }
    private static Control CameraSettings(Workspace form) {
        return (Control)typeof(Workspace).GetField("cameraSettings", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form);
    }
    private static async Task PostCameraSettings(CoreWebView2 core, string game, string role) {
        await core.ExecuteScriptAsync("window.chrome.webview.postMessage({action:'configure-camera',gameId:'" + game + "',cameraRole:'" + role + "'});");
        await Task.Delay(100);
    }
    private static IEnumerable<Control> Descendants(Control parent) {
        foreach (Control child in parent.Controls) {
            yield return child;
            foreach (var descendant in Descendants(child)) yield return descendant;
        }
    }
    private static async Task CheckCameraSettings(Workspace form, CoreWebView2 core, string game, string fixtureProfile) {
        const string password = "fixture-local-camera-password";
        await core.ExecuteScriptAsync("window.cameraSetupEvents=[];window.addEventListener('studio-camera-inputs',e=>window.cameraSetupEvents.push(e.detail));window.chrome.webview.addEventListener('message',e=>window.cameraSetupEvents.push(e.data));");
        await PostCameraSettings(core, "22222222-2222-4222-8222-222222222222", "camera-home");
        await PostCameraSettings(core, game, "scorer");
        if (CameraSettings(form) != null) throw new Exception("Invalid camera settings request opened the drawer.");
        await PostCameraSettings(core, game, "camera-away");
        var unconfigured = CameraSettings(form);
        if (unconfigured == null || unconfigured.AccessibleName != "Camera 2 settings" ||
            !Object.Equals(Descendants(unconfigured).OfType<ComboBox>().Single(box => box.AccessibleName == "Camera source").SelectedItem, "Phone (QR code)") ||
            Descendants(unconfigured).OfType<TextBox>().Any(box => box.Visible))
            throw new Exception("A new camera slot did not default to Phone without IP fields.");
        Descendants(unconfigured).OfType<Button>().Single(button => button.Text == "Cancel").PerformClick();
        await PostCameraSettings(core, game, "camera-home");
        var drawer = CameraSettings(form);
        if (drawer == null || !drawer.Visible || drawer.FindForm() != form || drawer.AccessibleName != "Camera 1 settings")
            throw new Exception("The selected game's camera settings did not open inside Studio while offline.");
        var source = Descendants(drawer).OfType<ComboBox>().Single(box => box.AccessibleName == "Camera source");
        var secretInput = Descendants(drawer).OfType<TextBox>().Single(box => box.AccessibleName == "Camera password");
        if (!Object.Equals(source.SelectedItem, "Tapo IP camera") || secretInput.Text != password || !secretInput.Visible ||
            (!secretInput.UseSystemPasswordChar && secretInput.PasswordChar == '\0'))
            throw new Exception("The saved camera login was not loaded into a masked native input.");
        var cancel = Descendants(drawer).OfType<Button>().Single(button => button.Text == "Cancel");
        cancel.PerformClick();
        if (CameraSettings(form) != null) throw new Exception("Cancel did not close the camera settings drawer.");
        await PostCameraSettings(core, game, "camera-home");
        var processKey = typeof(Workspace).GetMethod("ProcessCmdKey", BindingFlags.Instance | BindingFlags.NonPublic);
        if (!(bool)processKey.Invoke(form, new object[] { new Message(), Keys.Escape }) || CameraSettings(form) != null)
            throw new Exception("Escape did not close the camera settings drawer.");
        await PostCameraSettings(core, game, "camera-home");
        drawer = CameraSettings(form);
        var address = Descendants(drawer).OfType<TextBox>().Single(box => box.AccessibleName == "Private IP or RTSP address");
        var save = Descendants(drawer).OfType<Button>().Single(button => button.Text == "Save settings");
        address.Text = "invalid host";
        save.PerformClick();
        var errorShown = Descendants(drawer).OfType<Label>().Any(label => label.Visible && label.Text.Contains("private IPv4 address"));
        if (CameraSettings(form) != drawer || !save.Enabled || !errorShown ||
            (string)CameraInputs.Load(fixtureProfile)["camera-home"]["host"] != "192.168.1.20")
            throw new Exception("Invalid camera settings were committed or did not leave a fixable field error.");
        address.Text = "192.168.1.21";
        save.PerformClick();
        for (int i = 0; i < 30 && CameraSettings(form) != null; i++) await Task.Delay(50);
        var saved = CameraInputs.Load(fixtureProfile)["camera-home"];
        if (CameraSettings(form) != null || (string)saved["host"] != "192.168.1.21" || (string)saved["password"] != password ||
            (string)saved["stream"] != "stream2" || (int)saved["rotation"] != 90)
            throw new Exception("Offline saving did not persist the edit and untouched camera preferences.");
        if (await core.ExecuteScriptAsync("!(document.documentElement.outerHTML+JSON.stringify(window.cameraSetupEvents)).includes('" + password + "')") != "true")
            throw new Exception("A camera credential crossed into the WebView.");
        await PostCameraSettings(core, game, "camera-home");
        drawer = CameraSettings(form);
        address = Descendants(drawer).OfType<TextBox>().Single(box => box.AccessibleName == "Private IP or RTSP address");
        if (address.Text != "192.168.1.21") throw new Exception("Reopening the drawer did not restore the saved camera address.");
        var scoringUrl = core.Source;
        await NavigateCameraFixture(core, new Uri(scoringUrl).GetLeftPart(UriPartial.Authority) + "/account");
        if (CameraSettings(form) != null) throw new Exception("Leaving the game retained its camera settings drawer.");
        await NavigateCameraFixture(core, scoringUrl);
    }
    private static async Task NavigateCameraFixture(CoreWebView2 core, string url) {
        var loaded = new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2NavigationCompletedEventArgs> complete = (sender, e) => loaded.TrySetResult(e.IsSuccess);
        core.NavigationCompleted += complete;
        try {
            core.Navigate(url);
            if (!await loaded.Task) throw new Exception("Camera fixture navigation failed.");
        } finally { core.NavigationCompleted -= complete; }
    }
    private static async Task CheckPreview(CoreWebView2 core, string url, bool expected) {
        await core.ExecuteScriptAsync("window.previewResult=null;var image=new Image();image.onload=()=>window.previewResult=image.naturalWidth===1280&&image.naturalHeight===720;image.onerror=()=>window.previewResult=false;image.src='" + url + "';document.body.appendChild(image);");
        string actual = "null";
        for (int i = 0; i < 30 && actual == "null"; i++) { await Task.Delay(100); actual = await core.ExecuteScriptAsync("window.previewResult"); }
        if (actual != (expected ? "true" : "false")) throw new Exception("Preview image boundary failed: " + actual);
    }
    private sealed class DelayedHold : System.Net.Http.HttpMessageHandler {
        private readonly TaskCompletionSource<System.Net.Http.HttpResponseMessage> response = new TaskCompletionSource<System.Net.Http.HttpResponseMessage>();
        internal string RequestBody { get; private set; }
        protected override Task<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage request, System.Threading.CancellationToken cancellationToken) {
            if (request.Content != null) RequestBody = request.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            return response.Task;
        }
        internal void Complete() {
            response.SetResult(new System.Net.Http.HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new System.Net.Http.StringContent("{\"program\":\"recording\",\"streaming\":\"armed\",\"broadcast\":\"live\",\"presentation\":{\"mode\":\"hold\"},\"localOutput\":{\"state\":\"active\"}}") });
        }
    }
}
