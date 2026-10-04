using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Local Camera Account secrets never cross the WebView boundary.
internal static class CameraInputs
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("CurlStreamer.Studio.CameraInputs.v1");
    internal static bool Role(string role) { return role == "camera-home" || role == "camera-away"; }
    internal static bool PrivateIPv4(string host) {
        var parts = (host ?? "").Split('.');
        if (parts.Length != 4) return false;
        var bytes = new int[4];
        for (int i = 0; i < 4; i++)
            if (parts[i].Length == 0 || (parts[i].Length > 1 && parts[i][0] == '0') || !Int32.TryParse(parts[i], out bytes[i]) || bytes[i] < 0 || bytes[i] > 255 || parts[i] != bytes[i].ToString()) return false;
        return bytes[0] == 10 || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) || (bytes[0] == 192 && bytes[1] == 168);
    }
    internal static Dictionary<string, object> Phone() { return new Dictionary<string, object> { { "kind", "phone" } }; }
    internal static Dictionary<string, object> Tapo(string host, string username, string password, string stream, int rotation) {
        if (!PrivateIPv4(host) || String.IsNullOrWhiteSpace(username) || username.Length > 128 || username.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0 || String.IsNullOrEmpty(password) || password.Length > 256 || password.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0 || (stream != "stream1" && stream != "stream2") || (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270)) throw new InvalidDataException("Enter a private IPv4 address and the camera's local Camera Account credentials.");
        return new Dictionary<string, object> { { "kind", "tapo" }, { "host", host }, { "port", 554 }, { "username", username }, { "password", password }, { "stream", stream }, { "rotation", rotation } };
    }
    internal static Dictionary<string, Dictionary<string, object>> Load(string directory) {
        var path = Path.Combine(directory, "CameraInputs.dat");
        if (!File.Exists(path)) return new Dictionary<string, Dictionary<string, object>>();
        if (new FileInfo(path).Length > 16384) throw new InvalidDataException();
        var bytes = ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser);
        try {
            var data = new JavaScriptSerializer().Deserialize<Dictionary<string, Dictionary<string, object>>>(Encoding.UTF8.GetString(bytes));
            foreach (var entry in data) {
                if (!Role(entry.Key)) throw new InvalidDataException();
                var source = entry.Value;
                if ((string)source["kind"] == "phone") { if (source.Count != 1) throw new InvalidDataException(); }
                else { if ((string)source["kind"] != "tapo" || source.Count != 7 || (int)source["port"] != 554) throw new InvalidDataException(); Tapo((string)source["host"], (string)source["username"], (string)source["password"], (string)source["stream"], (int)source["rotation"]); }
            }
            return data;
        } finally { Array.Clear(bytes, 0, bytes.Length); }
    }
    internal static void Save(string directory, Dictionary<string, Dictionary<string, object>> values) {
        Directory.CreateDirectory(directory);
        var bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(values));
        try {
            var encrypted = ProtectedData.Protect(bytes, Entropy, DataProtectionScope.CurrentUser);
            var path = Path.Combine(directory, "CameraInputs.dat");
            var temp = path + ".tmp";
            File.WriteAllBytes(temp, encrypted);
            if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
        } finally { Array.Clear(bytes, 0, bytes.Length); }
    }
}

