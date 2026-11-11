using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
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
    private const int ControllerCloseDeadlineMs = 35000;
    private const int MaxCoachClipBytes = 40 * 1024 * 1024;
    private readonly WebView2 web = new WebView2();
    private readonly Label status = new Label();
    private readonly Button record = new Button(), finish = new Button(), devices = new Button(), gameDay = new Button();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 65536 };
    private readonly string nodeHash, controllerHash, configurationHash, root, launchGame, profileDirectory;
    private readonly System.Windows.Forms.Timer poll = new System.Windows.Forms.Timer { Interval = 2000 };
    private string origin, selectedGame, lastGame, runningGame, localAddress, handoffNonce, previewMapping;
    private string sessionTitle;
    private string pendingNavigation, pendingNavigationNonce, pendingNavigationGame, permittedNavigation;
    private string leaveDashboardGame;
    private DateTime leaveDashboardUntil;
    private Process child;
    private HttpClient local;
    private TaskCompletionSource<string> ready;
    private TaskCompletionSource<bool> exited;
    private TaskCompletionSource<Dictionary<string, object>> handoff;
    private Task controllerClose = Task.FromResult(true);
    private TaskCompletionSource<bool> closePrompt;
    private bool busy, polling, closing, mayClose, recording, controllerReady, startupFailed, forceClosing;
    private Dictionary<string, object> lastState;
    private Dictionary<string, Dictionary<string, object>> cameraInputs = new Dictionary<string, Dictionary<string, object>>();
    private readonly Dictionary<string, Dictionary<string, object>> appliedCameraSources = new Dictionary<string, Dictionary<string, object>>();
    private CameraInputPanel cameraSettings;
    private bool cameraPreferencesUnavailable;
    private int cameraZoomRevision;
    private int stateRevision;
    private int coachPageRevision;
    private Guid? coachClipId;
    private bool coachCapturePending, coachDownloadPending;
    private string workspaceCloseGame, workspaceCloseNonce;
    private bool gameEnded, finishingCompletedGame;
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
        poll.Tick += async (s, e) => { UpdateSleepPrevention(); await Poll(); };
        FormClosed += (s, e) => SetThreadExecutionState(0x80000000);
        FormClosing += (s, e) => {
            if (mayClose) return;
            e.Cancel = true;
            // Leave the window-close callback before showing a prompt or disposing WebView2.
            BeginInvoke((Action)(async () => {
                if (closing) await ConfirmForceClose();
                else await CloseWorkspace(true);
            }));
        };
        UpdateButtons();
    }
    protected override bool ProcessCmdKey(ref Message message, Keys keyData) {
        if (cameraSettings != null && keyData == Keys.Escape) {
            if (!cameraSettings.Saving) CloseCameraSettings();
            return true;
        }
        if (keyData == (Keys.Control | Keys.Shift | Keys.Q)) {
            BeginInvoke((Action)(async () => await ConfirmForceClose()));
            return true;
        }
        if (keyData == (Keys.Control | Keys.R)) { ReloadWorkspace(); return true; }
        return base.ProcessCmdKey(ref message, keyData);
    }
    private void ReloadWorkspace() {
        if (busy || closing || cameraSettings != null || web.CoreWebView2 == null) return;
        web.CoreWebView2.Reload();
    }
    private Button MakeButton(string text) { var b = new Button { Text = text }; Style(b); return b; }
    private void Style(Button b) { b.UseMnemonic = false; b.AutoSize = true; b.Height = 44; b.MinimumSize = new Size(80, 44); b.Padding = new Padding(14, 0, 14, 0); b.Margin = new Padding(0, 0, 10, 0); b.ForeColor = Color.FromArgb(220, 230, 238); b.BackColor = Color.FromArgb(21, 38, 54); b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderColor = Color.FromArgb(52, 73, 91); b.FlatAppearance.MouseOverBackColor = Color.FromArgb(39, 69, 83); b.Cursor = Cursors.Hand; }
    private void Nav(FlowLayoutPanel panel, string label, string path) { var b = MakeButton(label); b.Click += (s, e) => Navigate(path); panel.Controls.Add(b); }
    private void Navigate(string path) { if (!busy && !closing && origin != null && web.CoreWebView2 != null) web.CoreWebView2.Navigate(origin + path); }
    private TableLayoutPanel bottom;
    private string LifecycleDirectory { get { return profileDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio"); } }
    private string CameraPreferenceDirectory { get { return profileDirectory ?? CameraInputs.ProfileDirectory(); } }
    private string LegacyCameraDirectory { get { return profileDirectory == null ? LifecycleDirectory : null; } }
    private void ReadCameraPreferences() {
        try {
            cameraInputs = CameraInputs.LoadProfile(CameraPreferenceDirectory, LegacyCameraDirectory);
            cameraPreferencesUnavailable = false;
        } catch { cameraPreferencesUnavailable = true; }
    }
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
    private void RememberOpenGame() {
        var game = runningGame ?? selectedGame ?? lastGame;
        if (game != null && !gameEnded) RememberGame(game);
    }
    private bool ConfirmClose(string message, string title, MessageBoxIcon icon, bool force) {
        if (closePrompt != null) return false;
        var prompt = closePrompt = new TaskCompletionSource<bool>();
        try {
            var agreed = MessageBox.Show(this, message, title, MessageBoxButtons.YesNo, icon, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
            if (agreed && force) forceClosing = true;
            return agreed;
        } finally {
            closePrompt = null;
            prompt.TrySetResult(true);
        }
    }
    private async Task CloseWorkspace(bool confirm, string game = null, string nonce = null) {
        if (mayClose || IsDisposed) return;
        if (closing || closePrompt != null) {
            await PublishWorkspaceCloseResult(game, nonce, false, "Studio is already closing. Use Force close Studio if it is stuck.");
            return;
        }
        var previewOnly = !busy && CanClosePreview();
        if (confirm && !previewOnly && !ConfirmClose(
            "Close Studio and keep this game? Studio will stop video and try to save the recording.",
            "Close Studio", MessageBoxIcon.Question, false)) return;
        workspaceCloseGame = game; workspaceCloseNonce = nonce;
        RememberOpenGame();
        status.Text = previewOnly ? "Closing camera preview…" : "Stopping output and saving the recording…";
        closing = true; UpdateButtons();
        if (handoff != null) handoff.TrySetException(new InvalidOperationException());
        var confirmed = false;
        try {
            var cleanup = CloseControllerWithin(previewOnly);
            if (await Task.WhenAny(cleanup, Task.Delay(ControllerCloseDeadlineMs)) == cleanup) {
                await cleanup;
                confirmed = child == null;
            }
        } catch { /* Recovery below is independent of the website and presentation. */ }
        var forcePrompt = closePrompt;
        if (forcePrompt != null) await forcePrompt.Task;
        if (forceClosing || mayClose) return;
        if (confirmed) { await FinishWorkspaceClose(); return; }
        if (forcePrompt == null) await ConfirmForceClose(true);
        if (forceClosing || mayClose) return;
        closing = false;
        workspaceCloseGame = workspaceCloseNonce = null;
        var error = "Shutdown was not confirmed. Retry closing Studio or choose Force close Studio.";
        status.Text = error; UpdateButtons();
        await PublishWorkspaceCloseResult(game, nonce, false, error);
    }
    private async Task PublishWorkspaceCloseResult(string game, string nonce, bool ok, string error) {
        if (game == null || nonce == null || IsDisposed) return;
        try {
            var core = web.CoreWebView2;
            if (core == null || WorkspacePolicy.Game(core.Source, origin) != game) return;
            var receipt = core.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-close-workspace-result',{detail:" +
                json.Serialize(new { gameId = game, nonce = nonce, ok = ok, error = error }) + "}));");
            if (await Task.WhenAny(receipt, Task.Delay(750)) == receipt) await receipt;
        } catch { /* A hung or missing renderer must not block native exit. */ }
    }
    private async Task FinishWorkspaceClose() {
        if (mayClose) return;
        mayClose = true; poll.Stop(); usbTimer.Stop();
        await PublishWorkspaceCloseResult(workspaceCloseGame, workspaceCloseNonce, true, null);
        if (IsDisposed) return;
        try { web.Dispose(); } catch { }
        Close();
    }
    private void RecordCleanupWarning(string message) {
        try {
            Directory.CreateDirectory(LifecycleDirectory);
            File.WriteAllText(Path.Combine(LifecycleDirectory, "recording-warning.json"), json.Serialize(new { timestampUtc = DateTime.UtcNow.ToString("o"), message = message }));
        } catch { }
    }
    private async Task ConfirmForceClose(bool cleanupTimedOut = false) {
        if (forceClosing || mayClose || closePrompt != null || IsDisposed) return;
        var message = (cleanupTimedOut ? "Studio could not confirm shutdown. " : "Force close Studio now? ") +
            "Your game is kept, but the recording may be interrupted.";
        if (!ConfirmClose(message, "Force close Studio", MessageBoxIcon.Warning, true)) return;
        closing = true; poll.Stop(); usbTimer.Stop();
        RememberOpenGame();
        status.Text = "Force closing Studio…"; UpdateButtons();
        RecordCleanupWarning("Studio was force closed. Check any unfinished recording and YouTube shutdown before reusing this broadcast.");
        // Only stop the controller started by this workspace. Its native children
        // have parent-death and authority watchdogs; no server receipt is fabricated.
        var owned = child;
        try { if (local != null) local.CancelPendingRequests(); } catch { }
        if (handoff != null) handoff.TrySetException(new InvalidOperationException());
        usbGame = null;
        var audio = Task.Run(() => { try { usbAudio.Stop(); } catch { } });
        await Task.WhenAll(WorkspacePolicy.ForceStopController(owned), Task.WhenAny(audio, Task.Delay(5000)));
        await FinishWorkspaceClose();
    }
    private async Task LeaveGame(string game, string nonce, bool previewOnly) {
        var ok = false;
        var error = "Studio couldn’t confirm the broadcast status. Stay here and try again.";
        if (!busy && !closing && !gameEnded && selectedGame == game && (runningGame == null || runningGame == game)) {
            busy = true; UpdateButtons();
            var deadline = Stopwatch.StartNew();
            try {
                // Recheck the owned sender, not a cached observation from before
                // Stop broadcast. Unknown or active output must never be abandoned.
                if (previewOnly && !CanClosePreview() && local != null && child != null && !child.HasExited)
                    ApplyState(await ReadYouTubeControllerState());
                if (closing || gameEnded || selectedGame != game || (runningGame != null && runningGame != game))
                    throw new InvalidOperationException();
                var fastPreview = CanClosePreview();
                var streaming = TextValue(lastState, "streaming");
                var localOutput = LocalOutputState();
                var closeWithoutPause = fastPreview || (previewOnly && WorkspacePolicy.ConfirmedInactiveOutput(streaming, localOutput));
                error = fastPreview ? "Studio couldn’t close the camera preview. Try closing the game again."
                    : closeWithoutPause ? "Studio couldn’t finish saving the recording. Try closing the game again."
                    : "Studio couldn’t confirm the pause screen. Stay here and try again.";
                if (previewOnly && !closeWithoutPause) {
                    error = "The broadcast state changed. Open Close Game again to leave or end it.";
                    throw new InvalidOperationException();
                }
                RememberGame(game);
                if (closeWithoutPause) {
                    // A sender that has stopped may still have a recording to finalize.
                    var cleanup = CloseControllerWithin(fastPreview);
                    if (await Task.WhenAny(cleanup, Task.Delay(Math.Max(1, ControllerCloseDeadlineMs - (int)deadline.ElapsedMilliseconds))) == cleanup) {
                        await cleanup;
                        ok = child == null && !recording;
                    }
                } else if (recording && runningGame == game && streaming == "armed" &&
                    localOutput == "active" && StateFlag("canHoldStream")) {
                    // Pause the picture while the sender, recording, and game stay open.
                    ok = await HoldBroadcast() && !closing && !gameEnded && runningGame == game && selectedGame == game;
                    if (ok) {
                        pendingNavigation = pendingNavigationNonce = pendingNavigationGame = null;
                        leaveDashboardGame = game; leaveDashboardUntil = DateTime.UtcNow.AddSeconds(5);
                    }
                } else {
                    error = "The broadcast state is changing. Wait a moment and try again.";
                }
            } catch { status.Text = error; }
            finally { busy = false; UpdateButtons(); }
        }
        if (!mayClose && web.CoreWebView2 != null && WorkspacePolicy.Game(web.CoreWebView2.Source, origin) == game) {
            PublishSessionStatus();
            await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-game-leave-result',{detail:" + json.Serialize(new { gameId = game, nonce = nonce, ok = ok, error = ok ? null : error }) + "}));");
        }
    }
    private void UpdateButtons() {
        bottom.Visible = closing || (!recording && (selectedGame != null || origin == null));
        gameDay.Enabled = !busy && !closing && (recording ? runningGame : lastGame) != null;
        record.Visible = !recording; finish.Visible = recording;
        record.Enabled = !busy && !closing && !gameEnded && !finishingCompletedGame && selectedGame != null && !recording && origin != null;
        finish.Enabled = !busy && !closing && recording;
        devices.Enabled = !busy && !closing && selectedGame != null;
        try { PublishSessionStatus(); }
        catch { if (!closing && !mayClose) throw; }
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
            ReadCameraPreferences();
            if (!WorkspacePolicy.SameOrigin(origin, origin) || new Uri(origin).AbsoluteUri != origin + "/") throw new InvalidDataException();
            var profile = profileDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio", "WorkspaceProfile");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            // WinForms WebView2 forwards accelerator keys through KeyDown when
            // its renderer has focus; ProcessCmdKey covers native controls.
            web.KeyDown += (s, e) => {
                if (e.KeyData == (Keys.Control | Keys.Shift | Keys.Q)) {
                    e.Handled = true; e.SuppressKeyPress = true;
                    BeginInvoke((Action)(async () => await ConfirmForceClose()));
                } else if (e.KeyData == (Keys.Control | Keys.R)) {
                    e.Handled = true; e.SuppressKeyPress = true;
                    BeginInvoke((Action)ReloadWorkspace);
                }
            };
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.UserAgent += " CurlStreamerStudio/0.3";
            core.Settings.UserAgent += " StudioProgramPreview/1";
            core.Settings.UserAgent += " StudioNativeAudio/1 StudioReplay/1";
            core.AddWebResourceRequestedFilter(origin + "/__studio-replay/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += ReplayResource;
            core.AddWebResourceRequestedFilter(origin + "/__studio-coach-clip/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += CoachClipResource;
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
                var completedGameExit = gameEnded && e.Uri == origin + "/dashboard" && selectedGame != null &&
                    WorkspacePolicy.Game(core.Source, origin) == selectedGame && (runningGame == null || runningGame == selectedGame);
                if (closing || (busy && !completedGameExit)) { e.Cancel = true; return; }
                if (WorkspacePolicy.YouTubeAccountConnection(e.Uri, origin)) {
                    e.Cancel = true;
                    // Start a fresh browser session; never transfer Studio cookies or OAuth state.
                    try {
                        Process.Start(new ProcessStartInfo(origin + "/account?section=youtube") { UseShellExecute = true });
                        status.Text = "YouTube Settings opened in your browser. Sign in if needed, reconnect the existing channel, then return to Studio.";
                    } catch { status.Text = "Open " + origin + "/account?section=youtube in your browser to reconnect YouTube."; }
                    return;
                }
                if (!WorkspacePolicy.SameOrigin(e.Uri, origin)) { e.Cancel = true; status.Text = "Use the website in your browser for external account connections."; return; }
                var leaveApproved = leaveDashboardGame != null && e.Uri == origin + "/dashboard" && leaveDashboardUntil > DateTime.UtcNow &&
                    runningGame == leaveDashboardGame && WorkspacePolicy.Game(core.Source, origin) == leaveDashboardGame;
                leaveDashboardGame = null;
                if (permittedNavigation == e.Uri) permittedNavigation = null;
                else if (!leaveApproved && recording && runningGame != null && NavigationNeedsReview() && WorkspacePolicy.Game(core.Source, origin) == runningGame &&
                    WorkspacePolicy.Game(e.Uri, origin) != runningGame && e.Uri != core.Source) {
                    e.Cancel = true;
                    if (pendingNavigation != null) return;
                    pendingNavigation = e.Uri; pendingNavigationGame = runningGame; pendingNavigationNonce = Guid.NewGuid().ToString("D");
                    core.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-navigation-request',{detail:" + json.Serialize(new { gameId = runningGame, nonce = pendingNavigationNonce, href = pendingNavigation }) + "}));");
                    return;
                }
                CloseCameraSettings();
                coachPageRevision++; coachClipId = null;
                selectedGame = null; UpdateButtons();
            };
            core.SourceChanged += (s, e) => {
                coachPageRevision++; coachClipId = null;
                pendingNavigation = pendingNavigationNonce = pendingNavigationGame = null;
                var nextGame = WorkspacePolicy.Game(core.Source, origin);
                if (nextGame != selectedGame) CloseCameraSettings();
                if (runningGame == null && nextGame != null && nextGame != selectedGame) gameEnded = false;
                selectedGame = nextGame;
                if (selectedGame != null && (runningGame == null || selectedGame == runningGame) && !gameEnded) { lastGame = selectedGame; RememberGame(selectedGame); }
                UpdateButtons();
            };
            core.NavigationCompleted += (s, e) => {
                selectedGame = WorkspacePolicy.Game(core.Source, origin);
                if (!e.IsSuccess && !recording) status.Text = "The workspace could not load. Check your internet connection and press Ctrl+R to reload.";
                else if (!recording && !busy) status.Text = selectedGame == null ? "Choose a game from your schedule to get started." : "Preparing this game’s camera controls.";
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
        try {
            if (mayClose || web.CoreWebView2 == null || !WorkspacePolicy.SessionMessage(args.Source, web.CoreWebView2.Source, origin)) return;
            var raw = args.WebMessageAsJson;
            if (raw.Length > 8192) return;
            var value = json.Deserialize<Dictionary<string, object>>(raw);
            var source = args.Source;
            if (WorkspacePolicy.ForceCloseRequest(value, selectedGame, runningGame) && WorkspacePolicy.Game(source, origin) == selectedGame) {
                BeginInvoke((Action)(async () => {
                    if (IsCurrentWorkspacePage(source) &&
                        WorkspacePolicy.ForceCloseRequest(value, selectedGame, runningGame)) await ConfirmForceClose();
                }));
                return;
            }
            string closeNonce;
            if (WorkspacePolicy.CloseWorkspaceRequest(value, selectedGame, runningGame, out closeNonce) && WorkspacePolicy.Game(source, origin) == selectedGame) {
                var game = selectedGame;
                BeginInvoke((Action)(async () => {
                    if (IsCurrentWorkspacePage(source) &&
                        selectedGame == game && (runningGame == null || runningGame == game)) await CloseWorkspace(false, game, closeNonce);
                }));
                return;
            }
            if (closing) return;
            if (TextValue(value, "type") == "studio-coach-capture") {
                Guid nonce;
                if (value.Count == 3 && Guid.TryParseExact(TextValue(value, "nonce"), "D", out nonce) &&
                    CoachGamePage(source, TextValue(value, "gameId")))
                    await CaptureCoachClip(source, nonce.ToString());
                return;
            }
            if (TextValue(value, "type") == "studio-coach-review") {
                var action = TextValue(value, "action"); Guid nonce;
                if (selectedGame == null || selectedGame != runningGame || TextValue(value, "gameId") != runningGame ||
                    WorkspacePolicy.Game(args.Source, origin) != runningGame || !Guid.TryParseExact(TextValue(value, "nonce"), "D", out nonce) ||
                    busy || closing || !recording || (action != "start" && action != "stop") ||
                    (action == "start" ? value.Count != 5 || !CameraInputs.PrivateIPv4(TextValue(value,"host")) : value.Count != 4)) return;
                var game = runningGame; var ok = false; busy = true; PublishSessionStatus();
                try { ApplyState(await Command(action == "start" ? (object)new {action="start-coach-review",host=TextValue(value,"host")} : new {action="stop-coach-review"})); ok = true; }
                catch { } finally {busy = false; PublishSessionStatus();}
                if (WorkspacePolicy.Game(web.CoreWebView2.Source, origin) == game)
                    await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-coach-review-result',{detail:" + json.Serialize(new {gameId=game, nonce=nonce.ToString(), ok=ok}) + "}));");
                return;
            }
            if (TextValue(value, "type") == "studio-replay") {
                var action = TextValue(value, "action"); Guid nonce, clip;
                if (selectedGame == null || selectedGame != runningGame || TextValue(value, "gameId") != runningGame ||
                    WorkspacePolicy.Game(args.Source, origin) != runningGame || !Guid.TryParseExact(TextValue(value, "nonce"), "D", out nonce) ||
                    busy || closing || !recording || (action != "capture" && action != "play" && action != "cancel")) return;
                object startValue; double start = -1;
                if (action == "play" && (value.Count != 6 || !Guid.TryParseExact(TextValue(value, "clipId"), "D", out clip) ||
                    !value.TryGetValue("startMs", out startValue) || !(startValue is int || startValue is long || startValue is decimal || startValue is double) ||
                    (start = Convert.ToDouble(startValue)) < 0 || start > 90000 || start != Math.Truncate(start))) return;
                if (action != "play" && value.Count != 4) return;
                var game = runningGame; var ok = false;
                busy = true; PublishSessionStatus();
                try {
                    ApplyState(await Command(action == "play" ? (object)new { action = "play-replay", clipId = TextValue(value, "clipId"), startMs = (int)start } : new { action = action == "capture" ? "capture-replay" : "cancel-replay" }));
                    ok = true;
                } catch { }
                finally { busy = false; PublishSessionStatus(); }
                if (WorkspacePolicy.Game(web.CoreWebView2.Source, origin) == game)
                    await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-replay-result',{detail:" + json.Serialize(new { gameId = game, nonce = nonce.ToString(), ok = ok }) + "}));");
                return;
            }
            if (value.Count == 1 && TextValue(value, "type") == "studio-session-observe") { PublishSessionStatus(); return; }
            if (TextValue(value, "type") == "studio-game-leave" &&
                WorkspacePolicy.Game(args.Source, origin) == selectedGame && TextValue(value, "gameId") == selectedGame &&
                selectedGame != null && (runningGame == null || runningGame == selectedGame)) {
                Guid leaveNonce; object preview;
                var previewOnly = value.Count == 4 && value.TryGetValue("previewOnly", out preview) && Object.Equals(preview, true);
                if ((!previewOnly && value.Count != 3) || !Guid.TryParseExact(TextValue(value, "nonce"), "D", out leaveNonce)) return;
                await LeaveGame(selectedGame, leaveNonce.ToString(), previewOnly); return;
            }
            if (TextValue(value, "type") == "studio-navigation-resolve") { await ResolveNavigation(value); return; }
            if (value.Count == 3 && TextValue(value, "type") == "studio-session-stop" &&
                selectedGame != null && TextValue(value, "gameId") == runningGame && runningGame != null) {
                Guid stopNonce; var nonce = TextValue(value, "nonce");
                if (!Guid.TryParseExact(nonce, "D", out stopNonce)) return;
                var game = runningGame; var ok = false;
                if (!busy && !closing && !OutputActive()) {
                    if (recording) await StopRecording();
                    else { busy = true; UpdateButtons(); try { await CloseController(); } catch { } finally { busy = false; UpdateButtons(); } }
                    ok = runningGame == null;
                }
                if (WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin)) await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-session-stop-result',{detail:" + json.Serialize(new { gameId = game, nonce = nonce, ok = ok, error = ok ? null : "Stop YouTube output from the current game before switching Studio." }) + "}));");
                return;
            }
            if (TextValue(value, "action") == "zoom-camera") { await CameraZoomCommand(value); return; }
            var presentationType = TextValue(value, "type");
            if (presentationType == "studio-youtube-hold" || presentationType == "studio-youtube-resume" || presentationType == "studio-youtube-restart" || presentationType == "studio-ending-prepare" || presentationType == "studio-ending-show" || presentationType == "studio-ending-cancel" || presentationType == "studio-ending-finish") {
                if (!WorkspacePolicy.SessionPresentation(value, selectedGame, runningGame)) return;
                var requestNonce = TextValue(value, "nonce");
                if (busy || closing || !recording) {
                    await PublishPresentationResult(runningGame, requestNonce, false, null, null, "Studio is changing the broadcast connection. Check its status before trying again.");
                    return;
                }
                if (presentationType == "studio-youtube-restart") {
                    if (WorkspacePolicy.Game(args.Source, origin) != runningGame) return;
                    var game = runningGame;
                    var restarted = await YouTube(true, true);
                    await PublishPresentationResult(game, requestNonce, restarted, null, null,
                        restarted ? null : (String.IsNullOrEmpty(youtubeError) ? "Studio could not restart this broadcast connection." : youtubeError));
                    return;
                }
                await PresentationCommand(presentationType, requestNonce, value); return;
            }
            if (WorkspacePolicy.Game(args.Source, origin) != selectedGame) return;
            if (value.Count == 3 && TextValue(value, "type") == "studio-session-title" && selectedGame != null &&
                TextValue(value, "gameId") == selectedGame && WorkspacePolicy.CanStartSession(runningGame, selectedGame)) {
                var title = TextValue(value, "title");
                if (title != null && title.Length <= 200 && !System.Text.RegularExpressions.Regex.IsMatch(title, @"[\x00-\x1f\x7f]")) { sessionTitle = title; PublishSessionStatus(); }
                return;
            }
            if (TextValue(value, "action") == "connect-camera" || TextValue(value, "action") == "disconnect-camera") {
                await CameraConnectionCommand(value); return;
            }
            if (value.Count == 3 && TextValue(value, "gameId") == selectedGame && !busy && !closing &&
                WorkspacePolicy.CanConfigureSession(selectedGame, runningGame) && CameraInputs.Role(TextValue(value, "cameraRole"))) {
                if (TextValue(value, "action") == "configure-camera") { OpenCameraSettings(TextValue(value, "cameraRole")); return; }
                if (recording && selectedGame == runningGame && TextValue(value, "action") == "reconnect-camera") { ApplyState(await Command(new { action = "reconnect-camera-input", cameraRole = TextValue(value, "cameraRole") })); return; }
            }
            if (TextValue(value, "type") != null && TextValue(value, "type").StartsWith("studio-usb-")) {
                await UsbCommand(value); return;
            }
            if ((value.Count == 2 || (value.Count == 3 && TextValue(value, "type") == "studio-game-ready" && value.ContainsKey("title"))) && TextValue(value, "gameId") == selectedGame && selectedGame != null && !closing) {
                var type = TextValue(value, "type");
                if (type == "studio-game-ended") {
                    var path = new Uri(source).AbsolutePath;
                    if ((path != "/score/" + selectedGame && path != "/games/" + selectedGame) ||
                        (runningGame != null && runningGame != selectedGame)) return;
                    gameEnded = true; coachClipId = null; ForgetGame(); lastGame = null;
                    try {
                        var ignored = web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-game-ended-ack',{detail:" +
                            json.Serialize(new { gameId = selectedGame }) + "}));");
                    } catch { /* A page that has already left must not block local cleanup. */ }
                    await FinishCompletedGame();
                    return;
                }
                if (busy) return;
                if (type == "studio-youtube-start" || type == "studio-youtube-stop") { await YouTube(type == "studio-youtube-start"); return; }
                if (type == "studio-game-ready") {
                    PublishSavedCameraInputs();
                    if (!WorkspacePolicy.CanStartSession(runningGame, selectedGame)) { PublishSessionStatus(); return; }
                    if (finishingCompletedGame || (runningGame != null && gameEnded)) { PublishSessionStatus(); return; }
                    if (runningGame == null) gameEnded = false;
                    var title = TextValue(value, "title");
                    if (title != null && title.Length <= 200 && !System.Text.RegularExpressions.Regex.IsMatch(title, @"[\x00-\x1f\x7f]")) sessionTitle = title;
                    await StartRecording(); return;
                }
            }
            if (handoff == null || handoff.Task.IsCompleted) return;
            if (value.Count != 3 || !value.ContainsKey("nonce") || !value.ContainsKey("status") || !value.ContainsKey("sourceUrl") ||
                (string)value["nonce"] != handoffNonce) return;
            handoff.TrySetResult(value);
        } catch { /* Web messages never become arbitrary native commands. */ }
    }
    private bool IsCurrentWorkspacePage(string source) {
        if (mayClose || IsDisposed) return false;
        try { return web.CoreWebView2 != null && WorkspacePolicy.SessionMessage(source, web.CoreWebView2.Source, origin); }
        catch { return false; }
    }
    private bool StateFlag(string key) {
        object value; return lastState != null && lastState.TryGetValue(key, out value) && value is bool && (bool)value;
    }
    private bool OutputActive() {
        var streaming = TextValue(lastState, "streaming");
        return LocalOutputState() == "active" || TextValue(lastState, "broadcast") == "live" ||
            (streaming != null && streaming != "idle" && streaming != "stopped" && streaming != "failed");
    }
    private string LocalOutputState() {
        object output; var localOutput = lastState != null && lastState.TryGetValue("localOutput", out output) ? output as Dictionary<string, object> : null;
        return TextValue(localOutput, "state");
    }
    private bool CanClosePreview() {
        var localOutputState = LocalOutputState();
        return WorkspacePolicy.CanClosePreview(child != null && !child.HasExited, TextValue(lastState, "streaming"),
            TextValue(lastState, "pairing"), localOutputState == "active" || localOutputState == "connecting");
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SetThreadExecutionState(uint flags);
    private void UpdateSleepPrevention() {
        // Called only on the WinForms UI thread: execution requests belong to
        // the calling thread. No power-plan or screen-lock settings are changed.
        // Keep the display awake too, avoiding capture/render suspension on idle.
        var active = child != null && !child.HasExited && WorkspacePolicy.KeepAwake(TextValue(lastState, "streaming"));
        SetThreadExecutionState(active ? 0x80000003u : 0x80000000u);
    }
    private bool NavigationNeedsReview() {
        return !gameEnded && (LocalOutputState() == "active" || TextValue(lastState, "broadcast") == "live" || TextValue(lastState, "streaming") == "starting");
    }
    private async Task<bool> HoldBroadcast() {
        var result = await Command(new { action = "hold-stream" }, 12000);
        ApplyState(result);
        object mode; var presentation = result.TryGetValue("presentation", out mode) ? mode as Dictionary<string, object> : null;
        return presentation != null && TextValue(presentation, "mode") == "hold";
    }
    private async Task ResolveNavigation(Dictionary<string, object> value) {
        if (value.Count != 4 || pendingNavigation == null || closing || runningGame != pendingNavigationGame ||
            TextValue(value, "gameId") != pendingNavigationGame || TextValue(value, "nonce") != pendingNavigationNonce) return;
        var decision = TextValue(value, "decision");
        if (decision != "continue" && decision != "pause" && decision != "stay") return;
        var nonce = pendingNavigationNonce; var game = pendingNavigationGame; var destination = pendingNavigation;
        if (decision == "stay") {
            pendingNavigation = pendingNavigationNonce = pendingNavigationGame = null;
            await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-navigation-result',{detail:" + json.Serialize(new { gameId = game, nonce = nonce, ok = true }) + "}));");
            return;
        }
        if (busy) return;
        var ok = true;
        if (decision == "pause") {
            if (!recording || !StateFlag("canHoldStream")) ok = false;
            else {
                busy = true; UpdateButtons();
                try { ok = await HoldBroadcast(); }
                catch { ok = false; }
                finally { busy = false; UpdateButtons(); }
            }
        }
        // Stay, another navigation, or session cleanup invalidates a hold that
        // finishes late. It can change presentation, but cannot move the page.
        if (pendingNavigationNonce != nonce || pendingNavigationGame != game || runningGame != game) return;
        if (web.CoreWebView2 == null || !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin)) return;
        await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-navigation-result',{detail:" + json.Serialize(new { gameId = game, nonce = nonce, ok = ok, error = ok ? null : "Studio could not confirm the paused picture. Stay here and try again." }) + "}));");
        if (!ok || pendingNavigationNonce != nonce || pendingNavigationGame != game || runningGame != game) return;
        pendingNavigation = pendingNavigationNonce = pendingNavigationGame = null;
        if (decision != "stay" && runningGame == game) { permittedNavigation = destination; web.CoreWebView2.Navigate(destination); }
    }
    private async Task CameraZoomCommand(Dictionary<string, object> request) {
        string role, nonce; int generation; double zoom;
        if (!WorkspacePolicy.CameraZoomRequest(request, selectedGame, runningGame, out role, out generation, out zoom, out nonce)) return;
        var gameId = runningGame; var ok = false; var commanded = false; object inputs;
        try {
            if (busy || closing || !recording || local == null || lastState == null ||
                !lastState.TryGetValue("cameraInputs", out inputs) || !WorkspacePolicy.CameraZoomSource(inputs, role, generation))
                throw new InvalidOperationException();
            cameraZoomRevision++; commanded = true;
            var result = await Command(new { action = "set-camera-zoom", cameraRole = role, generation = generation, value = zoom });
            // An old response cannot restore a source after Settings replaces it.
            if (selectedGame != gameId || runningGame != gameId || closing ||
                lastState == null || !lastState.TryGetValue("cameraInputs", out inputs) || !WorkspacePolicy.CameraZoomSource(inputs, role, generation) ||
                !result.TryGetValue("cameraInputs", out inputs) || !WorkspacePolicy.CameraZoomSource(inputs, role, generation))
                throw new InvalidOperationException();
            var update = new Dictionary<string, object>(lastState);
            update["cameraInputs"] = WorkspacePolicy.MergeCameraZoomInputs(lastState["cameraInputs"], result["cameraInputs"], role, generation);
            ApplyState(update); ok = true;
        } catch { /* Return a fixed message; no local camera details or credentials. */ }
        finally { if (commanded) cameraZoomRevision++; }
        if (closing || web.CoreWebView2 == null || !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) ||
            WorkspacePolicy.Game(web.CoreWebView2.Source, origin) != gameId) return;
        var reply = new Dictionary<string, object> { { "gameId", gameId }, { "cameraRole", role }, { "generation", generation }, { "nonce", nonce }, { "ok", ok } };
        if (ok) reply["value"] = zoom;
        else reply["error"] = "Studio could not change the camera zoom. Wait for the camera to reconnect, then try again.";
        await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-camera-zoom-result',{detail:" + json.Serialize(reply) + "}));");
    }
    private async Task CameraConnectionCommand(Dictionary<string, object> request) {
        var role = TextValue(request, "cameraRole"); var nonce = TextValue(request, "nonce"); var game = TextValue(request, "gameId"); Guid parsed;
        if (request.Count != 4 || !CameraInputs.Role(role) || !Guid.TryParseExact(nonce, "D", out parsed) ||
            WorkspacePolicy.Game(origin + "/score/" + game, origin) != game || game == null) return;
        var ok = false; var enabled = false; var generation = 0;
        var connect = TextValue(request, "action") == "connect-camera";
        if (connect && !recording && selectedGame == game && cameraSettings == null && !cameraPreferencesUnavailable) {
            Dictionary<string, object> profile;
            if (cameraInputs.TryGetValue(role, out profile) && TextValue(profile, "kind") != "phone") await StartRecording();
        }
        if (!busy && !closing && recording && selectedGame == game && runningGame == game) {
            busy = true; UpdateButtons();
            try {
                if (connect) {
                    object currentInputs, currentSlot;
                    var currentMap = lastState != null && lastState.TryGetValue("cameraInputs", out currentInputs) ? currentInputs as Dictionary<string, object> : null;
                    var currentSource = currentMap != null && currentMap.TryGetValue(role, out currentSlot) ? currentSlot as Dictionary<string, object> : null;
                    if (currentSource == null || TextValue(currentSource, "kind") == "phone") {
                        var saved = CameraInputs.LoadProfile(CameraPreferenceDirectory, LegacyCameraDirectory);
                        Dictionary<string, object> savedSource;
                        if (saved.TryGetValue(role, out savedSource) && TextValue(savedSource, "kind") != "phone") {
                            ApplyState(await ConfigureCameraSource(role, savedSource));
                            cameraInputs = saved;
                        }
                    }
                }
                var result = await Command(new { action = connect ? "connect-camera-input" : "disconnect-camera-input", cameraRole = role });
                object inputs, slot, connection, revision;
                var map = result.TryGetValue("cameraInputs", out inputs) ? inputs as Dictionary<string, object> : null;
                var source = map != null && map.TryGetValue(role, out slot) ? slot as Dictionary<string, object> : null;
                if (runningGame != game || source == null || !source.TryGetValue("connectionEnabled", out connection) || !(connection is bool) ||
                    !source.TryGetValue("generation", out revision) || !(revision is int) || (int)revision < 0) throw new InvalidDataException();
                enabled = (bool)connection; generation = (int)revision;
                ok = enabled == connect; ApplyState(result);
            } catch { }
            finally { busy = false; UpdateButtons(); }
        }
        if (web.CoreWebView2 == null || !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin)) return;
        await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-camera-connection-result',{detail:" + json.Serialize(new {
            gameId = game, cameraRole = role, nonce = nonce, ok = ok, connectionEnabled = enabled, generation = generation,
            error = ok ? null : "Studio could not change this camera connection. Return to the active game and try again."
        }) + "}));");
    }
    private async Task PresentationCommand(string type, string nonce, Dictionary<string, object> value) {
        var gameId = runningGame; object presentation = null, closeReceipt = null; bool ok = false;
        if (type == "studio-youtube-resume" && StateFlag("programAuthorityEnded")) {
            await PublishPresentationResult(gameId, nonce, false, null, null, "The Studio video session expired. Restart the broadcast connection to use your saved YouTube link.");
            return;
        }
        if (!StateFlag(type.StartsWith("studio-ending-") ? "canGracefulEnd" : "canHoldStream")) {
            await PublishPresentationResult(gameId, nonce, false, null, null); return;
        }
        busy = true; PublishSessionStatus();
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
                result = await Command(new { action = action }, type == "studio-youtube-resume" ? 25000 : 120000);
                if (type == "studio-ending-cancel") endingUntil = DateTime.MinValue;
            }
            ApplyState(result); result.TryGetValue("presentation", out presentation); ok = true;
        } catch { if (type == "studio-ending-prepare" || type == "studio-ending-cancel") endingUntil = DateTime.MinValue; }
        finally { busy = false; PublishYouTubeStatus(lastState); UpdateButtons(); }
        await PublishPresentationResult(gameId, nonce, ok, presentation, closeReceipt,
            !ok && type == "studio-youtube-resume" ? "Studio could not restore the live picture. Retry Resume or restart the broadcast connection." : null);
    }
    private Task PublishPresentationResult(string gameId, string nonce, bool ok, object presentation, object closeReceipt, string error = null) {
        if (web.CoreWebView2 == null || !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin)) return Task.FromResult(true);
        return web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-presentation-result',{detail:" + json.Serialize(new { gameId = gameId, nonce = nonce, ok = ok, presentation = presentation, closing = closeReceipt, error = ok ? null : error ?? "Studio could not confirm this presentation change." }) + "}));");
    }
    private async Task<string> PrepareGrant(string gameId) {
        if (closing || !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) || WorkspacePolicy.Game(web.CoreWebView2.Source, origin) != gameId) throw new InvalidDataException();
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
        if (closing || gameEnded || WorkspacePolicy.Game(web.CoreWebView2.Source, origin) != gameId) throw new InvalidDataException();
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
        // A previously issued desktop lease can live for 90 seconds plus
        // the server's three-second fence after the local sender exits.
        var recoveryWait = Stopwatch.StartNew();
        for (;;) {
            try { return await WebsiteYouTube(gameId, "", new { action = "prepare" }); }
            catch (WorkspaceFailure failure) {
                if (failure.Code != "studio_recovery_pending" || recoveryWait.Elapsed.TotalSeconds >= 100) throw;
                youtubeError = "Waiting for the previous Studio connection to expire. This can take about 90 seconds. Your YouTube link is kept.";
                PublishYouTubeStatus(lastState);
            }
            await Task.Delay(5000);
        }
    }
    private async Task<bool> YouTube(bool start, bool restart = false) {
        if (busy || closing || !recording || gameEnded || selectedGame != runningGame) return false;
        var gameId = runningGame; busy = true; youtubeError = "";
        try {
            if (start) {
                var previous = await ReadYouTubeControllerState();
                object authorityEnded;
                var expired = previous.TryGetValue("programAuthorityEnded", out authorityEnded) && Object.Equals(authorityEnded, true);
                if (restart || expired || WorkspacePolicy.RestartYouTube(TextValue(previous, "pairing"), TextValue(previous, "streaming"))) {
                    if (restart && !CanRestartBroadcast(previous)) throw new WorkspaceFailure("The broadcast is ending or changing connection. Check its status before restarting.");
                    var enabledCameras = EnabledIpCameras(previous);
                    youtubeError = "Restarting local video and reconnecting to the saved YouTube link…";
                    PublishYouTubeStatus(previous);
                    await WorkspacePolicy.RecoverYouTube(
                        CloseController,
                        () => !closing && !gameEnded && selectedGame == gameId && WorkspacePolicy.Game(web.CoreWebView2.Source, origin) == gameId,
                        () => ConnectProgram(gameId));
                    foreach (var role in enabledCameras) {
                        try { ApplyState(await Command(new { action = "connect-camera-input", cameraRole = role }, 4000)); }
                        catch { /* Camera controls remain available independently of the broadcast. */ }
                    }
                    previous = lastState;
                    if (previous == null) throw new InvalidDataException();
                }
                if (TextValue(previous, "streaming") == "paused") {
                    ApplyState(await Command(new { action = "resume-stream" }));
                    return true;
                }
                if (TextValue(previous, "streaming") != "idle") throw new WorkspaceFailure("This YouTube output is already connecting. Wait for its status before reconnecting.");
                var prepared = await PrepareYouTube(gameId);
                if (prepared != "prepared") throw new WorkspaceFailure(WorkspacePolicy.YouTubeFailure(prepared));
                var state = await ReadYouTubeControllerState();
                if (TextValue(state, "pairing") == "unpaired") {
                    var challenge = TextValue(state, "challenge");
                    if (challenge == null || !System.Text.RegularExpressions.Regex.IsMatch(challenge, "^[a-f0-9]{64}$")) throw new InvalidDataException();
                    var code = await WebsiteYouTube(gameId, "/desktop-pairing", new { challenge = challenge });
                    if (code == null || !System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Za-z0-9_-]{43}$")) throw new InvalidDataException();
                    ApplyState(await Command(new { action = "pair", code = code }));
                }
                ApplyState(await Command(new { action = "start-stream", intentId = Guid.NewGuid().ToString() }));
                youtubeError = "";
            } else {
                ApplyState(await Command(new { action = "pause-stream" }));
            }
            return true;
        } catch (Exception error) {
            youtubeError = error is WorkspaceFailure ? error.Message : "Studio could not reconnect. Your game and watch link are saved. Reopen the same game and reconnect, or use Ctrl+Shift+Q if Studio is stuck.";
            return false;
        } finally { busy = false; PublishYouTubeStatus(lastState); UpdateButtons(); }
    }
    private async Task<Dictionary<string, object>> ReadYouTubeControllerState() {
        using (var timeout = new System.Threading.CancellationTokenSource(5000))
        using (var response = await local.GetAsync(localAddress + "/state", timeout.Token)) {
            response.EnsureSuccessStatusCode();
            return json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync());
        }
    }
    private bool CanRestartBroadcast(Dictionary<string, object> state) {
        object available, presentation;
        var mode = state != null && state.TryGetValue("presentation", out presentation) ? TextValue(presentation as Dictionary<string, object>, "mode") : null;
        var streaming = TextValue(state, "streaming");
        return state != null && state.TryGetValue("streamingAvailable", out available) && Object.Equals(available, true) &&
            endingUntil <= DateTime.UtcNow && !gameEnded && mode != "preparing-end" && mode != "ended" &&
            (streaming == "armed" || streaming == "paused" || streaming == "stopped" || streaming == "failed");
    }
    private List<string> EnabledIpCameras(Dictionary<string, object> state) {
        object inputs;
        var cameras = state.TryGetValue("cameraInputs", out inputs) ? inputs as Dictionary<string, object> : null;
        var roles = new List<string>();
        if (cameras == null) return roles;
        foreach (var entry in cameras) {
            var source = entry.Value as Dictionary<string, object>;
            var kind = TextValue(source, "kind");
            object enabled;
            if (CameraInputs.Role(entry.Key) && (kind == "tapo" || kind == "rtsp") &&
                source.TryGetValue("connectionEnabled", out enabled) && Object.Equals(enabled, true)) roles.Add(entry.Key);
        }
        return roles;
    }
    private async Task StartRecording() {
        if (busy || closing || gameEnded || finishingCompletedGame || recording || !WorkspacePolicy.CanStartSession(runningGame, selectedGame)) return;
        busy = true; UpdateButtons(); var gameId = selectedGame;
        try {
            await ConnectProgram(gameId);
        } catch (WorkspaceFailure e) { status.Text = e.Message; }
        catch { status.Text = "Cameras could not connect. Check your connection and Studio installation, then try again."; }
        if (!recording && child != null) { try { await CloseController(); } catch { status.Text = "Camera cleanup is pending. Keep Studio open and try disconnecting again."; } }
        busy = false; UpdateButtons();
    }
    private async Task ConnectProgram(string gameId) {
            status.Text = "Checking this PC and connecting your game…";
            if (!controllerClose.IsCompleted) await controllerClose;
            if (closing || gameEnded || finishingCompletedGame || !WorkspacePolicy.CanStartSession(runningGame, gameId)) throw new InvalidOperationException();
            ReadCameraPreferences();
            if (cameraPreferencesUnavailable) throw new WorkspaceFailure("Saved camera settings could not be read. Open Camera Settings for details.");
            if (child != null && child.HasExited) await CloseController();
            if (gameEnded || finishingCompletedGame) throw new InvalidOperationException();
            if (child == null) await StartController(gameId);
            var checkedState = await Command(new { action = "check" });
            if (TextValue(checkedState, "pc") != "ready") throw new WorkspaceFailure("This PC did not pass the recording check. Check the Studio installation.");
            foreach (var source in cameraInputs)
                await ConfigureCameraSource(source.Key, CameraInputs.ActiveSource(source.Value));
            status.Text = "Preparing your camera connection…";
            var code = await PrepareGrant(gameId);
            if (gameEnded || finishingCompletedGame) throw new InvalidOperationException();
            status.Text = "Connecting cameras…";
            ApplyState(await Command(new { action = "start-program", invitation = code }));
            if (!recording) throw new WorkspaceFailure("Cameras could not connect. Your game and camera assignments are retained. Try Connect cameras again.");
    }
    private async Task StopRecording() {
        if (busy || !recording) return;
        busy = true; UpdateButtons(); status.Text = "Disconnecting cameras…";
        try { await StopUsbAudio(); ApplyState(await Command(new { action = "stop-program" })); if (!recording) await CloseController(); }
        catch { status.Text = "Finalization was not confirmed. Keep Studio open and check the recordings folder."; }
        finally { busy = false; UpdateButtons(); }
    }
    private async Task FinishCompletedGame() {
        if (finishingCompletedGame || closing) return;
        if (child == null) { endingUntil = DateTime.MinValue; UpdateButtons(); return; }
        finishingCompletedGame = true;
        var owned = child;
        var finalCard = Stopwatch.StartNew();
        try {
            // A committed game may still have a bounded final card on air.
            while (!closing && child == owned && endingUntil > DateTime.UtcNow && finalCard.ElapsedMilliseconds < 30000)
                await Task.Delay(250);
            if (closing || child != owned) return;
            endingUntil = DateTime.MinValue;
            if (handoff != null) handoff.TrySetException(new InvalidOperationException());
            try { if (local != null) local.CancelPendingRequests(); }
            catch (ObjectDisposedException) { }
            await CloseController();
        } catch {
            status.Text = "Game saved. Studio couldn’t close the local recording. Check Saved videos.";
        } finally {
            finishingCompletedGame = false; UpdateButtons();
        }
    }
    private async Task StartController(string gameId) {
        var node = Path.Combine(root, "node", "node.exe"); var controller = Path.Combine(root, "app", "studio.mjs");
        await Task.Run(() => { Verify(node, nodeHash); Verify(controller, controllerHash); });
        if (closing || gameEnded || finishingCompletedGame || selectedGame != gameId) throw new InvalidOperationException();
        ready = new TaskCompletionSource<string>(); exited = new TaskCompletionSource<bool>(); controllerReady = false; startupFailed = false; lastState = null;
        appliedCameraSources.Clear();
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
        if (closing || gameEnded || finishingCompletedGame || child != process) throw new InvalidOperationException();
        localAddress = await processReady.Task;
        local = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer(), AllowAutoRedirect = false, UseProxy = false }) { Timeout = TimeSpan.FromSeconds(120) };
        using (var result = await local.GetAsync(localAddress)) result.EnsureSuccessStatusCode();
    }
    private async void ObserveExit(Process process, TaskCompletionSource<string> processReady, TaskCompletionSource<bool> processExited, Func<bool> confirmed) {
        try { await Task.Run(() => process.WaitForExit()); }
        catch (InvalidOperationException) {
            processReady.TrySetException(new InvalidDataException()); processExited.TrySetResult(false); return;
        }
        if (child != process) { processExited.TrySetResult(false); return; }
        var clean = confirmed() && process.ExitCode == 0;
        processReady.TrySetException(new InvalidDataException()); processExited.TrySetResult(clean);
        if (child != process) return;
        try {
            var directory = profileDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio");
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, "controller-exit.json"), json.Serialize(new { timestampUtc = DateTime.UtcNow.ToString("o"), exitCode = process.ExitCode, cleanupConfirmed = clean }));
        } catch { /* Only lifecycle facts, never child stderr or arguments. */ }
        if (!closing) {
            recording = false; previewMapping = null; lastState = null;
            youtubeError = "Studio's local video controller stopped. Close and reopen Studio before reconnecting cameras and YouTube.";
            if (local != null) local.CancelPendingRequests();
            if (handoff != null) handoff.TrySetException(new WorkspaceFailure(youtubeError));
            if (usbGame != null) {
                usbGame = null;
                lock (usbLock) usbSamples.Clear();
                var ignored = Task.Run(() => { try { usbAudio.Stop(); } catch { } });
            }
            usbError = "Studio's local video controller stopped. Reconnect Studio before enabling USB audio.";
            PublishUsbStatus(); PublishYouTubeStatus(null);
            runningGame = null; sessionTitle = null;
            PublishSavedCameraInputs();
            status.Text = clean ? "Cameras disconnected." : "Studio's local video controller stopped. Close and reopen Studio to reconnect.";
            UpdateButtons();
        }
    }
    private async Task<Dictionary<string, object>> Command(object action, int timeoutMs = 120000) {
        if (closing || local == null || !WorkspacePolicy.Loopback(localAddress)) throw new InvalidDataException();
        using (var timeout = new System.Threading.CancellationTokenSource(timeoutMs))
        using (var request = new HttpRequestMessage(HttpMethod.Post, localAddress + "/command")) {
            request.Headers.Add("Origin", localAddress);
            request.Content = new StringContent(json.Serialize(action), Encoding.UTF8, "application/json"); request.Content.Headers.ContentType.CharSet = null;
            using (var response = await local.SendAsync(request, timeout.Token)) { response.EnsureSuccessStatusCode(); return json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync()); }
        }
    }
    private async Task<Dictionary<string, object>> ConfigureCameraSource(string role, Dictionary<string, object> source) {
        var configured = await Command(new { action = "configure-camera-input", cameraRole = role, source = source });
        appliedCameraSources[role] = source;
        return configured;
    }
    private bool CameraSourceApplied(string role, Dictionary<string, object> source) {
        Dictionary<string, object> applied;
        if (!appliedCameraSources.TryGetValue(role, out applied) || applied.Count != source.Count) return false;
        foreach (var field in source) {
            object value;
            if (!applied.TryGetValue(field.Key, out value) || !Object.Equals(value, field.Value)) return false;
        }
        return true;
    }
    private string TextValue(Dictionary<string, object> state, string key) { object value; return state != null && state.TryGetValue(key, out value) ? value as string : null; }
    private void ApplyState(Dictionary<string, object> state) {
        if (child == null || child.HasExited) return;
        stateRevision++;
        lastState = state;
        UpdateSleepPrevention();
        var phase = TextValue(state, "program");
        recording = phase == "recording" || phase == "starting" || phase == "stopping";
        if (!WorkspacePolicy.KeepUsbSession(usbGame, runningGame, recording) && usbGame != null) { var ignored = StopUsbAudio(); }
        previewMapping = phase == "recording" ? TextValue(state, "previewMapping") : null;
        object cameraStatus;
        object inputs;
        if (selectedGame == runningGame && state.TryGetValue("cameraInputs", out inputs)) PublishCameraInputs(SafeCameraInputs(inputs));
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
        PublishSessionStatus();
        if (web.CoreWebView2 != null && WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin) && selectedGame == runningGame) {
            var offline = state == null;
            object available; var enabled = !offline && state.TryGetValue("streamingAvailable", out available) && available is bool && (bool)available;
            object recovery; var canReconnect = !offline && state.TryGetValue("canReconnect", out recovery) && recovery is bool && (bool)recovery;
            object presentation; if (offline || !state.TryGetValue("presentation", out presentation)) presentation = null;
            var broadcastMessage = youtubeError;
            if (!offline && String.IsNullOrEmpty(broadcastMessage) && TextValue(state, "streaming") == "failed")
                broadcastMessage = TextValue(state, "streamingMessage") ?? "Studio could not start this output. Your game and watch link are kept.";
            object output; var localOutput = !offline && state.TryGetValue("localOutput", out output) ? output as Dictionary<string, object> : null;
            web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-youtube-status',{detail:" + json.Serialize(new { gameId = runningGame, available = !offline && enabled, busy = !offline && busy, canReconnect = canReconnect, canRecover = true, canRestartBroadcast = CanRestartBroadcast(state), programAuthorityEnded = !offline && StateFlag("programAuthorityEnded"), needsRecovery = WorkspacePolicy.RestartYouTube(TextValue(state, "pairing"), TextValue(state, "streaming")), canHoldStream = !offline && StateFlag("canHoldStream"), canGracefulEnd = !offline && StateFlag("canGracefulEnd"), presentation = presentation, streaming = offline ? "failed" : TextValue(state, "streaming") ?? "idle", outputActive = localOutput != null && TextValue(localOutput, "state") == "active", live = !offline && TextValue(state, "broadcast") == "live", lastLiveAgeMs = !offline && state.ContainsKey("lastLiveAgeMs") ? state["lastLiveAgeMs"] : null, concurrentViewers = !offline && state.ContainsKey("concurrentViewers") ? state["concurrentViewers"] : null, receiving = !offline && TextValue(state, "youtubeReception") == "confirmed", message = offline || enabled ? broadcastMessage : "YouTube streaming is not enabled in this Studio installation." }) + "}));");
        }
    }
    private void PublishSessionStatus() {
        if (mayClose || web.CoreWebView2 == null || !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin)) return;
        web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-recovery-status',{detail:" + json.Serialize(new { gameId = selectedGame, canForceClose = true }) + "}));");
        var active = recording && runningGame != null && child != null && !child.HasExited;
        object presentationValue, outputValue, replayValue, coachValue;
        var coachReview = lastState != null && lastState.TryGetValue("coachReview",out coachValue) ? coachValue : null;
        var replay = lastState != null && lastState.TryGetValue("replay", out replayValue) ? replayValue : null;
        var presentation = lastState != null && lastState.TryGetValue("presentation", out presentationValue) ? presentationValue as Dictionary<string, object> : null;
        var output = lastState != null && lastState.TryGetValue("localOutput", out outputValue) ? outputValue as Dictionary<string, object> : null;
        web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-session-status',{detail:" + json.Serialize(new {
            replay = active ? replay : null,
            coachReview = active ? coachReview : null,
            canCaptureCoachClip = active && !gameEnded && StateFlag("canCaptureCoachClip"),
            gameId = active ? runningGame : null, title = active ? sessionTitle ?? "Current game" : "", active = active, busy = busy || closing || finishingCompletedGame,
            presentation = active && presentation != null ? TextValue(presentation, "mode") ?? "live" : "live",
            streaming = active ? TextValue(lastState, "streaming") ?? "idle" : "idle",
            outputActive = active && output != null && TextValue(output, "state") == "active",
            live = active && TextValue(lastState, "broadcast") == "live", canHoldStream = active && StateFlag("canHoldStream"), canLeaveGame = true,
            canCloseWorkspace = selectedGame != null && (runningGame == null || selectedGame == runningGame),
            canCloseGameDirectly = !gameEnded && !busy && !closing && (runningGame == null || runningGame == selectedGame) && CanClosePreview()
        }) + "}));");
    }
    private bool CoachGamePage(string source, string game) {
        return game != null && game == selectedGame && IsCurrentWorkspacePage(source) &&
            WorkspacePolicy.Game(source, origin) == game && new Uri(source).AbsolutePath == "/score/" + game;
    }
    private bool CoachSessionCurrent(string source, string game, HttpClient controller, int revision) {
        return CoachGamePage(source, game) && coachPageRevision == revision &&
            game == runningGame && recording && !gameEnded && !closing && controller != null && controller == local &&
            child != null && !child.HasExited && StateFlag("canCaptureCoachClip");
    }
    private async Task CaptureCoachClip(string source, string nonce) {
        var game = selectedGame; var controller = local; var revision = coachPageRevision;
        Guid clip; string capturedAt; double duration, minimum;
        object detail = new { gameId = game, nonce = nonce, ok = false, error = "Studio couldn’t capture the recent camera clip. Try again shortly." };
        if (!busy && !coachCapturePending && CoachSessionCurrent(source, game, controller, revision)) {
            coachCapturePending = true;
            try {
                var captured = await Command(new { action = "capture-coach-clip" }, 22000);
                DateTimeOffset timestamp;
                capturedAt = TextValue(captured, "capturedAt");
                if (CoachSessionCurrent(source, game, controller, revision) &&
                    Guid.TryParseExact(TextValue(captured, "clipId"), "D", out clip) &&
                    DateTimeOffset.TryParse(capturedAt, out timestamp) &&
                    CoachClipSeconds(captured, "duration", out duration) && duration > 0 && duration <= 125 &&
                    CoachClipSeconds(captured, "minimum", out minimum) && Math.Abs(minimum - Math.Max(0, duration - 120)) < 0.001) {
                    coachClipId = clip;
                    detail = new { gameId = game, nonce = nonce, ok = true, clipId = clip.ToString(), capturedAt = capturedAt, duration = duration, minimum = minimum };
                }
            } catch { /* Never forward controller diagnostics to the page. */ }
            finally { coachCapturePending = false; }
        }
        if (revision == coachPageRevision && CoachGamePage(source, game))
            await web.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-coach-capture-result',{detail:" + json.Serialize(detail) + "}));");
    }
    private static bool CoachClipSeconds(Dictionary<string, object> state, string key, out double seconds) {
        seconds = 0;
        object value;
        if (!state.TryGetValue(key, out value) || !(value is int || value is long || value is decimal || value is double)) return false;
        seconds = Convert.ToDouble(value);
        return !Double.IsNaN(seconds) && !Double.IsInfinity(seconds);
    }
    private async void CoachClipResource(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
        if (origin == null || !e.Request.Uri.StartsWith(origin + "/__studio-coach-clip/", StringComparison.Ordinal)) return;
        var deferral = e.GetDeferral();
        var ownsDownload = false;
        try {
            var core = web.CoreWebView2;
            var game = runningGame; var controller = local; var revision = coachPageRevision; var source = core.Source;
            var uri = new Uri(e.Request.Uri);
            var parts = uri.AbsolutePath.Split('/'); Guid clip;
            var headers = e.Request.Headers;
            var fetch = e.ResourceContext == CoreWebView2WebResourceContext.Fetch ||
                e.ResourceContext == CoreWebView2WebResourceContext.XmlHttpRequest;
            if (!CoachSessionCurrent(source, game, controller, revision) || coachDownloadPending ||
                uri.Query.Length != 0 || parts.Length != 4 || parts[2] != game ||
                !Guid.TryParseExact(parts[3], "D", out clip) || coachClipId != clip ||
                e.Request.Method != "GET" || !fetch ||
                headers.Contains("Range") || !headers.Contains("Referer") ||
                headers.GetHeader("Referer") != new Uri(source).GetLeftPart(UriPartial.Query))
                throw new InvalidOperationException();
            coachDownloadPending = ownsDownload = true;
            using (var timeout = new System.Threading.CancellationTokenSource(10000))
            using (var request = new HttpRequestMessage(HttpMethod.Get, localAddress + "/coach-clip/" + clip.ToString())) {
                request.Headers.Add("Origin", localAddress);
                using (var response = await controller.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token)) {
                    var length = response.Content.Headers.ContentLength;
                    if (!response.IsSuccessStatusCode || length == null || length <= 0 || length > MaxCoachClipBytes ||
                        response.Content.Headers.ContentType == null || response.Content.Headers.ContentType.MediaType != "video/mp4")
                        throw new InvalidDataException();
                    var bytes = new byte[(int)length];
                    using (var input = await response.Content.ReadAsStreamAsync()) {
                        for (var offset = 0; offset < bytes.Length;) {
                            var received = await input.ReadAsync(bytes, offset, bytes.Length - offset, timeout.Token);
                            if (received == 0) throw new EndOfStreamException();
                            offset += received;
                        }
                    }
                    if (!CoachSessionCurrent(source, game, controller, revision) || coachClipId != clip)
                        throw new InvalidOperationException();
                    e.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(bytes, false), 200, "OK",
                        "Content-Type: video/mp4\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: " + bytes.Length);
                }
            }
        } catch {
            try {
                var core = web.CoreWebView2;
                if (core != null)
                    e.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 404, "Coach clip unavailable", "Cache-Control: no-store");
            } catch { /* The browser may have closed while the clip was being read. */ }
        } finally {
            if (ownsDownload) coachDownloadPending = false;
            deferral.Complete();
        }
    }
    private async void ReplayResource(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
        if (origin == null || !e.Request.Uri.StartsWith(origin + "/__studio-replay/")) return;
        var deferral = e.GetDeferral();
        try {
            var game = runningGame; var controller = local; var source = new Uri(e.Request.Uri);
            var parts = source.AbsolutePath.Split('/'); Guid clip;
            if (!recording || game == null || game != selectedGame || controller == null || parts.Length != 4 ||
                parts[2] != game || !Guid.TryParseExact(parts[3], "D", out clip) || e.Request.Method != "GET" ||
                !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin)) throw new InvalidOperationException();
            using (var timeout = new System.Threading.CancellationTokenSource(10000))
            using (var request = new HttpRequestMessage(HttpMethod.Get, localAddress + "/replay/" + clip.ToString())) {
                if (e.Request.Headers.Contains("Range")) request.Headers.TryAddWithoutValidation("Range", e.Request.Headers.GetHeader("Range"));
                using (var response = await controller.SendAsync(request, timeout.Token)) {
                    var bytes = await response.Content.ReadAsByteArrayAsync();
                    if (bytes.Length > 80 * 1024 * 1024 || game != runningGame || selectedGame != game || controller != local) throw new InvalidOperationException();
                    var headers = "Content-Type: video/mp4\r\nCache-Control: no-store\r\nAccept-Ranges: bytes\r\nContent-Length: " + bytes.Length;
                    if (response.Content.Headers.ContentRange != null) headers += "\r\nContent-Range: " + response.Content.Headers.ContentRange.ToString();
                    e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(bytes), (int)response.StatusCode, response.ReasonPhrase, headers);
                }
            }
        } catch {
            e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 503, "Replay unavailable", "Cache-Control: no-store");
        } finally { deferral.Complete(); }
    }
    private async Task Poll() {
        if (polling || closing || local == null || !recording) return;
        var observedChild = child;
        var observedZoomRevision = cameraZoomRevision;
        var observedStateRevision = stateRevision;
        polling = true;
        try { using (var timeout = new System.Threading.CancellationTokenSource(3000)) using (var response = await local.GetAsync(localAddress + "/state", timeout.Token)) { response.EnsureSuccessStatusCode(); var observed = json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync()); if (!closing && child == observedChild && cameraZoomRevision == observedZoomRevision && stateRevision == observedStateRevision) ApplyState(observed); } }
        catch { if (!busy) status.Text = "Recording status is unavailable. Keep Studio open while checking the recording."; }
        finally { polling = false; }
        if (!recording && child != null && !busy && !closing) { try { await CloseController(); } catch { status.Text = "Camera cleanup is pending. Keep Studio open and try disconnecting again."; } }
    }
    private string CameraInputStatus(string role) {
        object inputs, slot;
        var map = lastState != null && lastState.TryGetValue("cameraInputs", out inputs) ? inputs as Dictionary<string, object> : null;
        var state = map != null && map.TryGetValue(role, out slot) ? slot as Dictionary<string, object> : null;
        if (state == null) return "Saved settings apply when you connect this game's cameras.";
        if (TextValue(state, "kind") == "phone") return "Phone cameras join through the game’s camera QR code.";
        object enabled;
        if (state.TryGetValue("connectionEnabled", out enabled) && Object.Equals(enabled, false)) return "Settings saved. Tap Connect on this camera to start video.";
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
            if (source.TryGetValue("connectionEnabled", out value) && value is bool) safe["connectionEnabled"] = value;
            if (source.TryGetValue("generation", out value) && value is int && (int)value >= 0) safe["generation"] = value;
            if (source.TryGetValue("zoom", out value) && (value is int || value is decimal || value is double)) {
                var zoom = Convert.ToDouble(value);
                if (!Double.IsNaN(zoom) && !Double.IsInfinity(zoom) && zoom >= 1 && zoom <= 4) safe["zoom"] = zoom;
            }
            foreach (var phase in new[] { "idle", "connecting", "streaming", "retrying", "failed" }) if (TextValue(source, "phase") == phase) safe["phase"] = phase;
            foreach (var error in new[] { "auth_failed", "runtime_missing", "stale_frames", "unavailable", "invalid_pipe" }) if (TextValue(source, "errorCode") == error) safe["errorCode"] = error;
            output[role] = safe;
        }
        return output;
    }
    private void PublishCameraInputs(object cameras) {
        if (selectedGame == null || web.CoreWebView2 == null || WorkspacePolicy.Game(web.CoreWebView2.Source, origin) != selectedGame) return;
        web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('studio-camera-inputs',{detail:" + json.Serialize(new { gameId = selectedGame, cameras = cameras }) + "}));");
    }
    private void PublishSavedCameraInputs() {
        if (runningGame != null || cameraPreferencesUnavailable) return;
        var cameras = new Dictionary<string, object>();
        foreach (var entry in cameraInputs) {
            var kind = TextValue(entry.Value, "kind");
            cameras[entry.Key] = new { kind = kind, configured = kind != "phone", connectionEnabled = false, phase = "idle", generation = 0 };
        }
        PublishCameraInputs(cameras);
    }
    private void OpenCameraSettings(string role) {
        if (cameraSettings != null || busy || closing || !CameraInputs.Role(role) || !WorkspacePolicy.CanConfigureSession(selectedGame, runningGame)) return;
        ReadCameraPreferences();
        Dictionary<string, object> initial; cameraInputs.TryGetValue(role, out initial);
        var game = selectedGame;
        var initialMessage = cameraPreferencesUnavailable
            ? "Studio couldn’t read the saved camera profile. Check the Windows profile before saving."
            : initial == null ? "Choose which device to use for this camera."
            : TextValue(initial, "kind") == "phone" ? "Phone cameras join through the game’s camera QR code." : CameraInputStatus(role);
        cameraSettings = new CameraInputPanel(role, initial, initialMessage, async source => {
            if (closing || selectedGame != game || !WorkspacePolicy.CanConfigureSession(game, runningGame))
                return "Return to the active game before saving camera settings.";
            if (busy) return "Studio is preparing this game. Wait a moment, then choose Save settings again.";
            busy = true;
            UpdateButtons();
            try {
                var directory = CameraPreferenceDirectory;
                var legacy = LegacyCameraDirectory;
                cameraInputs = await Task.Run(() => CameraInputs.SaveSlot(directory, legacy, role, source));
                cameraPreferencesUnavailable = false;
                if (selectedGame == game && runningGame == game && local != null && !CameraSourceApplied(role, source)) {
                    try {
                        ApplyState(await ConfigureCameraSource(role, source));
                    } catch { return "Saved for the next session. Studio couldn’t apply it to this game. Choose Save settings to retry."; }
                } else PublishSavedCameraInputs();
                return null;
            } finally { busy = false; UpdateButtons(); }
        }, CloseCameraSettings);
        var width = Math.Min(ClientSize.Width, (int)Math.Round(480 * DeviceDpi / 96.0));
        cameraSettings.Bounds = new Rectangle(ClientSize.Width - width, 0, width, ClientSize.Height);
        cameraSettings.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Right;
        web.Enabled = false;
        Controls.Add(cameraSettings);
        cameraSettings.BringToFront();
        cameraSettings.FocusSource();
    }
    private void CloseCameraSettings() {
        if (cameraSettings == null) return;
        cameraSettings.Dispose();
        cameraSettings = null;
        web.Enabled = true;
        web.Focus();
    }
    private async Task UsbCommand(Dictionary<string, object> value) {
        if (usbBusy || closing || selectedGame == null || (usbGame != null && usbGame != selectedGame) || TextValue(value, "gameId") != selectedGame ||
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
            } else if (type == "studio-usb-processing" && value.Count == 4 && usbGame == selectedGame) {
                object frequency;
                if (!value.TryGetValue("humFrequency", out frequency) || !(frequency is int)) throw new InvalidDataException();
                usbAudio.SetProcessing(TextValue(value, "noiseReduction"), (int)frequency);
            }
        } catch { usbError = "USB audio could not start or update. Check the receiver connection and selected input."; }
        finally { usbBusy = false; PublishUsbStatus(); }
    }
    private async Task StopUsbAudio(bool flushRenderer = true) {
        usbGame = null;
        lock (usbLock) usbSamples.Clear();
        try { await Task.Run(() => usbAudio.Stop()); }
        catch (TimeoutException) {
            if (flushRenderer) throw;
            usbError = "The local microphone took too long to stop.";
        }
        if (!flushRenderer) return;
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
        if (!WorkspacePolicy.KeepUsbSession(usbGame, runningGame, recording)) { usbAudio.Stop(); usbGame = null; lock (usbLock) usbSamples.Clear(); return; }
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
        if (closing || web.CoreWebView2 == null || selectedGame == null || (usbGame != null && selectedGame != usbGame) || !WorkspacePolicy.SameOrigin(web.CoreWebView2.Source, origin)) return;
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
    private Task CloseController() { return CloseControllerWithin(false); }
    private Task CloseControllerWithin(bool previewOnly) {
        if (!controllerClose.IsCompleted) return controllerClose;
        return controllerClose = previewOnly
            ? Task.WhenAll(StopUsbAudio(false), ReleaseController(true))
            : CloseControllerAfterAudio();
    }
    private async Task CloseControllerAfterAudio() {
        try { await StopUsbAudio(); }
        catch (TimeoutException) { RecordCleanupWarning("The local microphone took too long to stop. Check the saved recording before using it."); }
        await ReleaseController(false);
    }
    private async Task ReleaseController(bool previewOnly) {
        var owned = child;
        if (owned == null) return;
        var completed = gameEnded;
        status.Text = previewOnly ? "Closing camera preview…" : "Stopping output and disconnecting cameras…";
        if (!owned.HasExited) {
            try { owned.StandardInput.WriteLine("close"); owned.StandardInput.Flush(); }
            catch { if (!owned.HasExited && !previewOnly && !completed) throw; }
        }
        var receipt = exited.Task;
        if (await Task.WhenAny(receipt, Task.Delay(previewOnly ? 6000 : 24000)) != receipt || !owned.HasExited) {
            // A completed game cannot resume its output. For open games, only
            // an unpaired preview may be stopped without a cleanup receipt.
            if ((!previewOnly && !completed && !gameEnded) || !await WorkspacePolicy.ForceStopController(owned)) throw new InvalidDataException();
        }
        var cleanupConfirmed = receipt.Status == TaskStatus.RanToCompletion && receipt.Result;
        if (!forceClosing && !previewOnly && !cleanupConfirmed && !(startupFailed && !controllerReady)) {
            // Keep the cleanup warning even after the local sender exits.
            RecordCleanupWarning("Previous Studio cleanup was not confirmed. Check any saved recording before using it.");
        }
        if (local != null) local.Dispose(); local = null;
        child = null; owned.Dispose(); runningGame = null; sessionTitle = null; lastState = null; previewMapping = null; localAddress = null; recording = false; coachClipId = null;
        UpdateSleepPrevention();
        appliedCameraSources.Clear();
        if (!closing) { PublishSavedCameraInputs(); PublishSessionStatus(); }
        if (completed && !closing) status.Text = cleanupConfirmed ? "Game saved. Cameras disconnected." : "Game saved. Local recording finalization was not confirmed. Check Saved videos.";
        pendingNavigation = pendingNavigationNonce = pendingNavigationGame = permittedNavigation = leaveDashboardGame = null;
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
