using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

// Compiled as a Windows GUI application; no console or system Node installation.
internal sealed class Studio : Form
{
    private const string NodeHash = "@NODE_SHA256@";
    private const string ControllerHash = "@CONTROLLER_SHA256@";
    private const string ConfigurationHash = "@CONFIGURATION_SHA256@";
    private readonly TextBox game = new TextBox();
    private readonly Label status = new Label();
    private readonly Button start = new Button();
    private readonly Button controls = new Button();
    private readonly Button stop = new Button();
    private Process child;
    private string address;
    private bool stopping;
    private bool confirmed;
    private bool exitAfterStop;

    [STAThread]
    private static void Main(string[] arguments)
    {
        string launchGame = null;
        try {
            if (arguments.Length > 1) throw new InvalidDataException();
            if (arguments.Length == 1) launchGame = ReadLaunchGame(arguments[0]);
        } catch { MessageBox.Show("This Studio launch link is invalid. Open Studio from Windows and paste your game page link.", "CurlStreamer Studio"); return; }
        bool owner;
        using (var mutex = new Mutex(true, "Local\\CurlStreamerStudio", out owner))
        {
            if (!owner) { MessageBox.Show("Studio is already open. Finish and close its current game before opening another one.", "CurlStreamer Studio"); return; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
#if WORKSPACE
            Application.Run(new Workspace(launchGame, NodeHash, ControllerHash, ConfigurationHash));
#else
            Application.Run(new Studio(launchGame));
#endif
        }
    }

    internal static string ReadLaunchGame(string value)
    {
        Uri launch, page;
        if (value.Length > 2048 || !Uri.TryCreate(value, UriKind.Absolute, out launch) ||
            launch.Scheme != "curlstreamer" || launch.Host != "open" || launch.Port != -1 ||
            launch.UserInfo.Length != 0 || launch.Fragment.Length != 0 || launch.AbsolutePath != "/" ||
            !Regex.IsMatch(launch.Query, @"^\?game=[A-Za-z0-9%._~-]+$")) throw new InvalidDataException();
        var decoded = Uri.UnescapeDataString(launch.Query.Substring(6));
        if (!Uri.TryCreate(decoded, UriKind.Absolute, out page) || page.Scheme != "https" ||
            page.UserInfo.Length != 0 || page.Query.Length != 0 || page.Fragment.Length != 0 ||
            !Regex.IsMatch(page.AbsolutePath, @"^/games/[a-fA-F0-9-]{36}/?$")) throw new InvalidDataException();
        Guid gameId;
        if (!Guid.TryParse(page.AbsolutePath.TrimEnd('/').Substring(7), out gameId)) throw new InvalidDataException();
        // This link selects a game only. Controller configuration checks the exact website origin.
        return page.AbsoluteUri;
    }

    private Studio(string launchGame)
    {
        Text = "CurlStreamer Studio — Preview";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        ClientSize = new Size(650, 470);
        MinimumSize = new Size(650, 510);
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 11);
        BackColor = Color.FromArgb(10, 24, 40);
        ForeColor = Color.White;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 8 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.Controls.Add(new Label { Text = "CurlStreamer Studio", Font = new Font(Font.FontFamily, 22, FontStyle.Bold), AutoSize = true });
        layout.Controls.Add(new Label { Text = "Copy your game page link from the website.", AutoSize = true, Margin = new Padding(0, 16, 0, 8) });
        game.Dock = DockStyle.Top; game.AccessibleName = "Game page link"; game.MinimumSize = new Size(0, 44); game.Multiline = true; game.Height = 44;
        layout.Controls.Add(game);
        if (launchGame != null) game.Text = launchGame;
        start.Text = "Open Studio"; start.Height = 48; start.Dock = DockStyle.Top;
        start.Click += async (sender, args) => await StartStudio();
        layout.Controls.Add(start);
        controls.Text = "Show Studio controls"; controls.Height = 48; controls.Dock = DockStyle.Top; controls.Enabled = false;
        controls.Click += (sender, args) => OpenControls();
        layout.Controls.Add(controls);
        stop.Text = "Finish and close Studio"; stop.Height = 48; stop.Dock = DockStyle.Top; stop.Enabled = false;
        stop.Click += (sender, args) => { exitAfterStop = true; RequestStop(); };
        layout.Controls.Add(stop);
        var recordings = new Button { Text = "Open recordings folder", Height = 48, Dock = DockStyle.Top };
        recordings.Click += (sender, args) => {
            try {
                var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CurlStreamer", "Studio", "Recordings");
                Directory.CreateDirectory(path);
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            } catch { status.Text = "Could not open the recordings folder."; }
        };
        layout.Controls.Add(recordings);
        status.Text = "Keep this window open while recording. Closing the browser tab does not stop recording.";
        status.Dock = DockStyle.Fill; status.AutoSize = true; status.Padding = new Padding(0, 12, 0, 0);
        layout.Controls.Add(status);
        foreach (Control control in layout.Controls) {
            var button = control as Button;
            if (button != null) { button.ForeColor = Color.Black; button.BackColor = Color.FromArgb(65, 211, 226); }
        }
        Controls.Add(layout);
        FormClosing += (sender, args) => {
            if (child == null) return;
            args.Cancel = true;
            exitAfterStop = true;
            RequestStop();
        };
    }

