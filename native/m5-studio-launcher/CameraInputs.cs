using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Local Camera Account secrets never cross the WebView boundary.
internal static class CameraInputs
{
    private const string StoreFile = "CameraInputs.dat";
    private const int MaxStoreBytes = 16384;
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("CurlStreamer.Studio.CameraInputs.v1");
    internal static string ProfileDirectory() {
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (String.IsNullOrWhiteSpace(userProfile) || !Path.IsPathRooted(userProfile)) throw new InvalidOperationException("The Windows user profile is unavailable.");
        // A launcher started from a packaged app can get redirected writes under AppData.
        return Path.Combine(userProfile, ".curlstreamer", "Studio");
    }
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
        if (!PrivateIPv4(host) || String.IsNullOrWhiteSpace(username) || !ValidLogin(username, 128, true) || String.IsNullOrEmpty(password) || !ValidLogin(password, 256, true) || (stream != "stream1" && stream != "stream2") || (rotation != 0 && rotation != 90 && rotation != 180 && rotation != 270)) throw new InvalidDataException("Enter a private IPv4 address and the camera's local Camera Account credentials.");
        return new Dictionary<string, object> { { "kind", "tapo" }, { "host", host }, { "port", 554 }, { "username", username }, { "password", password }, { "stream", stream }, { "rotation", rotation } };
    }
    internal static bool ValidLogin(string value, int limit, bool asciiControlOnly = false) {
        if (value == null || value.Length > limit) return false;
        foreach (char c in value)
            if (asciiControlOnly ? c < ' ' || c == '\u007f' : Char.IsControl(c)) return false;
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
    internal static void Validate(Dictionary<string, object> source) {
        if (source == null || !source.ContainsKey("kind")) throw new InvalidDataException();
        var kind = source["kind"] as string;
        if (kind == "phone") { if (source.Count != 1) throw new InvalidDataException(); return; }
        if (source.Count != 7) throw new InvalidDataException();
        if (kind == "tapo") { if ((int)source["port"] != 554) throw new InvalidDataException(); Tapo((string)source["host"], (string)source["username"], (string)source["password"], (string)source["stream"], (int)source["rotation"]); }
        else if (kind == "rtsp") Rtsp((string)source["host"], (int)source["port"], (string)source["username"], (string)source["password"], (string)source["path"], (int)source["rotation"]);
        else throw new InvalidDataException();
    }
    internal static Dictionary<string, object> ActiveSource(Dictionary<string, object> profile) {
        return profile == null || (string)profile["kind"] == "phone" ? Phone() : profile;
    }
    internal static Dictionary<string, object> RememberedIp(Dictionary<string, object> profile) {
        if (profile == null) return null;
        if ((string)profile["kind"] != "phone") return profile;
        object saved;
        return profile.TryGetValue("lastIp", out saved) ? saved as Dictionary<string, object> : null;
    }
    private static void ValidateStored(Dictionary<string, object> source) {
        object lastIp, kind;
        if (source != null && source.TryGetValue("lastIp", out lastIp)) {
            if (source.Count != 2 || !source.TryGetValue("kind", out kind) || !Object.Equals(kind, "phone")) throw new InvalidDataException();
            var remembered = lastIp as Dictionary<string, object>;
            Validate(remembered);
            if (Object.Equals(remembered["kind"], "phone")) throw new InvalidDataException();
        } else Validate(source);
    }
    private static Dictionary<string, Dictionary<string, object>> ReadStored(string directory) {
        if (directory == null) return null;
        byte[] encrypted;
        try {
            using (var file = new FileStream(Path.Combine(directory, StoreFile), FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
            using (var reader = new BinaryReader(file)) {
                encrypted = reader.ReadBytes(MaxStoreBytes + 1);
                if (encrypted.Length == 0 || encrypted.Length > MaxStoreBytes) throw new InvalidDataException();
            }
        } catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
        var bytes = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
        try {
            var data = new JavaScriptSerializer().Deserialize<Dictionary<string, Dictionary<string, object>>>(Encoding.UTF8.GetString(bytes));
            if (data == null) throw new InvalidDataException();
            foreach (var entry in data) {
                if (!Role(entry.Key)) throw new InvalidDataException();
                ValidateStored(entry.Value);
            }
            return data;
        } finally { Array.Clear(bytes, 0, bytes.Length); }
    }
    internal static Dictionary<string, Dictionary<string, object>> Load(string directory) {
        return ReadStored(directory) ?? new Dictionary<string, Dictionary<string, object>>();
    }
    internal static Dictionary<string, Dictionary<string, object>> LoadProfile(string directory, string legacyDirectory) {
        var saved = ReadStored(directory);
        if (saved != null) return saved;
        if (ReadStored(legacyDirectory) == null) return Load(directory);
        using (LockProfile(directory)) {
            saved = ReadStored(directory);
            if (saved != null) return saved;
            var legacy = ReadStored(legacyDirectory);
            if (legacy != null) WriteProfile(directory, legacy);
            return legacy ?? new Dictionary<string, Dictionary<string, object>>();
        }
    }
    internal static Dictionary<string, Dictionary<string, object>> SaveSlot(string directory, string legacyDirectory, string role, Dictionary<string, object> activeSource) {
        if (!Role(role)) throw new InvalidDataException();
        Validate(activeSource);
        using (LockProfile(directory)) {
            var values = ReadStored(directory) ?? Load(legacyDirectory);
            Dictionary<string, object> previous;
            values.TryGetValue(role, out previous);
            var saved = new Dictionary<string, object>(activeSource);
            if ((string)saved["kind"] == "phone") {
                var remembered = RememberedIp(previous);
                if (remembered != null) saved.Add("lastIp", remembered);
            }
            values[role] = saved;
            WriteProfile(directory, values);
            return values;
        }
    }
    private static FileStream LockProfile(string directory) {
        Directory.CreateDirectory(directory);
        var lockPath = Path.Combine(directory, "CameraInputs.lock");
        var elapsed = Stopwatch.StartNew();
        while (true) {
            try { return new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException error) {
                const int sharingViolation = 32, lockViolation = 33;
                int code = error.HResult & 0xffff;
                if ((code != sharingViolation && code != lockViolation) || elapsed.ElapsedMilliseconds >= 1500) throw;
                Thread.Sleep(50);
            }
        }
    }
    private static void WriteProfile(string directory, Dictionary<string, Dictionary<string, object>> values) {
        var path = Path.Combine(directory, StoreFile);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        var bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(values));
        try {
            var encrypted = ProtectedData.Protect(bytes, Entropy, DataProtectionScope.CurrentUser);
            if (encrypted.Length > MaxStoreBytes) throw new InvalidDataException();
            using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                file.Write(encrypted, 0, encrypted.Length);
                file.Flush(true);
            }
            if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
        } finally {
            Array.Clear(bytes, 0, bytes.Length);
            try { File.Delete(temp); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
}

internal sealed class CameraInputPanel : UserControl
{
    private static readonly Color Canvas = Color.FromArgb(12, 24, 38);
    private static readonly Color Field = Color.FromArgb(22, 39, 56);
    private static readonly Color Border = Color.FromArgb(56, 80, 100);
    private static readonly Color Ink = Color.FromArgb(238, 246, 255);
    private static readonly Color Muted = Color.FromArgb(168, 192, 215);
    private static readonly Color Accent = Color.FromArgb(103, 222, 233);
    private static readonly Color ErrorColor = Color.FromArgb(255, 187, 174);
    private readonly ComboBox source, quality, rotation;
    private readonly TextBox address, username, password, port, path;
    private readonly TableLayoutPanel ipFields, advanced;
    private readonly Control qualityField, portField, pathField;
    private readonly Label hint, message;
    private readonly Button save, cancel;
    private string addressError;
    internal bool Saving { get; private set; }

    internal CameraInputPanel(string role, Dictionary<string, object> profile, string status, Func<Dictionary<string, object>, Task<string>> apply, Action close)
    {
        var title = role == "camera-home" ? "Camera 1 settings" : "Camera 2 settings";
        AccessibleName = title;
        BackColor = Border;
        ForeColor = Ink;
        Font = new Font("Segoe UI", 10);
        Padding = new Padding(1, 0, 0, 0);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, BackColor = Canvas };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(layout);
        var heading = Stack(new Padding(20, 16, 20, 12));
        heading.Controls.Add(Caption("STUDIO  /  CAMERAS", Accent));
        var name = Caption(title, Ink);
        name.Font = new Font(Font.FontFamily, 18, FontStyle.Bold);
        heading.Controls.Add(name);
        layout.Controls.Add(heading, 0, 0);

        var scroll = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty, AutoScroll = true, TabStop = false };
        var form = Stack(new Padding(20, 2, 20, 12));
        scroll.Controls.Add(form);
        layout.Controls.Add(scroll, 0, 1);
        source = Select(form, "Camera source", "Phone (QR code)", "Tapo IP camera", "Other RTSP camera");
        hint = Caption("", Muted);
        form.Controls.Add(hint);
        ipFields = Stack(Padding.Empty);
        form.Controls.Add(ipFields);
        address = Input(ipFields, "Private IP or RTSP address", 2048);
        username = Input(ipFields, "Camera username", 128);
        password = Input(ipFields, "Camera password", 256, true);
        var toggle = ActionButton("Advanced settings  +", false);
        ipFields.Controls.Add(toggle);
        advanced = Stack(new Padding(0, 4, 0, 0));
        ipFields.Controls.Add(advanced);
        quality = Select(advanced, "Tapo stream quality", "Higher quality", "Lower bandwidth");
        qualityField = quality.Parent;
        port = Input(advanced, "RTSP port", 5);
        portField = port.Parent.Parent;
        path = Input(advanced, "RTSP path", 1024);
        pathField = path.Parent.Parent;
        rotation = Select(advanced, "Video rotation", "As mounted (0°)", "90°", "180°", "270°");
        advanced.Visible = false;
        toggle.Click += (s, e) => {
            advanced.Visible = !advanced.Visible;
            toggle.Text = advanced.Visible ? "Advanced settings  −" : "Advanced settings  +";
        };

        var footer = Stack(new Padding(20, 8, 20, 14));
        message = Caption(status, Muted);
        footer.Controls.Add(message);
        var actions = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = Padding.Empty };
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        cancel = ActionButton("Cancel", false);
        save = ActionButton("Save settings", true);
        actions.Controls.Add(cancel, 0, 0);
        actions.Controls.Add(save, 1, 0);
        footer.Controls.Add(actions);
        layout.Controls.Add(footer, 0, 2);

        var ip = CameraInputs.RememberedIp(profile);
        var tapo = ip != null && (string)ip["kind"] == "tapo";
        port.Text = "554";
        path.Text = "/";
        if (ip != null) {
            address.Text = (string)ip["host"];
            username.Text = (string)ip["username"];
            password.Text = (string)ip["password"];
            rotation.SelectedIndex = (int)ip["rotation"] / 90;
            if (tapo) quality.SelectedIndex = (string)ip["stream"] == "stream2" ? 1 : 0;
            else {
                port.Text = ip["port"].ToString();
                path.Text = (string)ip["path"];
            }
        }
        source.SelectedIndex = profile == null || (string)profile["kind"] == "phone" ? 0 : tapo ? 1 : 2;
        source.SelectedIndexChanged += (s, e) => ShowSource();
        address.TextChanged += (s, e) => { addressError = null; };
        address.Leave += (s, e) => ParsePastedAddress();
        cancel.CausesValidation = false;
        cancel.Click += (s, e) => close();
        save.Click += async (s, e) => {
            Dictionary<string, object> next;
            try { next = ReadSource(); }
            catch (InvalidDataException error) {
                ShowMessage(error.Message, true);
                return;
            }
            Saving = true;
            form.Enabled = save.Enabled = cancel.Enabled = false;
            ShowMessage("Saving camera settings…", false);
            try {
                var error = await apply(next);
                if (IsDisposed) return;
                if (error == null) {
                    Saving = false;
                    close();
                    return;
                }
                ShowMessage(error, true);
            } catch {
                ShowMessage("Studio couldn’t save these settings. Check the Windows profile and try again.", true);
            } finally {
                Saving = false;
                if (!IsDisposed) form.Enabled = save.Enabled = cancel.Enabled = true;
            }
        };
        Resize += (s, e) => {
            hint.MaximumSize = new Size(Math.Max(180, scroll.ClientSize.Width - 48), 0);
            message.MaximumSize = new Size(Math.Max(180, ClientSize.Width - 44), 0);
        };
    }

    internal void FocusSource() { source.Focus(); }

    private void ShowSource()
    {
        ipFields.Visible = source.SelectedIndex > 0;
        qualityField.Visible = source.SelectedIndex == 1;
        portField.Visible = pathField.Visible = source.SelectedIndex == 2;
        hint.Text = source.SelectedIndex == 0
            ? "Use a phone camera with the game’s QR code. Any saved IP camera details stay available."
            : source.SelectedIndex == 1
                ? "Connect the camera and this PC to the same network. Use the local Camera Account from the Tapo app."
                : "Enter a private IP or paste a local RTSP address. Leave the login blank for anonymous access.";
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        ShowSource();
    }

    private void ShowMessage(string text, bool error)
    {
        message.Text = text;
        message.ForeColor = error ? ErrorColor : Muted;
    }

    private Dictionary<string, object> ReadSource()
    {
        if (source.SelectedIndex == 0) return CameraInputs.Phone();
        ParsePastedAddress();
        if (addressError != null) throw new InvalidDataException(addressError);
        var host = address.Text.Trim();
        if (!CameraInputs.PrivateIPv4(host)) throw new InvalidDataException("Enter the camera’s private IPv4 address, such as 192.168.1.20.");
        var degrees = rotation.SelectedIndex * 90;
        if (source.SelectedIndex == 1) {
            if (String.IsNullOrWhiteSpace(username.Text) || String.IsNullOrEmpty(password.Text))
                throw new InvalidDataException("Enter the username and password from the Tapo app’s Camera Account.");
            return CameraInputs.Tapo(host, username.Text, password.Text, quality.SelectedIndex == 0 ? "stream1" : "stream2", degrees);
        }
        int value;
        if (!Int32.TryParse(port.Text, out value) || value < 1 || value > 65535)
            throw new InvalidDataException("Enter an RTSP port from 1 to 65535.");
        if (!CameraInputs.ValidPath(path.Text))
            throw new InvalidDataException("Enter an RTSP path starting with /, such as /live.");
        return CameraInputs.Rtsp(host, value, username.Text, password.Text, path.Text, degrees);
    }

    private void ParsePastedAddress()
    {
        if (source.SelectedIndex == 0 || !address.Text.Trim().StartsWith("rtsp:", StringComparison.OrdinalIgnoreCase)) return;
        try {
            var parsed = CameraInputs.ParseAddress(address.Text, 554, username.Text, password.Text, "/", rotation.SelectedIndex * 90, source.SelectedIndex == 1);
            address.Text = (string)parsed["host"];
            username.Text = (string)parsed["username"];
            password.Text = (string)parsed["password"];
            source.SelectedIndex = (string)parsed["kind"] == "tapo" ? 1 : 2;
            if (source.SelectedIndex == 1) quality.SelectedIndex = (string)parsed["stream"] == "stream2" ? 1 : 0;
            else {
                port.Text = parsed["port"].ToString();
                path.Text = (string)parsed["path"];
                advanced.Visible = true;
            }
        } catch {
            address.Clear();
            addressError = "Check the pasted RTSP address. Enter the camera’s private IP and login separately if needed.";
            ShowMessage(addressError, true);
        }
    }

    private static TableLayoutPanel Stack(Padding padding)
    {
        var panel = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 1, Padding = padding, Margin = Padding.Empty, GrowStyle = TableLayoutPanelGrowStyle.AddRows };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        return panel;
    }
    private static Label Caption(string text, Color color)
    {
        return new Label { Text = text, ForeColor = color, AutoSize = true, Dock = DockStyle.Top, Margin = new Padding(0, 2, 0, 6) };
    }
    private static ComboBox Select(TableLayoutPanel parent, string label, params string[] choices)
    {
        var group = Stack(new Padding(0, 0, 0, 6));
        parent.Controls.Add(group);
        group.Controls.Add(Caption(label, Ink));
        var box = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Field, ForeColor = Ink,
            FlatStyle = FlatStyle.Flat, Dock = DockStyle.Top, MinimumSize = new Size(0, 44), Margin = Padding.Empty,
            AccessibleName = label, DrawMode = DrawMode.OwnerDrawFixed, ItemHeight = 39 };
        box.DrawItem += (s, e) => {
            if (e.Index < 0) return;
            var selected = (e.State & DrawItemState.Selected) != 0;
            using (var background = new SolidBrush(selected ? Border : Field)) e.Graphics.FillRectangle(background, e.Bounds);
            TextRenderer.DrawText(e.Graphics, box.Items[e.Index].ToString(), box.Font, e.Bounds, Ink,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            e.DrawFocusRectangle();
        };
        box.Items.AddRange(choices);
        box.SelectedIndex = 0;
        group.Controls.Add(box);
        return box;
    }
    private static TextBox Input(TableLayoutPanel parent, string label, int length, bool secret = false)
    {
        var group = Stack(new Padding(0, 0, 0, 6));
        parent.Controls.Add(group);
        group.Controls.Add(Caption(label, Ink));
        var container = new Panel { Dock = DockStyle.Top, Height = 44, BackColor = Field, Padding = new Padding(10, 10, 10, 0), Margin = Padding.Empty };
        var box = new TextBox { Dock = DockStyle.Top, BorderStyle = BorderStyle.None, BackColor = Field, ForeColor = Ink,
            MaxLength = length, UseSystemPasswordChar = secret, AccessibleName = label };
        container.Controls.Add(box);
        container.Click += (s, e) => box.Focus();
        box.Enter += (s, e) => container.Invalidate();
        box.Leave += (s, e) => container.Invalidate();
        container.Paint += (s, e) => {
            using (var pen = new Pen(box.Focused ? Accent : Border))
                e.Graphics.DrawRectangle(pen, 0, 0, container.ClientSize.Width - 1, container.ClientSize.Height - 1);
        };
        group.Controls.Add(container);
        return box;
    }
    private static Button ActionButton(string text, bool primary)
    {
        var button = new Button { Text = text, Dock = DockStyle.Top, Height = 44, MinimumSize = new Size(0, 44),
            FlatStyle = FlatStyle.Flat, BackColor = primary ? Accent : Field, ForeColor = primary ? Canvas : Ink,
            UseVisualStyleBackColor = false, Margin = new Padding(0, 2, 6, 2), Cursor = Cursors.Hand };
        button.FlatAppearance.BorderColor = primary ? Accent : Border;
        return button;
    }
}
