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
    internal static bool ValidLogin(string value, int limit) {
        if (value == null || value.Length > limit) return false;
        foreach (char c in value) if (Char.IsControl(c)) return false;
        return true;
    }
    internal static bool ValidPath(string path) {
        if (String.IsNullOrEmpty(path) || path.Length > 1024 || path[0] != '/') return false;
        foreach (char c in path) if (Char.IsControl(c) || Char.IsWhiteSpace(c) || c == '#' || c == '\\') return false;
        return true;
    }
    internal static int EncodedLoginLength(string value) {
        int length = 0;
        foreach (byte b in Encoding.UTF8.GetBytes(value)) {
            bool unreserved = (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '-' || b == '.' || b == '_' || b == '~';
            length += unreserved ? 1 : 3;
        }
        return length;
    }
    internal static Dictionary<string, object> Rtsp(string host, int port, string username, string password, string path, int rotation) {
        username = username ?? ""; password = password ?? "";
        if (!PrivateIPv4(host) || port < 1 || port > 65535 || !ValidLogin(username, 128) || !ValidLogin(password, 256) || !ValidPath(path) || (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270)) throw new InvalidDataException("Check the private camera address and local RTSP settings.");
        if ((username.Length > 0 || password.Length > 0) && EncodedLoginLength(username) + 1 + EncodedLoginLength(password) > 127) throw new InvalidDataException("Use a shorter local camera username or password.");
        return new Dictionary<string, object> { { "kind", "rtsp" }, { "host", host }, { "port", port }, { "username", username }, { "password", password }, { "path", path }, { "rotation", rotation } };
    }
    internal static Dictionary<string, object> ParseAddress(string address, int port, string username, string password, string path, int rotation, bool preserveTapo = false) {
        address = (address ?? "").Trim();
        if (PrivateIPv4(address)) return AddressSource(address, port, username, password, path, rotation, preserveTapo);
        Uri uri;
        foreach (char c in address) if (Char.IsControl(c) || Char.IsWhiteSpace(c) || c == '#' || c == '\\') throw new InvalidDataException();
        if (!Uri.TryCreate(address, UriKind.Absolute, out uri) || uri.Scheme != "rtsp" || !PrivateIPv4(uri.Host)) throw new InvalidDataException();
        var authority = address.Substring(address.IndexOf("://", StringComparison.Ordinal) + 3).Split(new[] { '/', '?' }, 2)[0];
        var endpoint = authority.Substring(authority.LastIndexOf('@') + 1).Split(':');
        if (endpoint.Length > 2 || !PrivateIPv4(endpoint[0]) || endpoint[0] != uri.Host) throw new InvalidDataException();
        var account = uri.UserInfo.Split(new[] { ':' }, 2);
        if (uri.UserInfo.Length > 0) { username = Uri.UnescapeDataString(account[0]); password = account.Length == 2 ? Uri.UnescapeDataString(account[1]) : ""; }
        var escapedPath = uri.GetComponents(UriComponents.PathAndQuery, UriFormat.UriEscaped);
        return AddressSource(uri.Host, uri.Port == -1 ? 554 : uri.Port, username, password, escapedPath, rotation, preserveTapo);
    }
    internal static Dictionary<string, object> AddressSource(string host, int port, string username, string password, string path, int rotation, bool preserveTapo) {
        if (preserveTapo && port == 554 && (path == "/stream1" || path == "/stream2")) return Tapo(host, username, password, path.Substring(1), rotation);
        return Rtsp(host, port, username, password, path, rotation);
    }
    internal static string SourcePath(Dictionary<string, object> source) { return (string)source["kind"] == "tapo" ? "/" + (string)source["stream"] : (string)source["path"]; }
    internal static void Validate(Dictionary<string, object> source) {
        if (source == null || !source.ContainsKey("kind")) throw new InvalidDataException();
        var kind = source["kind"] as string;
        if (kind == "phone") { if (source.Count != 1) throw new InvalidDataException(); return; }
        if (source.Count != 7) throw new InvalidDataException();
        if (kind == "tapo") { if ((int)source["port"] != 554) throw new InvalidDataException(); Tapo((string)source["host"], (string)source["username"], (string)source["password"], (string)source["stream"], (int)source["rotation"]); }
        else if (kind == "rtsp") Rtsp((string)source["host"], (int)source["port"], (string)source["username"], (string)source["password"], (string)source["path"], (int)source["rotation"]);
        else throw new InvalidDataException();
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
                Validate(entry.Value);
            }
            return data;
        } finally { Array.Clear(bytes, 0, bytes.Length); }
    }
    internal static void Save(string directory, Dictionary<string, Dictionary<string, object>> values) {
        foreach (var entry in values) { if (!Role(entry.Key)) throw new InvalidDataException(); Validate(entry.Value); }
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
        Text = (role == "camera-home" ? "Camera 1" : "Camera 2") + " source";
        ClientSize = new Size(560, 620); MinimumSize = new Size(540, 620); AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 10); StartPosition = FormStartPosition.CenterParent;
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, AutoScroll = true }; Controls.Add(panel);
        Func<TableLayoutPanel, string, bool, TextBox> field = (parent, label, secret) => {
            parent.Controls.Add(new Label { Text = label, AutoSize = true });
            var box = new TextBox { Dock = DockStyle.Top, Multiline = !secret, UseSystemPasswordChar = secret, MinimumSize = new Size(0, 44), AccessibleName = label }; parent.Controls.Add(box); return box;
        };
        var kind = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Top, MinimumSize = new Size(0, 44), AccessibleName = "Camera source" }; kind.Items.AddRange(new object[] { "Phone", "IP camera" }); panel.Controls.Add(kind);
        var camera = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 1, AutoSize = true }; panel.Controls.Add(camera);
        var preset = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Top, MinimumSize = new Size(0, 44), AccessibleName = "Camera type" }; preset.Items.AddRange(new object[] { "Tapo", "Other RTSP camera" }); preset.SelectedIndex = 0; camera.Controls.Add(preset);
        var help = new Label { AutoSize = true, MaximumSize = new Size(490, 0), Text = "Same network as this PC. For Tapo, use the Camera Account from the app's Advanced Settings." }; camera.Controls.Add(help);
        var host = field(camera, "Private IP or RTSP address", false);
        var username = field(camera, "Local camera username (optional)", false);
        var password = field(camera, "Local camera password (optional)", true);
        var toggle = new Button { Text = "Advanced settings", Dock = DockStyle.Top, MinimumSize = new Size(0, 44) }; camera.Controls.Add(toggle);
        var advanced = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 1, AutoSize = true, Visible = false }; camera.Controls.Add(advanced);
        var port = field(advanced, "RTSP port", false); port.Text = "554";
        var path = field(advanced, "RTSP path", false); path.Text = "/stream1";
        var quality = new ComboBox { Dock = DockStyle.Top, MinimumSize = new Size(0, 44), DropDownStyle = ComboBoxStyle.DropDownList, AccessibleName = "Tapo quality" }; quality.Items.AddRange(new object[] { "Higher quality", "Lower bandwidth" }); quality.SelectedIndex = 0; advanced.Controls.Add(quality);
        var rotation = new ComboBox { Dock = DockStyle.Top, MinimumSize = new Size(0, 44), DropDownStyle = ComboBoxStyle.DropDownList, AccessibleName = "Optional video rotation" }; rotation.Items.AddRange(new object[] { "As mounted (0 degrees)", "90 degrees", "180 degrees", "270 degrees" }); rotation.SelectedIndex = 0;
        advanced.Controls.Add(new Label { Text = "Optional rotation — full frame is preserved", AutoSize = true }); advanced.Controls.Add(rotation);
        toggle.Click += (sender, e) => { advanced.Visible = !advanced.Visible; toggle.Text = advanced.Visible ? "Hide advanced settings" : "Advanced settings"; };
        preset.SelectedIndexChanged += (sender, e) => { quality.Enabled = preset.SelectedIndex == 0; port.Text = "554"; path.Text = preset.SelectedIndex == 0 ? "/stream1" : "/"; help.Text = preset.SelectedIndex == 0 ? "Use the local Camera Account from the Tapo app. Keep the camera upright; rotation is optional." : "Use your camera's RTSP address. Anonymous access can leave both login fields empty."; };
        quality.SelectedIndexChanged += (sender, e) => { if (preset.SelectedIndex == 0) path.Text = quality.SelectedIndex == 0 ? "/stream1" : "/stream2"; };
        var message = new Label { AutoSize = true, MaximumSize = new Size(490, 0), AccessibleName = "Camera connection status", Text = readStatus() };
        string addressError = null;
        host.TextChanged += (sender, e) => { addressError = null; };
        Action parse = () => {
            if (!host.Text.Trim().StartsWith("rtsp:", StringComparison.OrdinalIgnoreCase)) return;
            try {
                int value; if (!Int32.TryParse(port.Text, out value)) value = 554;
                var source = CameraInputs.ParseAddress(host.Text, value, username.Text, password.Text, path.Text, rotation.SelectedIndex * 90, preset.SelectedIndex == 0);
                host.Text = (string)source["host"]; username.Text = (string)source["username"]; password.Text = (string)source["password"];
                var parsedPath = CameraInputs.SourcePath(source);
                preset.SelectedIndex = (string)source["kind"] == "tapo" ? 0 : 1;
                quality.SelectedIndex = parsedPath == "/stream2" ? 1 : 0;
                port.Text = source["port"].ToString(); path.Text = parsedPath;
            } catch (Exception error) { host.Clear(); addressError = error is InvalidDataException && error.Message == "Use a shorter local camera username or password." ? error.Message : "Check the private RTSP address. Login details are entered separately."; message.Text = addressError; }
        };
        // Parse only within the native dialog; show the private IP after leaving this field.
        host.Leave += (sender, e) => parse();
        if (initial != null && (string)initial["kind"] != "phone") {
            bool tapo = (string)initial["kind"] == "tapo"; string savedPath = tapo ? "/" + (string)initial["stream"] : (string)initial["path"];
            preset.SelectedIndex = tapo ? 0 : 1;
            quality.SelectedIndex = savedPath == "/stream2" ? 1 : 0;
            host.Text = (string)initial["host"]; username.Text = (string)initial["username"]; password.Text = (string)initial["password"]; port.Text = initial["port"].ToString(); path.Text = savedPath; rotation.SelectedIndex = (int)initial["rotation"] / 90; kind.SelectedIndex = 1;
        } else kind.SelectedIndex = 0;
        Action update = () => { camera.Visible = kind.SelectedIndex == 1; }; kind.SelectedIndexChanged += (sender, e) => update(); update();
        var save = new Button { Text = "Save and test connection", Dock = DockStyle.Top, MinimumSize = new Size(0, 44) }; panel.Controls.Add(save); panel.Controls.Add(message);
        var cancel = new Button { Text = "Cancel", Dock = DockStyle.Top, MinimumSize = new Size(0, 44), DialogResult = DialogResult.Cancel }; panel.Controls.Add(cancel); CancelButton = cancel;
        bool followStatus = false;
        save.Click += async (sender, e) => {
            save.Enabled = false; cancel.Enabled = false; followStatus = false; message.Text = "Checking camera settings...";
            try {
                Dictionary<string, object> source;
                if (kind.SelectedIndex == 0) source = CameraInputs.Phone();
                else { parse(); if (addressError != null) throw new InvalidDataException(addressError); int value; if (!Int32.TryParse(port.Text, out value)) throw new InvalidDataException(); source = CameraInputs.ParseAddress(host.Text, value, username.Text, password.Text, path.Text, rotation.SelectedIndex * 90, preset.SelectedIndex == 0); }
                message.Text = await apply(source); followStatus = true;
            } catch (InvalidDataException error) { message.Text = error.Message == "Use a shorter local camera username or password." ? error.Message : "Check the private camera address, port, path and local login."; }
            catch { message.Text = "Camera settings could not be applied. Check Studio and try again."; }
            finally { save.Enabled = true; cancel.Enabled = true; }
        };
        var timer = new System.Windows.Forms.Timer { Interval = 2000 }; timer.Tick += (sender, e) => { if (save.Enabled && followStatus) message.Text = readStatus(); }; timer.Start();
        FormClosed += (sender, e) => { timer.Dispose(); password.Clear(); username.Clear(); host.Clear(); };
    }
}
