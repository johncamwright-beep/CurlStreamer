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
    private bool busy, polling, closing, mayClose, recording, controllerReady, startupFailed;
    private Dictionary<string, object> lastState;
    private Dictionary<string, Dictionary<string, object>> cameraInputs = new Dictionary<string, Dictionary<string, object>>();
    private bool cameraSettingsOpen;
    private string closeAfterGame;
    private bool endRequestPending, gameEnded;
    private DateTime endingUntil = DateTime.MinValue;
    private readonly UsbAudio usbAudio = new UsbAudio();
    private readonly object usbLock = new object();
    private readonly List<float> usbSamples = new List<float>();
    private readonly System.Windows.Forms.Timer usbTimer = new System.Windows.Forms.Timer { Interval = 50 };
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
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
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
            var game = runningGame ?? selectedGame ?? lastGame;
            if (game != null && !gameEnded) {
                var choice = MessageBox.Show(this,
                    "Do you want to end the game?\n\nYes: review and confirm the final score, then close Studio.\nNo: close Studio and return to this game later. Your score and YouTube link are kept.\nCancel: stay in Studio.\n\nClosing Studio interrupts local cameras, audio and video delivery.",
                    "Close Studio", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button3);
                if (choice == DialogResult.Cancel) { closeAfterGame = null; endRequestPending = false; return; }
                if (choice == DialogResult.Yes) { await RequestEndGame(game); return; }
                RememberGame(game);
            }
            await CloseWorkspace();
        };
        UpdateButtons();
    }
    protected override bool ProcessCmdKey(ref Message message, Keys keyData) {
        if (keyData == (Keys.Control | Keys.R)) { ReloadWorkspace(); return true; }
        return base.ProcessCmdKey(ref message, keyData);
    }
    private void ReloadWorkspace() {
        if (busy || closing || web.CoreWebView2 == null) return;
        closeAfterGame = null; endRequestPending = false;
        web.CoreWebView2.Reload();
    }
    private Button MakeButton(string text) { var b = new Button { Text = text }; Style(b); return b; }
    private void Style(Button b) { b.UseMnemonic = false; b.AutoSize = true; b.Height = 44; b.MinimumSize = new Size(80, 44); b.Padding = new Padding(14, 0, 14, 0); b.Margin = new Padding(0, 0, 10, 0); b.ForeColor = Color.FromArgb(220, 230, 238); b.BackColor = Color.FromArgb(21, 38, 54); b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderColor = Color.FromArgb(52, 73, 91); b.FlatAppearance.MouseOverBackColor = Color.FromArgb(39, 69, 83); b.Cursor = Cursors.Hand; }
    private void Nav(FlowLayoutPanel panel, string label, string path) { var b = MakeButton(label); b.Click += (s, e) => Navigate(path); panel.Controls.Add(b); }
    private void Navigate(string path) { if (!busy && !closing && origin != null && web.CoreWebView2 != null) web.CoreWebView2.Navigate(origin + path); }
    private TableLayoutPanel bottom;
    private string LifecycleDirectory { get { return profileDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio"); } }
    private void RememberGame(string game) {
        try {
            if (WorkspacePolicy.Game(origin + "/score/" + game, origin) != game) return;
            Directory.CreateDirectory(LifecycleDirectory);
            File.WriteAllText(Path.Combine(LifecycleDirectory, "resume-game.json"), json.Serialize(new { origin = origin, gameId = game }));
        } catch { status.Text = "Your game is saved online. Choose it from Games when you reopen Studio."; }
    }
    private string RememberedGame() {
        try {
            var path = Path.Combine(LifecycleDirectory, "resume-game.json");
            if (!File.Exists(path) || new FileInfo(path).Length > 1024) return null;
            var value = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
            var game = TextValue(value, "gameId");
            return value.Count == 2 && TextValue(value, "origin") == origin &&
                WorkspacePolicy.Game(origin + "/score/" + game, origin) == game ? game : null;
        } catch { return null; }
    }
    private void ForgetGame() {
        try { File.Delete(Path.Combine(LifecycleDirectory, "resume-game.json")); } catch { }
    }
    private async Task RequestEndGame(string game) {
        if (web.CoreWebView2 == null || origin == null) { status.Text = "Open this game's scoring screen to review its final score."; return; }
        closeAfterGame = game; endRequestPending = true;
        if (WorkspacePolicy.Game(web.CoreWebView2.Source, origin) == game && new Uri(web.CoreWebView2.Source).AbsolutePath == "/score/" + game)
            await DispatchEndGame();
        else Navigate("/score/" + game);
    }
    private async Task DispatchEndGame() {
        if (!endRequestPending || selectedGame != closeAfterGame || web.CoreWebView2 == null ||
            !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin)) return;
        await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-end-game-request',{detail:" + json.Serialize(new { gameId = closeAfterGame }) + "}));");
        status.Text = "Review and confirm End Game above. Cancel keeps Studio open.";
    }
    private async Task CloseWorkspace() {
        closing = true; UpdateButtons();
        try {
            await CloseController();
            mayClose = true; poll.Stop(); usbTimer.Stop(); web.Dispose(); Close();
        } catch {
            closing = false;
            status.Text = "Studio has not stopped safely yet. It remains open; wait and try closing again.";
            UpdateButtons();
        }
    }
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
            try { cameraInputs = CameraInputs.Load(LifecycleDirectory); }
            catch { status.Text = "Saved camera settings could not be read. Use Settings on each camera to enter them again."; }
            if (!WorkspacePolicy.SameOrigin(origin, origin) || new Uri(origin).AbsoluteUri != origin + "/") throw new InvalidDataException();
            var profile = profileDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio", "WorkspaceProfile");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            // WinForms WebView2 forwards its accelerator keys through KeyDown.
            web.KeyDown += (s, e) => {
                if (e.KeyData == (Keys.Control | Keys.R)) {
                    e.Handled = true;
                    BeginInvoke((Action)ReloadWorkspace);
                }
            };
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
                if (WorkspacePolicy.YouTubeAccountConnection(e.Uri, origin)) {
                    e.Cancel = true;
                    // Start a fresh browser session; never transfer Studio cookies or OAuth state.
                    try {
                        Process.Start(new ProcessStartInfo(origin + "/account?section=youtube") { UseShellExecute = true });
                        status.Text = "YouTube Settings opened in your browser. Sign in if needed, reconnect the existing channel, then return to Studio.";
                    } catch { status.Text = "Open " + origin + "/account?section=youtube in your browser to reconnect YouTube."; }
                    return;
                }
                if (!WorkspacePolicy.SameOrigin(e.Uri, origin)) { e.Cancel = true; status.Text = "Use the website in your browser for external account connections."; }
                selectedGame = null; UpdateButtons();
            };
            core.SourceChanged += (s, e) => {
                var nextGame = WorkspacePolicy.Game(core.Source, origin);
                if (nextGame != null && nextGame != selectedGame) gameEnded = false;
                selectedGame = nextGame;
                if (closeAfterGame != null && selectedGame != closeAfterGame) { closeAfterGame = null; endRequestPending = false; }
                if (selectedGame != null) { lastGame = selectedGame; RememberGame(selectedGame); }
                if (usbGame != null && usbGame != selectedGame) { var ignored = StopUsbAudio(); }
                UpdateButtons();
            };
            core.NavigationCompleted += (s, e) => {
                selectedGame = WorkspacePolicy.Game(core.Source, origin);
                if (!e.IsSuccess && !recording) status.Text = "The workspace could not load. Check your internet connection and press Ctrl+R to reload.";
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
            var initialId = launchGame == null ? RememberedGame() : WorkspacePolicy.Game(launchGame, origin);
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
            if (raw.Length > 8192) return;
            var value = json.Deserialize<Dictionary<string, object>>(raw);
            var presentationType = TextValue(value, "type");
            if (presentationType == "studio-youtube-hold" || presentationType == "studio-youtube-resume" || presentationType == "studio-ending-prepare" || presentationType == "studio-ending-show" || presentationType == "studio-ending-cancel" || presentationType == "studio-ending-finish") {
                if (TextValue(value, "gameId") != runningGame || selectedGame != runningGame || busy || closing || !recording) return;
                var requestNonce = TextValue(value, "nonce");
                Guid parsedNonce; if (!Guid.TryParse(requestNonce, out parsedNonce)) return;
                await PresentationCommand(presentationType, requestNonce, value); return;
            }
            if (value.Count == 3 && TextValue(value, "gameId") == runningGame && selectedGame == runningGame && runningGame != null && !busy && !closing && CameraInputs.Role(TextValue(value, "cameraRole"))) {
                if (TextValue(value, "action") == "configure-camera") { OpenCameraSettings(TextValue(value, "cameraRole")); return; }
                if (TextValue(value, "action") == "reconnect-camera") { ApplyState(await Command(new { action = "reconnect-camera-input", cameraRole = TextValue(value, "cameraRole") })); return; }
            }
            if (TextValue(value, "type") != null && TextValue(value, "type").StartsWith("studio-usb-")) {
                await UsbCommand(value); return;
            }
            if (value.Count == 2 && TextValue(value, "gameId") == selectedGame && selectedGame != null && !closing) {
                var type = TextValue(value, "type");
                if (type == "studio-end-game-opened") { endRequestPending = false; return; }
                if (type == "studio-end-game-cancelled" || type == "studio-end-game-unavailable") {
                    closeAfterGame = null; endRequestPending = false;
                    if (type == "studio-end-game-unavailable") status.Text = "End Game is unavailable. Sign in as this game's administrator, or choose No to close and return later.";
                    return;
                }
                if (type == "studio-game-ended") {
                    gameEnded = true; ForgetGame(); lastGame = null;
                    for (int wait = 0; busy && !closing && wait < 120; wait++) await Task.Delay(1000);
                    if (busy || closing) { status.Text = "Game ended. Wait for the current Studio action, then close Studio."; return; }
                    if (endingUntil > DateTime.UtcNow) return;
                    if (closeAfterGame == selectedGame) { closeAfterGame = null; endRequestPending = false; await CloseWorkspace(); }
                    else if (recording && runningGame == selectedGame) await StopRecording();
                    return;
                }
                if (busy) return;
                if (type == "studio-youtube-start" || type == "studio-youtube-stop") { await YouTube(type == "studio-youtube-start"); return; }
                if (type == "studio-game-ready") {
                    gameEnded = false;
                    if (endRequestPending && closeAfterGame == selectedGame) await DispatchEndGame();
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
    private bool StateFlag(string key) {
        object value; return lastState != null && lastState.TryGetValue(key, out value) && value is bool && (bool)value;
    }
    private async Task PresentationCommand(string type, string nonce, Dictionary<string, object> value) {
        var gameId = runningGame; object presentation = null, closeReceipt = null; bool ok = false;
        if (!StateFlag(type.StartsWith("studio-ending-") ? "canGracefulEnd" : "canHoldStream")) {
            await PublishPresentationResult(gameId, nonce, false, null, null); return;
        }
        busy = true;
        try {
            Dictionary<string, object> result;
            if (type == "studio-ending-prepare") {
                endingUntil = DateTime.UtcNow.AddSeconds(30);
                result = await Command(new { action = "prepare-ending" });
                result.TryGetValue("closing", out closeReceipt);
            } else if (type == "studio-ending-show") {
                object completion, closingValue;
                if (value.Count != 5 || !value.TryGetValue("completion", out completion) || !value.TryGetValue("closing", out closingValue)) throw new InvalidDataException();
                var receipt = closingValue as Dictionary<string, object>; DateTime deadline;
                if (receipt == null || !DateTime.TryParse(TextValue(receipt, "deadlineAt"), null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out deadline) || deadline <= DateTime.UtcNow || deadline > DateTime.UtcNow.AddSeconds(30)) throw new InvalidDataException();
                endingUntil = deadline;
                result = await Command(new { action = "show-ending", completion = completion, closing = closingValue });
            } else if (type == "studio-ending-finish") {
                result = await Command(new { action = "finish-ending" }); endingUntil = DateTime.MinValue;
            } else {
                var action = type == "studio-youtube-hold" ? "hold-stream" : type == "studio-youtube-resume" ? "release-hold" : "cancel-ending";
                result = await Command(new { action = action });
                if (type == "studio-ending-cancel") endingUntil = DateTime.MinValue;
            }
            ApplyState(result); result.TryGetValue("presentation", out presentation); ok = true;
        } catch { if (type == "studio-ending-prepare" || type == "studio-ending-cancel") endingUntil = DateTime.MinValue; }
        finally { busy = false; PublishYouTubeStatus(lastState); UpdateButtons(); }
        await PublishPresentationResult(gameId, nonce, ok, presentation, closeReceipt);
    }
    private Task PublishPresentationResult(string gameId, string nonce, bool ok, object presentation, object closeReceipt) {
        return web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-presentation-result',{detail:" + json.Serialize(new { gameId = gameId, nonce = nonce, ok = ok, presentation = presentation, closing = closeReceipt, error = ok ? null : "Studio could not confirm this presentation change." }) + "}));");
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
        var script = "(async()=>{let status=0,sourceUrl='';try{const r=await fetch(" + json.Serialize("/api/games/" + gameId + "/studio-m4" + suffix) + ",{method:'POST',headers:{'content-type':'application/json'},body:" + json.Serialize(json.Serialize(body)) + ",signal:AbortSignal.timeout(30000)});status=r.status;const v=await r.json();sourceUrl=v.lastErrorCode||v.code||v.status||'';}catch{}window.chrome.webview.postMessage({nonce:" + json.Serialize(handoffNonce) + ",status,sourceUrl});})();";
        try {
            await web.ExecuteScriptAsync(script);
            if (await Task.WhenAny(handoff.Task, Task.Delay(35000)) != handoff.Task) throw new InvalidDataException();
            var result = await handoff.Task;
            if (WorkspacePolicy.Game(web.CoreWebView2.Source, origin) != gameId) throw new InvalidDataException();
            if (Convert.ToInt32(result["status"]) != 200) throw new WorkspaceFailure(WorkspacePolicy.YouTubeFailure(TextValue(result, "sourceUrl")), TextValue(result, "sourceUrl"));
            return TextValue(result, "sourceUrl");
        } finally { handoff = null; handoffNonce = null; }
    }
    private string youtubeError = "";
    private async Task<string> PrepareYouTube(string gameId) {
        for (int attempt = 0; ; attempt++) {
            try { return await WebsiteYouTube(gameId, "", new { action = "prepare" }); }
            catch (WorkspaceFailure failure) {
                if (failure.Code != "studio_recovery_pending" || attempt >= 7) throw;
                status.Text = "Waiting for the previous Studio connection to expire. Keeping the same YouTube link…";
            }
            await Task.Delay(5000);
        }
    }
    private async Task YouTube(bool start) {
        if (busy || closing || !recording || selectedGame != runningGame) return;
        var gameId = runningGame; busy = true; youtubeError = "";
        try {
            if (start) {
                Dictionary<string, object> previous;
                using (var response = await local.GetAsync(localAddress + "/state")) { response.EnsureSuccessStatusCode(); previous = json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync()); }
                if (WorkspacePolicy.RestartYouTube(TextValue(previous, "pairing"), TextValue(previous, "streaming"))) {
                    throw new WorkspaceFailure("Studio's stream authority ended. Keep this game open and check YouTube settings. A replacement watch link will not be created automatically.");
                }
                if (TextValue(previous, "streaming") == "paused") {
                    ApplyState(await Command(new { action = "resume-stream" }));
                    return;
                }
                if (TextValue(previous, "streaming") != "idle") throw new WorkspaceFailure("This YouTube output is already connecting. Wait for its status before reconnecting.");
                var prepared = await PrepareYouTube(gameId);
                if (prepared != "prepared") throw new WorkspaceFailure(WorkspacePolicy.YouTubeFailure(prepared));
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
                ApplyState(await Command(new { action = "pause-stream" }));
            }
        } catch (Exception error) {
            youtubeError = error is WorkspaceFailure ? error.Message : "Studio could not change the YouTube connection. Your game and watch link are retained. Check the connection status and try again.";
        } finally { busy = false; PublishYouTubeStatus(lastState); UpdateButtons(); }
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
            foreach (var source in cameraInputs)
                ApplyState(await Command(new { action = "configure-camera-input", cameraRole = source.Key, source = source.Value }));
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
        ready = new TaskCompletionSource<string>(); exited = new TaskCompletionSource<bool>(); controllerReady = false; startupFailed = false; lastState = null;
        var processReady = ready; var processExited = exited; bool processCleanupConfirmed = false;
        var info = new ProcessStartInfo(node) { Arguments = "\"" + controller + "\" \"" + origin + "/games/" + gameId + "\"", WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.EnvironmentVariables.Clear();
        foreach (var key in new[] { "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE" }) { var v = Environment.GetEnvironmentVariable(key); if (!String.IsNullOrEmpty(v)) info.EnvironmentVariables[key] = v; }
        info.EnvironmentVariables["PATH"] = Environment.GetFolderPath(Environment.SpecialFolder.System); info.EnvironmentVariables["NODE_ENV"] = "production";
        var process = new Process { StartInfo = info };
        process.OutputDataReceived += (s, e) => {
            if (e.Data == "CLOSED") processCleanupConfirmed = true;
            if (e.Data == "START_FAILED") { if (child == process) startupFailed = true; processReady.TrySetException(new InvalidDataException()); }
            if (e.Data != null && e.Data.StartsWith("READY ") && WorkspacePolicy.Loopback(e.Data.Substring(6))) { if (child == process) controllerReady = true; processReady.TrySetResult(e.Data.Substring(6)); }
        };
        process.ErrorDataReceived += (s, e) => { /* Never forward raw diagnostics or credentials. */ };
        process.Start(); child = process; runningGame = gameId; process.BeginOutputReadLine(); process.BeginErrorReadLine();
        ObserveExit(process, processReady, processExited, () => processCleanupConfirmed);
        if (await Task.WhenAny(processReady.Task, Task.Delay(120000)) != processReady.Task) throw new InvalidDataException();
        localAddress = await processReady.Task;
        local = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer(), AllowAutoRedirect = false, UseProxy = false }) { Timeout = TimeSpan.FromSeconds(120) };
        using (var result = await local.GetAsync(localAddress)) result.EnsureSuccessStatusCode();
    }
    private async void ObserveExit(Process process, TaskCompletionSource<string> processReady, TaskCompletionSource<bool> processExited, Func<bool> confirmed) {
        await Task.Run(() => process.WaitForExit());
        var clean = confirmed() && process.ExitCode == 0;
        processReady.TrySetException(new InvalidDataException()); processExited.TrySetResult(clean);
        if (child != process) return;
        try {
            var directory = profileDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio");
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, "controller-exit.json"), json.Serialize(new { timestampUtc = DateTime.UtcNow.ToString("o"), exitCode = process.ExitCode, cleanupConfirmed = clean }));
        } catch { /* Only lifecycle facts, never child stderr or arguments. */ }
        if (!closing && !clean) {
            recording = false; previewMapping = null; lastState = null;
            youtubeError = "Studio's local video controller stopped. Close and reopen Studio before reconnecting cameras and YouTube.";
            if (local != null) local.CancelPendingRequests();
            if (handoff != null) handoff.TrySetException(new WorkspaceFailure(youtubeError));
            usbAudio.Stop(); usbGame = null; lock (usbLock) usbSamples.Clear();
            usbError = "Studio's local video controller stopped. Reconnect Studio before enabling USB audio.";
            PublishUsbStatus(); PublishYouTubeStatus(null);
            status.Text = "Studio's local video controller stopped. Close and reopen Studio to reconnect.";
            UpdateButtons();
        }
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
        if (child == null || child.HasExited) return;
        lastState = state;
        var phase = TextValue(state, "program");
        recording = phase == "recording" || phase == "starting" || phase == "stopping" || (phase == "failed" && recording);
        previewMapping = phase == "recording" ? TextValue(state, "previewMapping") : null;
        object cameraStatus;
        object inputs;
        if (web.CoreWebView2 != null && WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) && selectedGame == runningGame && state.TryGetValue("cameraInputs", out inputs))
            web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-camera-inputs',{detail:" + json.Serialize(new { gameId = runningGame, cameras = SafeCameraInputs(inputs) }) + "}));");
        if (web.CoreWebView2 != null && WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) && selectedGame == runningGame && state.TryGetValue("cameraStatus", out cameraStatus))
            web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-camera-status',{detail:" + json.Serialize(new { gameId = runningGame, cameras = cameraStatus }) + "}));");
        object phoneAudio;
        if (web.CoreWebView2 != null && WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) && selectedGame == runningGame && state.TryGetValue("phoneAudio", out phoneAudio))
            web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-audio-status',{detail:" + json.Serialize(new { gameId = runningGame, cameras = phoneAudio }) + "}));");
        PublishYouTubeStatus(state);
        status.Text = phase == "recording" ? "Cameras ready · Not recording · YouTube off" : phase == "stopped" ? "Cameras disconnected · No recording saved" : TextValue(state, "programMessage") ?? "Camera status is unavailable.";
        UpdateButtons();
    }
    private void PublishYouTubeStatus(Dictionary<string, object> state) {
        if (web.CoreWebView2 != null && WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) && selectedGame == runningGame) {
            var offline = state == null;
            object available; var enabled = !offline && state.TryGetValue("streamingAvailable", out available) && available is bool && (bool)available;
            object recovery; var canReconnect = !offline && state.TryGetValue("canReconnect", out recovery) && recovery is bool && (bool)recovery;
            object presentation; if (offline || !state.TryGetValue("presentation", out presentation)) presentation = null;
            object output; var localOutput = !offline && state.TryGetValue("localOutput", out output) ? output as Dictionary<string, object> : null;
            web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-youtube-status',{detail:" + json.Serialize(new { gameId = runningGame, available = !offline && enabled, busy = !offline && busy, canReconnect = canReconnect, canHoldStream = !offline && StateFlag("canHoldStream"), canGracefulEnd = !offline && StateFlag("canGracefulEnd"), presentation = presentation, streaming = offline ? "failed" : TextValue(state, "streaming") ?? "idle", outputActive = localOutput != null && TextValue(localOutput, "state") == "active", live = !offline && TextValue(state, "broadcast") == "live", receiving = !offline && TextValue(state, "youtubeReception") == "confirmed", message = offline || enabled ? youtubeError : "YouTube streaming is not enabled in this Studio installation." }) + "}));");
        }
    }
    private async Task Poll() {
        if (polling || closing || local == null || !recording) return;
        var observedChild = child;
        polling = true;
        try { using (var timeout = new System.Threading.CancellationTokenSource(3000)) using (var response = await local.GetAsync(localAddress + "/state", timeout.Token)) { response.EnsureSuccessStatusCode(); if (!closing && child == observedChild) ApplyState(json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync())); } }
        catch { if (!busy) status.Text = "Recording status is unavailable. Keep Studio open while checking the recording."; }
        finally { polling = false; }
        if (gameEnded && endingUntil != DateTime.MinValue && endingUntil <= DateTime.UtcNow && !busy && !closing) { endingUntil = DateTime.MinValue; await StopRecording(); }
    }
    private string CameraInputStatus(string role) {
        object inputs, slot;
        var map = lastState != null && lastState.TryGetValue("cameraInputs", out inputs) ? inputs as Dictionary<string, object> : null;
        var state = map != null && map.TryGetValue(role, out slot) ? slot as Dictionary<string, object> : null;
        if (state == null) return "Saved settings apply when you connect this game's cameras.";
        object cameras, fresh;
        var receiving = lastState.TryGetValue("cameraStatus", out cameras) ? cameras as Dictionary<string, object> : null;
        if (receiving != null && receiving.TryGetValue(role, out fresh) && fresh is bool && (bool)fresh) return "Receiving fresh camera video.";
        var error = TextValue(state, "errorCode");
        if (error == "auth_failed") return "Camera login rejected. Check the local username and password.";
        if (error == "runtime_missing") return "IP camera runtime missing. Check this Studio installation.";
        if (error == "stale_frames") return "Camera video stopped. Check Wi-Fi and reconnect.";
        if (error != null) return "Camera could not connect. Check Wi-Fi, the IP address and local RTSP access.";
        return TextValue(state, "phase") == "connecting" || TextValue(state, "phase") == "retrying" ? "Connecting — waiting for fresh camera video." : "Video not yet verified. Connect this game’s cameras to test.";
    }
    private object SafeCameraInputs(object inputs) {
        var output = new Dictionary<string, object>();
        var map = inputs as Dictionary<string, object>;
        if (map == null) return output;
        foreach (var role in new[] { "camera-home", "camera-away" }) {
            object slot; if (!map.TryGetValue(role, out slot)) continue;
            var source = slot as Dictionary<string, object>; if (source == null) continue;
            var kind = TextValue(source, "kind");
            if (kind != "phone" && kind != "tapo" && kind != "rtsp") continue;
            var safe = new Dictionary<string, object>();
            // Whitelist facts even if a future local controller adds fields.
            safe["kind"] = kind;
            object value;
            if (source.TryGetValue("host", out value) && value is string && CameraInputs.PrivateIPv4((string)value)) safe["host"] = value;
            if (kind == "tapo" && source.TryGetValue("stream", out value) && (Object.Equals(value, "stream1") || Object.Equals(value, "stream2"))) safe["stream"] = value;
            if (source.TryGetValue("rotation", out value) && value is int && ((int)value == 0 || (int)value == 90 || (int)value == 180 || (int)value == 270)) safe["rotation"] = value;
            if (source.TryGetValue("configured", out value) && value is bool) safe["configured"] = value;
            if (source.TryGetValue("generation", out value) && value is int && (int)value >= 0) safe["generation"] = value;
            foreach (var phase in new[] { "idle", "connecting", "streaming", "retrying", "failed" }) if (TextValue(source, "phase") == phase) safe["phase"] = phase;
            foreach (var error in new[] { "auth_failed", "runtime_missing", "stale_frames", "unavailable", "invalid_pipe" }) if (TextValue(source, "errorCode") == error) safe["errorCode"] = error;
            output[role] = safe;
        }
        return output;
    }
    private void OpenCameraSettings(string role) {
        if (cameraSettingsOpen || busy || closing || !CameraInputs.Role(role)) return;
        Dictionary<string, object> initial; cameraInputs.TryGetValue(role, out initial);
        cameraSettingsOpen = true;
        try {
            using (var dialog = new CameraInputDialog(role, initial, async source => {
                if (closing || busy) throw new InvalidOperationException();
                CameraInputs.Validate(source);
                // Persist only after the local operator accepts the source. When no
                // operator is running, save for the next checked program startup.
                if (local != null && runningGame != null) ApplyState(await Command(new { action = "configure-camera-input", cameraRole = role, source = source }));
                var next = new Dictionary<string, Dictionary<string, object>>(cameraInputs); next[role] = source;
                CameraInputs.Save(LifecycleDirectory, next); cameraInputs = next;
                return CameraInputStatus(role);
            }, () => CameraInputStatus(role))) dialog.ShowDialog(this);
        } finally { cameraSettingsOpen = false; }
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
        // Drain the captured snapshot, not just 100ms per timer tick. Windows
        // timers can run late; a fixed cap otherwise grows backlog until a drop.
        lock (usbLock) { samples = usbSamples.ToArray(); usbSamples.Clear(); }
        try {
            for (int offset = 0; offset < samples.Length; offset += 4800) {
                if (usbGame == null || closing) break;
                var count = Math.Min(4800, samples.Length - offset);
                var bytes = new byte[count * 4]; Buffer.BlockCopy(samples, offset * 4, bytes, 0, bytes.Length);
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
        if (!child.HasExited) {
            try { child.StandardInput.WriteLine("close"); child.StandardInput.Flush(); }
            catch { if (!child.HasExited) throw; }
        }
        if (await Task.WhenAny(exited.Task, Task.Delay(120000)) != exited.Task || !child.HasExited) throw new InvalidDataException();
        if (!(await exited.Task) && !(startupFailed && !controllerReady)) {
            // A dead process cannot keep sending video. Retain the uncertain
            // cleanup evidence without trapping the user in a dead workspace.
            try {
                Directory.CreateDirectory(LifecycleDirectory);
                File.WriteAllText(Path.Combine(LifecycleDirectory, "recording-warning.json"), json.Serialize(new { timestampUtc = DateTime.UtcNow.ToString("o"), message = "Previous Studio cleanup was not confirmed. Check any saved recording before using it." }));
            } catch { }
        }
        if (local != null) local.Dispose(); local = null; child.Dispose(); child = null; runningGame = null; localAddress = null; recording = false;
    }
    private void OpenRecordings() {
        try { var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio", "Recordings"); Directory.CreateDirectory(folder); Process.Start(new ProcessStartInfo(WorkspacePolicy.ExistingDirectory(folder)) { UseShellExecute = true }); }
        catch { status.Text = "Could not open the recordings folder."; }
    }
    private sealed class WorkspaceFailure : Exception {
        internal readonly string Code;
        internal WorkspaceFailure(string message, string code = null) : base(message) { Code = code; }
    }
}
