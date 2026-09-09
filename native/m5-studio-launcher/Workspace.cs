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
    private readonly Button record = new Button(), finish = new Button(), devices = new Button();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 65536 };
    private readonly string nodeHash, controllerHash, configurationHash, root, launchGame;
    private readonly System.Windows.Forms.Timer poll = new System.Windows.Forms.Timer { Interval = 2000 };
    private string origin, selectedGame, runningGame, localAddress, handoffNonce;
    private Process child;
    private HttpClient local;
    private TaskCompletionSource<string> ready;
    private TaskCompletionSource<bool> exited;
    private TaskCompletionSource<Dictionary<string, object>> handoff;
    private bool busy, polling, closing, mayClose, cleanupConfirmed, recording, controllerReady, startupFailed;

    internal Workspace(string initialGame, string node, string controller, string configuration)
    {
        launchGame = initialGame; nodeHash = node; controllerHash = controller; configurationHash = configuration;
        root = AppDomain.CurrentDomain.BaseDirectory;
        Text = "CurlStreamer Studio — Workspace Preview";
        ClientSize = new Size(1180, 820); MinimumSize = new Size(940, 680);
        AutoScaleMode = AutoScaleMode.Dpi; Font = new Font("Segoe UI", 10);
        BackColor = Color.FromArgb(10, 24, 40); ForeColor = Color.White;
        var header = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 62, Padding = new Padding(10, 6, 10, 6), WrapContents = false };
        header.Controls.Add(new Label { Text = "CurlStreamer Studio", AutoSize = true, Font = new Font(Font.FontFamily, 15, FontStyle.Bold), Padding = new Padding(3, 10, 14, 0) });
        Nav(header, "Games & schedule", "/dashboard"); Nav(header, "Seasons", "/seasons");
        Nav(header, "Sponsors", "/sponsors"); Nav(header, "Account", "/account");
        var refresh = MakeButton("Refresh"); refresh.Click += (s, e) => { if (!busy && web.CoreWebView2 != null) web.Reload(); }; header.Controls.Add(refresh);
        var bottom = new TableLayoutPanel { Dock = DockStyle.Bottom, Height = 118, Padding = new Padding(12, 5, 12, 7), ColumnCount = 1, RowCount = 2 };
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Height = 54 };
        record.Text = "Start recording"; Style(record); record.Click += async (s, e) => await StartRecording();
        finish.Text = "Stop & save recording"; Style(finish); finish.Click += async (s, e) => await StopRecording();
        devices.Text = "Cameras & remote scoring"; Style(devices); devices.Click += (s, e) => Navigate("/games/" + selectedGame + "/studio");
        var files = MakeButton("Recordings folder"); files.Click += (s, e) => OpenRecordings();
        actions.Controls.AddRange(new Control[] { record, finish, devices, files });
        status.Text = "Opening your workspace…"; status.Dock = DockStyle.Fill; status.AutoEllipsis = true;
        status.AccessibleName = "Recording status"; status.Padding = new Padding(5, 5, 0, 0);
        bottom.Controls.Add(actions); bottom.Controls.Add(status);
        web.Dock = DockStyle.Fill;
        Controls.Add(web); Controls.Add(bottom); Controls.Add(header);
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
    private void Style(Button b) { b.UseMnemonic = false; b.AutoSize = true; b.Height = 44; b.MinimumSize = new Size(80, 44); b.Padding = new Padding(8, 0, 8, 0); b.ForeColor = Color.Black; b.BackColor = Color.FromArgb(65, 211, 226); }
    private void Nav(FlowLayoutPanel panel, string label, string path) { var b = MakeButton(label); b.Click += (s, e) => Navigate(path); panel.Controls.Add(b); }
    private void Navigate(string path) { if (!busy && !closing && origin != null && web.CoreWebView2 != null) web.CoreWebView2.Navigate(origin + path); }
    private void UpdateButtons() {
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
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio", "WorkspaceProfile");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.UserAgent += " CurlStreamerStudio/0.3";
            core.Settings.AreDevToolsEnabled = false; core.Settings.IsStatusBarEnabled = false;
            core.NavigationStarting += (s, e) => {
                if (busy || closing) { e.Cancel = true; return; }
                if (!WorkspacePolicy.SameOrigin(e.Uri, origin)) { e.Cancel = true; status.Text = "Use the website in your browser for external account connections."; }
                selectedGame = null; UpdateButtons();
            };
            core.SourceChanged += (s, e) => { selectedGame = WorkspacePolicy.Game(core.Source, origin); UpdateButtons(); };
            core.NavigationCompleted += (s, e) => {
                selectedGame = WorkspacePolicy.Game(core.Source, origin);
                if (!e.IsSuccess && !recording) status.Text = "The workspace could not load. Check your internet connection and choose Refresh.";
                else if (!recording && !busy) status.Text = selectedGame == null ? "Sign in and choose a game. Your account, schedule and sponsors are shared with the website." : "Game selected. Connect your camera devices, then choose Start recording. YouTube is off in this preview.";
                UpdateButtons();
            };
            core.NewWindowRequested += (s, e) => { e.Handled = true; if (WorkspacePolicy.SameOrigin(e.Uri, origin)) Navigate(new Uri(e.Uri).PathAndQuery + new Uri(e.Uri).Fragment); else status.Text = "External account connections are available from the website in your browser."; };
            core.PermissionRequested += (s, e) => { e.State = CoreWebView2PermissionState.Deny; };
            core.WebMessageReceived += ReceiveGrant;
            core.Navigate(launchGame != null && WorkspacePolicy.Game(launchGame, origin) != null ? launchGame : origin + "/dashboard");
            poll.Start();
        } catch {
            origin = null; status.Text = "Workspace could not open. Check the installation and Microsoft Edge WebView2 Runtime."; UpdateButtons();
        }
    }
    private void ReceiveGrant(object sender, CoreWebView2WebMessageReceivedEventArgs args) {
        if (handoff == null || handoff.Task.IsCompleted || !WorkspacePolicy.SameOrigin(args.Source, origin) ||
            !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) || WorkspacePolicy.Game(args.Source, origin) != selectedGame) return;
        try {
            var raw = args.WebMessageAsJson;
            if (raw.Length > 4096) return;
            var value = json.Deserialize<Dictionary<string, object>>(raw);
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
    private async Task StartRecording() {
        if (busy || closing || recording || selectedGame == null) return;
        busy = true; UpdateButtons(); var gameId = selectedGame;
        try {
            status.Text = "Checking this PC and connecting your game…";
            if (child != null && (child.HasExited || runningGame != gameId)) await CloseController();
            if (child == null) await StartController(gameId);
            var checkedState = await Command(new { action = "check" });
            if (TextValue(checkedState, "pc") != "ready") throw new WorkspaceFailure("This PC did not pass the recording check. Check the Studio installation.");
            status.Text = "Preparing your recording connection…";
            var code = await PrepareGrant(gameId);
            status.Text = "Starting recording…";
            ApplyState(await Command(new { action = "start-program", invitation = code }));
            if (!recording) throw new WorkspaceFailure("Recording could not start. Your game and camera assignments are retained. Try Start recording again.");
        } catch (WorkspaceFailure e) { status.Text = e.Message; }
        catch { status.Text = "Recording could not start. Check your connection and Studio installation, then try again."; }
        finally { busy = false; UpdateButtons(); }
    }
    private async Task StopRecording() {
        if (busy || !recording) return;
        busy = true; UpdateButtons(); status.Text = "Finalizing your recording…";
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
        status.Text = phase == "recording" ? "Recording is active on this PC. You can score or browse your workspace. YouTube is off in this preview." : TextValue(state, "programMessage") ?? "Recording status is unavailable.";
        UpdateButtons();
    }
    private async Task Poll() {
        if (busy || polling || closing || local == null || !recording) return;
        polling = true;
        try { using (var response = await local.GetAsync(localAddress + "/state")) { response.EnsureSuccessStatusCode(); if (!busy && !closing) ApplyState(json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync())); } }
        catch { if (!busy) status.Text = "Recording status is unavailable. Keep Studio open while checking the recording."; }
        finally { polling = false; }
    }
    private async Task CloseController() {
        if (child == null) return;
        status.Text = "Stopping output and saving your recording…";
        if (!child.HasExited) { child.StandardInput.WriteLine("close"); child.StandardInput.Flush(); }
        if (await Task.WhenAny(exited.Task, Task.Delay(120000)) != exited.Task ||
            (!(await exited.Task) && !(startupFailed && !controllerReady))) throw new InvalidDataException();
        if (local != null) local.Dispose(); local = null; child.Dispose(); child = null; runningGame = null; localAddress = null; recording = false;
    }
    private void OpenRecordings() {
        try { var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio", "Recordings"); Directory.CreateDirectory(folder); Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true }); }
        catch { status.Text = "Could not open the recordings folder."; }
    }
    private sealed class WorkspaceFailure : Exception { internal WorkspaceFailure(string message) : base(message) {} }
}