    private static void Verify(string path, string expected)
    {
        using (var hash = SHA256.Create())
        using (var stream = File.OpenRead(path))
            if (BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant() != expected)
                throw new InvalidDataException();
    }

    private async Task StartStudio()
    {
        Uri url;
        var value = game.Text.Trim();
        if (!Uri.TryCreate(value, UriKind.Absolute, out url) || url.Scheme != "https" ||
            url.UserInfo.Length != 0 || url.Query.Length != 0 || url.Fragment.Length != 0 ||
            !Regex.IsMatch(url.AbsolutePath, @"^/games/[a-fA-F0-9-]{36}/?$")) {
            status.Text = "Paste the game page link, ending in /games/ followed by the game ID.";
            return;
        }
        start.Enabled = false; game.Enabled = false; confirmed = false; stopping = false; exitAfterStop = false;
        status.Text = "Checking Studio files…";
        try {
            var root = AppDomain.CurrentDomain.BaseDirectory;
            var node = Path.Combine(root, "node", "node.exe");
            var controller = Path.Combine(root, "app", "studio.mjs");
            await Task.Run(() => { Verify(node, NodeHash); Verify(controller, ControllerHash); });
            if (IsDisposed) return;
            var info = new ProcessStartInfo(node) {
                Arguments = "\"" + controller + "\" \"" + url.AbsoluteUri + "\"",
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            // Do not inherit developer credentials or Node injection settings.
            info.EnvironmentVariables.Clear();
            foreach (var key in new[] { "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE" }) {
                var setting = Environment.GetEnvironmentVariable(key);
                if (!String.IsNullOrEmpty(setting)) info.EnvironmentVariables[key] = setting;
            }
            info.EnvironmentVariables["PATH"] = Environment.GetFolderPath(Environment.SpecialFolder.System);
            info.EnvironmentVariables["NODE_ENV"] = "production";
            child = new Process { StartInfo = info };
            child.OutputDataReceived += (sender, args) => {
                if (args.Data != null && !IsDisposed) BeginInvoke((Action)(() => Receive(args.Data)));
            };
            child.ErrorDataReceived += (sender, args) => { /* Never forward arbitrary diagnostics or credentials. */ };
            child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
            stop.Enabled = true;
            var running = child;
            await Task.Run(() => running.WaitForExit());
            var successful = running.ExitCode == 0 && confirmed;
            child = null; running.Dispose(); controls.Enabled = false; stop.Enabled = false;
            start.Enabled = true; game.Enabled = true;
            status.Text = successful ? "Studio closed. Local recording cleanup was confirmed. Check YouTube separately if you streamed."
                : "Studio ended without confirmed cleanup. Check your recording and YouTube status before starting again.";
            if (exitAfterStop && successful) Close();
        } catch {
            if (child == null || !IsRunning(child)) {
                if (child != null) child.Dispose(); child = null;
                start.Enabled = true; game.Enabled = true; stop.Enabled = false;
            }
            status.Text = "Studio could not start. Check the game link or reinstall this preview. If recording began, verify its status before restarting.";
        }
    }

    private static bool IsRunning(Process process) { try { return !process.HasExited; } catch { return false; } }
    private void Receive(string line)
    {
        if (line.StartsWith("READY ") && Regex.IsMatch(line.Substring(6), @"^http://127\.0\.0\.1:[0-9]{1,5}$")) {
            address = line.Substring(6); controls.Enabled = !stopping;
            status.Text = "Studio is running. Use the browser controls to check this PC and connect your game.";
            if (!stopping) OpenControls();
        } else if (line == "CLOSED") confirmed = true;
        else if (line == "CLEANUP_UNCONFIRMED") status.Text = "Cleanup could not be confirmed. Check your recording and YouTube status.";
        else if (line == "START_FAILED") status.Text = "Installation check failed or this game link belongs to another website.";
    }
    private void OpenControls()
    {
        try { Process.Start(new ProcessStartInfo(address) { UseShellExecute = true }); }
        catch { status.Text = "Open these local controls in your browser: " + address; }
    }
    private void RequestStop()
    {
        if (child == null || stopping) return;
        stopping = true; controls.Enabled = false; stop.Enabled = false;
        status.Text = "Stopping output and finalizing recording. Keep Studio open until this finishes…";
        try { child.StandardInput.WriteLine("close"); child.StandardInput.Flush(); }
        catch { stopping = false; stop.Enabled = true; status.Text = "Could not request cleanup. Studio remains open; check the controls before retrying."; }
    }
}