internal sealed class CameraInputDialog : Form
{
    internal CameraInputDialog(string role, Dictionary<string, object> initial, Func<Dictionary<string, object>, Task<string>> apply, Func<string> readStatus)
    {
        Text = (role == "camera-home" ? "Camera 1" : "Camera 2") + " source settings";
        ClientSize = new Size(620, 710); MinimumSize = new Size(600, 710); AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 10); StartPosition = FormStartPosition.CenterParent;
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, AutoScroll = true };
        Controls.Add(panel);
        var kind = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Top, MinimumSize = new Size(0, 44), AccessibleName = "Camera source" };
        kind.Items.AddRange(new object[] { "Phone", "Tapo (local RTSP)" });
        kind.SelectedIndex = initial != null && (string)initial["kind"] == "tapo" ? 1 : 0;
        panel.Controls.Add(kind);
        panel.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(560, 0), Text = "Set up the camera in the Tapo app on the same Wi-Fi as this PC. Create a local Camera Account in Advanced Settings; do not use your Tapo email/password. Find the camera IP in Device Info. Credentials are encrypted on this Windows account only." });
        Func<string, bool, TextBox> field = (label, secret) => {
            panel.Controls.Add(new Label { Text = label, AutoSize = true });
            var box = new TextBox { Dock = DockStyle.Top, Multiline = !secret, UseSystemPasswordChar = secret, MinimumSize = new Size(0, 44), AccessibleName = label };
            panel.Controls.Add(box); return box;
        };
        var host = field("Camera private IPv4 address", false);
        var username = field("Local Camera Account username", false);
        var password = field("Local Camera Account password", true);
        var stream = new ComboBox { Dock = DockStyle.Top, MinimumSize = new Size(0, 44), DropDownStyle = ComboBoxStyle.DropDownList, AccessibleName = "RTSP stream" };
        stream.Items.AddRange(new object[] { "stream1", "stream2" }); stream.SelectedIndex = 0;
        panel.Controls.Add(new Label { Text = "Stream (stream1 higher quality; stream2 lower bandwidth)", AutoSize = true }); panel.Controls.Add(stream);
        var rotation = new ComboBox { Dock = DockStyle.Top, MinimumSize = new Size(0, 44), DropDownStyle = ComboBoxStyle.DropDownList, AccessibleName = "Rotation degrees" };
        rotation.Items.AddRange(new object[] { 0, 90, 180, 270 }); rotation.SelectedIndex = 0;
        panel.Controls.Add(new Label { Text = "Rotation — full frame remains contained, never cropped", AutoSize = true }); panel.Controls.Add(rotation);
        if (kind.SelectedIndex == 1) { host.Text = (string)initial["host"]; username.Text = (string)initial["username"]; password.Text = (string)initial["password"]; stream.SelectedItem = initial["stream"]; rotation.SelectedItem = initial["rotation"]; }
        Action update = () => { foreach (var control in new Control[] { host, username, password, stream, rotation }) control.Enabled = kind.SelectedIndex == 1; };
        kind.SelectedIndexChanged += (s, e) => update(); update();
        var message = new Label { AutoSize = true, MaximumSize = new Size(560, 0), AccessibleName = "Camera connection status", Text = readStatus() };
        var save = new Button { Text = "Save and test connection", Dock = DockStyle.Top, MinimumSize = new Size(0, 44) };
        bool followStatus = true;
        panel.Controls.Add(save); panel.Controls.Add(message);
        save.Click += async (s, e) => {
            save.Enabled = false; followStatus = false;
            try { var source = kind.SelectedIndex == 0 ? CameraInputs.Phone() : CameraInputs.Tapo(host.Text.Trim(), username.Text, password.Text, (string)stream.SelectedItem, (int)rotation.SelectedItem); message.Text = await apply(source); followStatus = true; }
            catch (InvalidDataException) { message.Text = "Enter a private IPv4 address and valid local Camera Account credentials."; }
            catch { message.Text = "Camera settings could not be applied. Check Studio and try again."; }
            finally { save.Enabled = true; }
        };
        var timer = new System.Windows.Forms.Timer { Interval = 2000 };
        timer.Tick += (s, e) => { if (save.Enabled && followStatus) message.Text = readStatus(); }; timer.Start();
        FormClosed += (s, e) => { timer.Dispose(); password.Clear(); };
        panel.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(560, 0), Text = "Saving switches only this slot. A test is successful only when Studio receives fresh video. Camera mic and volume controls are on the scoring tile; phone zoom is unavailable for Tapo." });
    }
}
