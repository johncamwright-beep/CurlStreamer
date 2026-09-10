using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// No host objects or generic native command bridge. Only a native Record click
// requests a correlated, game-scoped grant; account credentials remain in WebView.
internal sealed class Workspace : Form
{
    private readonly WebView2 web = new WebView2();
    private readonly Label status = new Label();
    private readonly Button record = new Button(), finish = new Button(), devices = new Button(), gameDay = new Button();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 65536 };
    private readonly string nodeHash, controllerHash, configurationHash, root, launchGame, profileDirectory;
    private readonly System.Windows.Forms.Timer poll = new System.Windows.Forms.Timer { Interval = 2000 };
    private string origin, selectedGame, lastGame, runningGame, localAddress, handoffNonce, previewMapping;
    private Process child;
    private HttpClient local;
    private TaskCompletionSource<string> ready;
    private TaskCompletionSource<bool> exited;
    private TaskCompletionSource<Dictionary<string, object>> handoff;
    private bool busy, polling, closing, mayClose, cleanupConfirmed, recording, controllerReady, startupFailed;
    private readonly UsbAudio usbAudio = new UsbAudio();
    private readonly object usbLock = new object();
    private readonly List<float> usbSamples = new List<float>();
    private readonly System.Windows.Forms.Timer usbTimer = new System.Windows.Forms.Timer { Interval = 100 };
    private Task usbSend = Task.FromResult(true);
    private string usbGame, usbError;
    private bool usbBusy;
    private object usbDevices = new object[0];
    // Count-only delivery diagnostics. They deliberately retain no PCM, endpoint
    // identifier, or server response data.
    private int usbPostedPackets, usbPostFailures;
    private long usbPostedBytes;
    private string usbLastPostError;
    private DateTime usbDiagnosticsWrittenAt = DateTime.MinValue;

    internal Workspace(string initialGame, string node, string controller, string configuration, string testProfile = null)
    {
        launchGame = initialGame; nodeHash = node; controllerHash = controller; configurationHash = configuration;
        profileDirectory = testProfile;
        usbTimer.Tick += (s, e) => { if (!usbBusy && !closing && usbSend.IsCompleted) usbSend = SendUsbAudio(); };
        usbTimer.Start();
        root = AppDomain.CurrentDomain.BaseDirectory;
        Text = "CurlStreamer Studio — Workspace Preview";
        ClientSize = new Size(1180, 820); MinimumSize = new Size(940, 680);
        AutoScaleMode = AutoScaleMode.Dpi; Font = new Font("Segoe UI", 10);
        BackColor = Color.FromArgb(10, 24, 40); ForeColor = Color.White;
        bottom = new TableLayoutPanel { Dock = DockStyle.Bottom, Height = 34, Padding = new Padding(12, 2, 12, 2), ColumnCount = 1, RowCount = 1 };
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Height = 54 };
        record.Text = "Connect cameras"; Style(record); record.Click += async (s, e) => await StartRecording();
        record.BackColor = Color.FromArgb(74, 214, 196); record.ForeColor = Color.FromArgb(7, 28, 36); record.FlatAppearance.BorderSize = 0;
        record.FlatAppearance.MouseOverBackColor = Color.FromArgb(116, 233, 216);
        finish.Text = "Disconnect cameras"; Style(finish); finish.Click += async (s, e) => await StopRecording();
        devices.Text = "Connect devices"; Style(devices); devices.Click += (s, e) => Navigate("/games/" + selectedGame + "/studio");
        var files = MakeButton("Saved videos"); files.Click += (s, e) => OpenRecordings();
        actions.Controls.AddRange(new Control[] { record, finish });
        status.Text = "Opening your workspace…"; status.Dock = DockStyle.Fill; status.AutoEllipsis = true;
        status.AccessibleName = "Recording status"; status.Padding = new Padding(5, 5, 0, 0);
        bottom.Controls.Add(status);
        web.Dock = DockStyle.Fill;
        Controls.Add(web); Controls.Add(bottom);
        Shown += async (s, e) => await Initialize();
        poll.Tick += async (s, e) => await Poll();
        FormClosing += async (s, e) => {
            if (mayClose) return;
            e.Cancel = true;
            if (busy || closing) { status.Text = "Wait for the current recording action to finish before closing."; return; }
            closing = true; UpdateButtons();
            try { await CloseController(); mayClose = true; poll.Stop(); web.Dispose(); Close(); }
            catch {
                closing = false;
                if (child != null && child.HasExited && MessageBox.Show(this, "The recording process has ended, but cleanup was not confirmed. Check your recording before using it. Close Studio?", "Recording recovery", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes) {
                    mayClose = true; poll.Stop(); web.Dispose(); Close(); return;
                }
                status.Text = "Recording cleanup was not confirmed. Studio remains open; check the recordings before closing."; UpdateButtons();
            }
        };
        UpdateButtons();
    }
    private Button MakeButton(string text) { var b = new Button { Text = text }; Style(b); return b; }
    private void Style(Button b) { b.UseMnemonic = false; b.AutoSize = true; b.Height = 44; b.MinimumSize = new Size(80, 44); b.Padding = new Padding(14, 0, 14, 0); b.Margin = new Padding(0, 0, 10, 0); b.ForeColor = Color.FromArgb(220, 230, 238); b.BackColor = Color.FromArgb(21, 38, 54); b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderColor = Color.FromArgb(52, 73, 91); b.FlatAppearance.MouseOverBackColor = Color.FromArgb(39, 69, 83); b.Cursor = Cursors.Hand; }
    private void Nav(FlowLayoutPanel panel, string label, string path) { var b = MakeButton(label); b.Click += (s, e) => Navigate(path); panel.Controls.Add(b); }
    private void Navigate(string path) { if (!busy && !closing && origin != null && web.CoreWebView2 != null) web.CoreWebView2.Navigate(origin + path); }
    private TableLayoutPanel bottom;
    private void UpdateButtons() {
        bottom.Visible = !recording && (selectedGame != null || origin == null);
        gameDay.Enabled = !busy && !closing && (recording ? runningGame : lastGame) != null;
        record.Visible = !recording; finish.Visible = recording;
        record.Enabled = !busy && !closing && selectedGame != null && !recording && origin != null;
        finish.Enabled = !busy && !closing && recording;
        devices.Enabled = !busy && !closing && selectedGame != null;
    }
    private static void Verify(string path, string expected) {
        using (var hash = SHA256.Create()) using (var input = File.OpenRead(path))
            if (BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant() != expected) throw new InvalidDataException();
    }
    private async Task Initialize() {
        try {
            Verify(Path.Combine(root, "studio.json"), configurationHash);
            var config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(root, "studio.json")));
            origin = (string)config["website"];
            if (!WorkspacePolicy.SameOrigin(origin, origin) || new Uri(origin).AbsoluteUri != origin + "/") throw new InvalidDataException();
            var profile = profileDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio", "WorkspaceProfile");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.UserAgent += " CurlStreamerStudio/0.3";
            core.Settings.UserAgent += " StudioProgramPreview/1";
            core.Settings.UserAgent += " StudioNativeAudio/1";
            core.AddWebResourceRequestedFilter(origin + "/__studio-preview/*", CoreWebView2WebResourceContext.Image);
            core.WebResourceRequested += (s, e) => {
                if (e.ResourceContext != CoreWebView2WebResourceContext.Image || !e.Request.Uri.StartsWith(origin + "/__studio-preview/")) return;
                byte[] frame = null;
                try {
                    var requested = new Uri(e.Request.Uri);
                    if (recording && runningGame != null && selectedGame == runningGame &&
                        WorkspacePolicy.SameOrigin(core.Source, origin) &&
                        WorkspacePolicy.SameOrigin(e.Request.Uri, origin) &&
                        requested.AbsolutePath == "/__studio-preview/" + runningGame && e.Request.Method == "GET")
                        frame = ProgramPreview.Read(previewMapping);
                } catch { }
                e.Response = core.Environment.CreateWebResourceResponse(
                    new MemoryStream(frame ?? new byte[0]), frame == null ? 503 : 200,
                    frame == null ? "Preview unavailable" : "OK",
                    "Content-Type: image/bmp\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
            };
            core.Settings.AreDevToolsEnabled = false; core.Settings.IsStatusBarEnabled = false;
            core.NavigationStarting += (s, e) => {
                if (busy || closing) { e.Cancel = true; return; }
                if (!WorkspacePolicy.SameOrigin(e.Uri, origin)) { e.Cancel = true; status.Text = "Use the website in your browser for external account connections."; }
                selectedGame = null; UpdateButtons();
            };
            core.SourceChanged += (s, e) => { selectedGame = WorkspacePolicy.Game(core.Source, origin); if (selectedGame != null) lastGame = selectedGame; if (usbGame != null && usbGame != selectedGame) { var ignored = StopUsbAudio(); } UpdateButtons(); };
            core.NavigationCompleted += (s, e) => {
                selectedGame = WorkspacePolicy.Game(core.Source, origin);
                if (!e.IsSuccess && !recording) status.Text = "The workspace could not load. Check your internet connection and choose Refresh.";
                else if (!recording && !busy) status.Text = selectedGame == null ? "Choose a game from your schedule to get started." : "Preparing this game for your camera phones.";
                UpdateButtons();
            };
            core.NewWindowRequested += (s, e) => { e.Handled = true; if (WorkspacePolicy.SameOrigin(e.Uri, origin)) Navigate(new Uri(e.Uri).PathAndQuery + new Uri(e.Uri).Fragment); else { if (WorkspacePolicy.ExternalYouTube(e.Uri)) Process.Start(new ProcessStartInfo(new Uri(e.Uri).AbsoluteUri) { UseShellExecute = true }); else status.Text = "External account connections are available from the website in your browser."; } };
            core.PermissionRequested += (s, e) => {
                e.SavesInProfile = false;
                e.State = !closing && e.PermissionKind == CoreWebView2PermissionKind.Microphone &&
                    WorkspacePolicy.Microphone(e.Uri, core.Source, origin, selectedGame, e.IsUserInitiated)
                    ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
            };
            // Earlier builds persisted a blanket denial. Reset only this site's microphone permission.
            await core.Profile.SetPermissionStateAsync(CoreWebView2PermissionKind.Microphone, origin, CoreWebView2PermissionState.Default);
            core.WebMessageReceived += ReceiveGrant;
            var initialId = launchGame == null ? null : WorkspacePolicy.Game(launchGame, origin);
            core.Navigate(initialId != null ? origin + "/score/" + initialId : origin + "/dashboard");
            poll.Start();
        } catch {
            origin = null; status.Text = "Workspace could not open. Check the installation and Microsoft Edge WebView2 Runtime."; UpdateButtons();
        }
    }
    private async void ReceiveGrant(object sender, CoreWebView2WebMessageReceivedEventArgs args) {
        if (!WorkspacePolicy.SameOrigin(args.Source, origin) ||
            !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) || WorkspacePolicy.Game(args.Source, origin) != selectedGame) return;
        try {
            var raw = args.WebMessageAsJson;
            if (raw.Length > 4096) return;
            var value = json.Deserialize<Dictionary<string, object>>(raw);
            if (TextValue(value, "type") != null && TextValue(value, "type").StartsWith("studio-usb-")) {
                await UsbCommand(value); return;
            }
            if (value.Count == 2 && TextValue(value, "gameId") == selectedGame && selectedGame != null && !busy && !closing) {
                var type = TextValue(value, "type");
                if (type == "studio-youtube-start" || type == "studio-youtube-stop") { await YouTube(type == "studio-youtube-start"); return; }
                if (type == "studio-game-ended") { if (recording && runningGame == selectedGame) await StopRecording(); return; }
                if (type == "studio-game-ready") {
                    if (recording && runningGame != selectedGame) await StopRecording();
                    await StartRecording(); return;
                }
            }
            if (handoff == null || handoff.Task.IsCompleted) return;
            if (value.Count != 3 || !value.ContainsKey("nonce") || !value.ContainsKey("status") || !value.ContainsKey("sourceUrl") ||
                (string)value["nonce"] != handoffNonce) return;
            handoff.TrySetResult(value);
        } catch { /* Web messages never become arbitrary native commands. */ }
    }
    private async Task<string> PrepareGrant(string gameId) {
        if (!WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) || WorkspacePolicy.Game(web.CoreWebView2.Source, origin) != gameId) throw new InvalidDataException();
        handoffNonce = Guid.NewGuid().ToString("N"); handoff = new TaskCompletionSource<Dictionary<string, object>>();
        // Only a fixed same-origin endpoint/action; no account cookie/token extraction.
        var script = "(async()=>{let status=0,sourceUrl='';try{const r=await fetch(" + json.Serialize("/api/games/" + gameId + "/studio-m3") + ",{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'prepare'}),signal:AbortSignal.timeout(15000)});status=r.status;if(r.ok)sourceUrl=(await r.json()).sourceUrl;}catch{}window.chrome.webview.postMessage({nonce:" + json.Serialize(handoffNonce) + ",status,sourceUrl});})();";
        try {
            await web.ExecuteScriptAsync(script);
            if (await Task.WhenAny(handoff.Task, Task.Delay(20000)) != handoff.Task) throw new InvalidDataException();
            var result = await handoff.Task; var code = Convert.ToInt32(result["status"]);
            if (code != 200) throw new WorkspaceFailure(code == 401 || code == 403 ? "Sign in as this game's administrator before recording." : "The website could not prepare recording (HTTP " + code + "). Try again shortly.");
            if (WorkspacePolicy.Game(web.CoreWebView2.Source, origin) != gameId) throw new InvalidDataException();
            return WorkspacePolicy.Code((string)result["sourceUrl"], origin, gameId);
        } finally { handoff = null; handoffNonce = null; }
    }
    private async Task<string> WebsiteYouTube(string gameId, string suffix, object body) {
        if (WorkspacePolicy.Game(web.CoreWebView2.Source, origin) != gameId) throw new InvalidDataException();
        handoffNonce = Guid.NewGuid().ToString("N"); handoff = new TaskCompletionSource<Dictionary<string, object>>();
        var script = "(async()=>{let status=0,sourceUrl='';try{const r=await fetch(" + json.Serialize("/api/games/" + gameId + "/studio-m4" + suffix) + ",{method:'POST',headers:{'content-type':'application/json'},body:" + json.Serialize(json.Serialize(body)) + ",signal:AbortSignal.timeout(30000)});status=r.status;if(r.ok){const v=await r.json();sourceUrl=v.code||v.status||'';}}catch{}window.chrome.webview.postMessage({nonce:" + json.Serialize(handoffNonce) + ",status,sourceUrl});})();";
        try {
            await web.ExecuteScriptAsync(script);
            if (await Task.WhenAny(handoff.Task, Task.Delay(35000)) != handoff.Task) throw new InvalidDataException();
            var result = await handoff.Task;
            if (Convert.ToInt32(result["status"]) != 200 || WorkspacePolicy.Game(web.CoreWebView2.Source, origin) != gameId) throw new InvalidDataException();
            return TextValue(result, "sourceUrl");
        } finally { handoff = null; handoffNonce = null; }
    }
    private string youtubeError = "";
    private async Task YouTube(bool start) {
        if (busy || closing || !recording || selectedGame != runningGame) return;
        var gameId = runningGame; busy = true; youtubeError = "";
        try {
            if (start) {
                Dictionary<string, object> previous;
                using (var response = await local.GetAsync(localAddress + "/state")) { response.EnsureSuccessStatusCode(); previous = json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync()); }
                if (WorkspacePolicy.RestartYouTube(TextValue(previous, "pairing"), TextValue(previous, "streaming"))) {
                    // Grants and output sinks are single-use. Require confirmed cleanup before replacing them.
                    status.Text = "Reconnecting Studio for a new YouTube broadcast…";
                    await CloseController();
                    await ConnectProgram(gameId);
                }
                var prepared = await WebsiteYouTube(gameId, "", new { action = "prepare" });
                if (prepared != "prepared") throw new InvalidDataException();
                Dictionary<string, object> state;
                using (var response = await local.GetAsync(localAddress + "/state")) { response.EnsureSuccessStatusCode(); state = json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync()); }
                if (TextValue(state, "pairing") == "unpaired") {
                    var challenge = TextValue(state, "challenge");
                    if (challenge == null || !System.Text.RegularExpressions.Regex.IsMatch(challenge, "^[a-f0-9]{64}$")) throw new InvalidDataException();
                    var code = await WebsiteYouTube(gameId, "/desktop-pairing", new { challenge = challenge });
                    if (code == null || !System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Za-z0-9_-]{43}$")) throw new InvalidDataException();
                    ApplyState(await Command(new { action = "pair", code = code }));
                }
                ApplyState(await Command(new { action = "start-stream", intentId = Guid.NewGuid().ToString() }));
            } else {
                ApplyState(await Command(new { action = "stop-stream" }));
                await WebsiteYouTube(gameId, "", new { action = "stop" });
            }
        } catch (Exception error) {
            youtubeError = error is WorkspaceFailure ? error.Message : "Studio could not start YouTube. Close and reopen Studio, then try Broadcast to YouTube again.";
            if (WorkspacePolicy.Game(web.CoreWebView2.Source, origin) == gameId)
                web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-youtube-status',{detail:" + json.Serialize(new { gameId = gameId, available = true, busy = false, streaming = "failed", live = false, receiving = false, message = youtubeError }) + "}));");
        } finally { busy = false; UpdateButtons(); }
    }
    private async Task StartRecording() {
        if (busy || closing || recording || selectedGame == null) return;
        busy = true; UpdateButtons(); var gameId = selectedGame;
        try {
            await ConnectProgram(gameId);
        } catch (WorkspaceFailure e) { status.Text = e.Message; }
        catch { status.Text = "Cameras could not connect. Check your connection and Studio installation, then try again."; }
        finally { busy = false; UpdateButtons(); }
    }
    private async Task ConnectProgram(string gameId) {
            status.Text = "Checking this PC and connecting your game…";
            if (child != null && (child.HasExited || runningGame != gameId)) await CloseController();
            if (child == null) await StartController(gameId);
            var checkedState = await Command(new { action = "check" });
            if (TextValue(checkedState, "pc") != "ready") throw new WorkspaceFailure("This PC did not pass the recording check. Check the Studio installation.");
            status.Text = "Preparing your camera connection…";
            var code = await PrepareGrant(gameId);
            status.Text = "Connecting cameras…";
            ApplyState(await Command(new { action = "start-program", invitation = code }));
            if (!recording) throw new WorkspaceFailure("Cameras could not connect. Your game and camera assignments are retained. Try Connect cameras again.");
    }
    private async Task StopRecording() {
        await StopUsbAudio();
        if (busy || !recording) return;
        busy = true; UpdateButtons(); status.Text = "Disconnecting cameras…";
        try { ApplyState(await Command(new { action = "stop-program" })); }
        catch { status.Text = "Finalization was not confirmed. Keep Studio open and check the recordings folder."; }
        finally { busy = false; UpdateButtons(); }
    }
    private async Task StartController(string gameId) {
        var node = Path.Combine(root, "node", "node.exe"); var controller = Path.Combine(root, "app", "studio.mjs");
        await Task.Run(() => { Verify(node, nodeHash); Verify(controller, controllerHash); });
        ready = new TaskCompletionSource<string>(); exited = new TaskCompletionSource<bool>(); cleanupConfirmed = false; controllerReady = false; startupFailed = false;
        var info = new ProcessStartInfo(node) { Arguments = "\"" + controller + "\" \"" + origin + "/games/" + gameId + "\"", WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.EnvironmentVariables.Clear();
        foreach (var key in new[] { "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE" }) { var v = Environment.GetEnvironmentVariable(key); if (!String.IsNullOrEmpty(v)) info.EnvironmentVariables[key] = v; }
        info.EnvironmentVariables["PATH"] = Environment.GetFolderPath(Environment.SpecialFolder.System); info.EnvironmentVariables["NODE_ENV"] = "production";
        var process = new Process { StartInfo = info };
        process.OutputDataReceived += (s, e) => {
            if (e.Data == "CLOSED") cleanupConfirmed = true;
            if (e.Data == "START_FAILED") { startupFailed = true; ready.TrySetException(new InvalidDataException()); }
            if (e.Data != null && e.Data.StartsWith("READY ") && WorkspacePolicy.Loopback(e.Data.Substring(6))) { controllerReady = true; ready.TrySetResult(e.Data.Substring(6)); }
        };
        process.ErrorDataReceived += (s, e) => { /* Never forward raw diagnostics or credentials. */ };
        process.Start(); child = process; runningGame = gameId; process.BeginOutputReadLine(); process.BeginErrorReadLine();
        ObserveExit(process);
        if (await Task.WhenAny(ready.Task, Task.Delay(120000)) != ready.Task) throw new InvalidDataException();
        localAddress = await ready.Task;
        local = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer(), AllowAutoRedirect = false, UseProxy = false }) { Timeout = TimeSpan.FromSeconds(120) };
        using (var result = await local.GetAsync(localAddress)) result.EnsureSuccessStatusCode();
    }
    private async void ObserveExit(Process process) {
        await Task.Run(() => process.WaitForExit());
        var clean = cleanupConfirmed && process.ExitCode == 0;
        ready.TrySetException(new InvalidDataException()); exited.TrySetResult(clean);
        if (!closing && !busy && !clean) { status.Text = "Recording stopped unexpectedly. Check the recordings folder before restarting."; recording = false; UpdateButtons(); }
    }
    private async Task<Dictionary<string, object>> Command(object action) {
        if (local == null || !WorkspacePolicy.Loopback(localAddress)) throw new InvalidDataException();
        using (var request = new HttpRequestMessage(HttpMethod.Post, localAddress + "/command")) {
            request.Headers.Add("Origin", localAddress);
            request.Content = new StringContent(json.Serialize(action), Encoding.UTF8, "application/json"); request.Content.Headers.ContentType.CharSet = null;
            using (var response = await local.SendAsync(request)) { response.EnsureSuccessStatusCode(); return json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync()); }
        }
    }
    private string TextValue(Dictionary<string, object> state, string key) { object value; return state.TryGetValue(key, out value) ? value as string : null; }
    private void ApplyState(Dictionary<string, object> state) {
        var phase = TextValue(state, "program");
        recording = phase == "recording" || phase == "starting" || phase == "stopping" || (phase == "failed" && recording);
        previewMapping = phase == "recording" ? TextValue(state, "previewMapping") : null;
        object cameraStatus;
        if (web.CoreWebView2 != null && WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) && selectedGame == runningGame && state.TryGetValue("cameraStatus", out cameraStatus))
            web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-camera-status',{detail:" + json.Serialize(new { gameId = runningGame, cameras = cameraStatus }) + "}));");
        object phoneAudio;
        if (web.CoreWebView2 != null && WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) && selectedGame == runningGame && state.TryGetValue("phoneAudio", out phoneAudio))
            web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-audio-status',{detail:" + json.Serialize(new { gameId = runningGame, cameras = phoneAudio }) + "}));");
        if (web.CoreWebView2 != null && WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) && selectedGame == runningGame) {
            object available; var enabled = state.TryGetValue("streamingAvailable", out available) && available is bool && (bool)available;
            web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-youtube-status',{detail:" + json.Serialize(new { gameId = runningGame, available = enabled, busy = busy, streaming = TextValue(state, "streaming") ?? "idle", live = TextValue(state, "broadcast") == "live", receiving = TextValue(state, "youtubeReception") == "confirmed", message = enabled ? youtubeError : "YouTube streaming is not enabled in this Studio installation." }) + "}));");
        }
        status.Text = phase == "recording" ? "Cameras ready · Not recording · YouTube off" : phase == "stopped" ? "Cameras disconnected · No recording saved" : TextValue(state, "programMessage") ?? "Camera status is unavailable.";
        UpdateButtons();
    }
    private async Task Poll() {
        if (busy || polling || closing || local == null || !recording) return;
        polling = true;
        try { using (var response = await local.GetAsync(localAddress + "/state")) { response.EnsureSuccessStatusCode(); if (!busy && !closing) ApplyState(json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync())); } }
        catch { if (!busy) status.Text = "Recording status is unavailable. Keep Studio open while checking the recording."; }
        finally { polling = false; }
    }
    private async Task UsbCommand(Dictionary<string, object> value) {
        if (usbBusy || closing || selectedGame == null || TextValue(value, "gameId") != selectedGame ||
            !WorkspacePolicy.Microphone(origin, web.CoreWebView2.Source, origin, selectedGame, true)) return;
        var type = TextValue(value, "type");
        usbBusy = true;
        try {
            usbError = null;
            if (type == "studio-usb-list" && value.Count == 2) usbDevices = UsbAudio.Enumerate();
            else if (type == "studio-usb-stop" && value.Count == 2) await StopUsbAudio();
            else if (type == "studio-usb-start" && value.Count == 3) {
                var deviceId = TextValue(value, "deviceId");
                if (String.IsNullOrEmpty(deviceId) || deviceId.Length > 1024 || !recording || selectedGame != runningGame)
                    throw new InvalidOperationException("Open a game and wait for Studio before enabling USB audio.");
                await StopUsbAudio();
                usbGame = selectedGame;
                lock (usbLock) { usbPostedPackets = usbPostFailures = 0; usbPostedBytes = 0; usbLastPostError = null; }
                usbAudio.Start(deviceId, (samples, rate) => {
                    lock (usbLock) {
                        if (usbGame == null) return;
                        if (rate != 48000) { usbError = "Set the USB receiver to 48 kHz in Windows audio settings."; return; }
                        if (usbSamples.Count + samples.Length > 24000) usbSamples.Clear();
                        usbSamples.AddRange(samples);
                    }
                });
            } else if (type == "studio-usb-mute-all" && value.Count == 3 && usbGame == selectedGame) {
                object muted;
                if (!value.TryGetValue("muted", out muted) || !(muted is bool)) throw new InvalidDataException();
                usbAudio.SetAllMuted((bool)muted);
            } else if (type == "studio-usb-channel" && value.Count == 5 && usbGame == selectedGame) {
                object channel, muted, level;
                if (!value.TryGetValue("channel", out channel) || !(channel is int) || !value.TryGetValue("muted", out muted) || !(muted is bool) || !value.TryGetValue("level", out level) || !(level is decimal || level is double || level is int)) throw new InvalidDataException();
                var gain = Convert.ToDouble(level);
                if (Double.IsNaN(gain) || Double.IsInfinity(gain) || gain < 0 || gain > 1) throw new InvalidDataException();
                usbAudio.SetChannel((int)channel, (bool)muted, (float)gain);
            }
        } catch { usbError = "USB audio could not start or update. Check the receiver connection and selected input."; }
        finally { usbBusy = false; PublishUsbStatus(); }
    }
    private async Task StopUsbAudio() {
        usbGame = null;
        usbAudio.Stop();
        lock (usbLock) usbSamples.Clear();
        try { await usbSend; } catch { }
        if (local != null && WorkspacePolicy.Loopback(localAddress)) {
            try { await PostUsbAudio(new byte[0]); } catch { NoteUsbPostFailure(); }
        }
    }
    private async Task PostUsbAudio(byte[] bytes) {
        if (local == null || !WorkspacePolicy.Loopback(localAddress)) throw new InvalidDataException();
        using (var request = new HttpRequestMessage(HttpMethod.Post, localAddress + "/usb-audio"))
        using (var timeout = new System.Threading.CancellationTokenSource(2000)) {
            request.Headers.Add("Origin", localAddress);
            request.Content = new ByteArrayContent(bytes);
            request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            using (var result = await local.SendAsync(request, timeout.Token)) result.EnsureSuccessStatusCode();
            lock (usbLock) { usbPostedPackets++; usbPostedBytes += bytes.Length; usbLastPostError = null; }
        }
    }
    private void NoteUsbPostFailure() {
        lock (usbLock) { usbPostFailures++; usbLastPostError = "delivery-failed"; }
    }
    private async Task SendUsbAudio() {
        if (usbGame == null) return;
        if (!recording || usbGame != runningGame) { usbAudio.Stop(); usbGame = null; return; }
        float[] samples;
        lock (usbLock) { var count = Math.Min(4800, usbSamples.Count); samples = usbSamples.GetRange(0, count).ToArray(); usbSamples.RemoveRange(0, count); }
        try {
            if (samples.Length > 0) {
                var bytes = new byte[samples.Length * 4]; Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
                await PostUsbAudio(bytes);
            }
        } catch { NoteUsbPostFailure(); usbError = "USB audio delivery interrupted. Turn USB audio off and on to retry."; usbAudio.Stop(); usbGame = null; lock (usbLock) usbSamples.Clear(); }
        PublishUsbStatus();
    }
    private void PublishUsbStatus() {
        if (closing || web.CoreWebView2 == null || selectedGame == null || !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin)) return;
        var snapshot = usbAudio.Snapshot();
        object diagnostics;
        lock (usbLock) diagnostics = new { postedPackets = usbPostedPackets, postedBytes = usbPostedBytes, postFailures = usbPostFailures, latestPostError = usbLastPostError };
        WriteUsbDeliverySnapshot(snapshot.running, diagnostics);
        web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-usb-status',{detail:" + json.Serialize(new { gameId = selectedGame, devices = usbDevices, running = snapshot.running, allMuted = snapshot.allMuted, error = usbError ?? snapshot.error, channels = snapshot.channels, diagnostics = diagnostics }) + "}));");
    }
    private void WriteUsbDeliverySnapshot(bool running, object diagnostics) {
        var now = DateTime.UtcNow;
        if (now - usbDiagnosticsWrittenAt < TimeSpan.FromSeconds(5)) return;
        usbDiagnosticsWrittenAt = now;
        try {
            var path = profileDirectory == null
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio", "usb-delivery.json")
                : Path.Combine(profileDirectory, "usb-delivery.json");
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, json.Serialize(new { timestampUtc = now.ToString("o"), running = running, diagnostics = diagnostics }));
        } catch { /* Diagnostics must never interrupt audio capture or delivery. */ }
    }
    private async Task CloseController() {
        await StopUsbAudio();
        if (child == null) return;
        status.Text = "Stopping output and disconnecting cameras…";
        if (!child.HasExited) { child.StandardInput.WriteLine("close"); child.StandardInput.Flush(); }
        if (await Task.WhenAny(exited.Task, Task.Delay(120000)) != exited.Task ||
            (!(await exited.Task) && !(startupFailed && !controllerReady))) throw new InvalidDataException();
        if (local != null) local.Dispose(); local = null; child.Dispose(); child = null; runningGame = null; localAddress = null; recording = false;
    }
    private void OpenRecordings() {
        try { var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio", "Recordings"); Directory.CreateDirectory(folder); Process.Start(new ProcessStartInfo(WorkspacePolicy.ExistingDirectory(folder)) { UseShellExecute = true }); }
        catch { status.Text = "Could not open the recordings folder."; }
    }
    private sealed class WorkspaceFailure : Exception { internal WorkspaceFailure(string message) : base(message) {} }
}
