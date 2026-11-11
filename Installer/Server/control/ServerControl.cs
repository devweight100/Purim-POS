// Purim POS Server - control panel for the server machine (Windows, .NET Framework 4.x).
// Built (C# 5, .NET Framework 4.x) by Installer/build-installers.ps1 with csc on Windows / GitHub Actions, or by
// Installer/build-installers.sh with mono mcs; installed as "<install dir>\Purim POS Server.exe". Keep it C# 5.
//
//   Purim POS Server.exe              open the control panel
//   Purim POS Server.exe --autostart  (Windows logon) start the server hidden and stay in the tray
//
// The real work is done by Installer\Server\setup\purim-server.js (database, backend, frontend,
// auto-restart, logs). This program starts/stops it without a console window and shows status.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace PurimPos
{
    static class Program
    {
        const string MutexName = "PurimPOS.ServerControl.Instance";
        const string ShowEventName = "PurimPOS.ServerControl.Show";

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main(string[] args)
        {
            bool autostart = args.Any(a => a.Equals("--autostart", StringComparison.OrdinalIgnoreCase));
            bool created;
            using (var mutex = new Mutex(true, MutexName, out created))
            {
                if (!created)
                {
                    // already open: ask that window to come to the front
                    try { EventWaitHandle.OpenExisting(ShowEventName).Set(); } catch { }
                    return;
                }
                try { SetProcessDPIAware(); } catch { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
                Application.Run(new ControlForm(autostart, showEvent));
                GC.KeepAlive(mutex);
            }
        }
    }

    class ControlForm : Form
    {
        readonly string root;
        readonly string setupDir;
        readonly string logDir;
        readonly bool autostart;
        readonly EventWaitHandle showEvent;
        readonly NotifyIcon tray = new NotifyIcon();
        readonly System.Windows.Forms.Timer poll = new System.Windows.Forms.Timer();

        readonly Label lblServer = new Label();
        readonly Label lblBackend = new Label();
        readonly Label lblFrontend = new Label();
        readonly Label lblVersion = new Label();
        readonly TextBox txtAddresses = new TextBox();
        readonly TextBox txtLog = new TextBox();
        readonly Button btnStart = new Button();
        readonly Button btnStop = new Button();
        readonly Button btnRestart = new Button();
        bool busy;
        bool reallyExit;
        bool announcedReady;
        int checking;

        static readonly Color Green = Color.FromArgb(22, 163, 74);
        static readonly Color Red = Color.FromArgb(220, 38, 38);
        static readonly Color Amber = Color.FromArgb(217, 119, 6);
        static readonly Color Gray = Color.FromArgb(100, 116, 139);

        public ControlForm(bool autostart, EventWaitHandle showEvent)
        {
            this.autostart = autostart;
            this.showEvent = showEvent;
            root = FindRoot();
            setupDir = Path.Combine(root, "Installer", "Server", "setup");
            logDir = Path.Combine(root, "logs");

            Text = "Purim POS Server";
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font(PickFont(), 10f);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            ClientSize = new Size(640, 560);
            BackColor = Color.White;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            BuildUi();

            tray.Icon = Icon ?? SystemIcons.Application;
            tray.Text = "Purim POS Server";
            tray.Visible = true;
            tray.DoubleClick += (s, e) => ShowWindow();
            var menu = new ContextMenuStrip();
            menu.Items.Add("เปิดหน้าควบคุม", null, (s, e) => ShowWindow());
            menu.Items.Add("เปิดแอป ร้านปุริม POS", null, (s, e) => OpenApp());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("เริ่มเซิร์ฟเวอร์", null, (s, e) => StartServer());
            menu.Items.Add("หยุดเซิร์ฟเวอร์", null, (s, e) => StopServer(true));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("ปิดหน้าควบคุม (เซิร์ฟเวอร์ยังทำงานต่อ)", null, (s, e) => { reallyExit = true; Close(); });
            tray.ContextMenuStrip = menu;

            poll.Interval = 3000;
            poll.Tick += (s, e) => RefreshStatus();
            poll.Start();

            // second launch of the exe -> show this window
            var waiter = new Thread(() =>
            {
                while (true)
                {
                    try { showEvent.WaitOne(); } catch { return; }
                    try { BeginInvoke((Action)ShowWindow); } catch { return; }
                }
            });
            waiter.IsBackground = true;
            waiter.Start();
        }

        // ------------------------------------------------------------------ layout
        void BuildUi()
        {
            var title = new Label { Text = "ร้านปุริม POS — เซิร์ฟเวอร์ (เครื่องแม่)", Font = new Font(Font.FontFamily, 15f, FontStyle.Bold), ForeColor = Color.FromArgb(30, 41, 59), AutoSize = false, Location = new Point(20, 12), Size = new Size(600, 34) };
            Controls.Add(title);
            lblVersion.SetBounds(22, 48, 600, 22);
            lblVersion.AutoEllipsis = true;
            lblVersion.ForeColor = Gray;
            Controls.Add(lblVersion);

            var status = new GroupBox { Text = "สถานะ", Location = new Point(20, 78), Size = new Size(600, 110) };
            Controls.Add(status);
            AddStatusRow(status, "เซิร์ฟเวอร์", lblServer, 26);
            AddStatusRow(status, "ระบบหลังบ้าน + ฐานข้อมูล", lblBackend, 52);
            AddStatusRow(status, "หน้าจอขาย (พอร์ต 3000)", lblFrontend, 78);

            btnStart.Text = "▶  เริ่มเซิร์ฟเวอร์";
            btnStop.Text = "■  หยุดเซิร์ฟเวอร์";
            btnRestart.Text = "↻  รีสตาร์ท";
            StyleButton(btnStart, new Point(20, 200), Green);
            StyleButton(btnStop, new Point(222, 200), Red);
            StyleButton(btnRestart, new Point(424, 200), Color.FromArgb(37, 99, 235));
            btnStart.Click += (s, e) => StartServer();
            btnStop.Click += (s, e) => StopServer(true);
            btnRestart.Click += (s, e) => RestartServer();

            MakeLink("เปิดแอป ร้านปุริม POS", new Point(20, 258), (s, e) => OpenApp());
            MakeLink("มอนิเตอร์ร้าน", new Point(222, 258), (s, e) => OpenUrl("http://localhost:3000/monitor"));
            MakeLink("โฟลเดอร์ log / ไฟล์สำรอง", new Point(424, 258), (s, e) => OpenFolder(root));

            var addrLabel = new Label { Text = "เครื่องลูกเชื่อมต่อที่ (แอปเครื่องลูกค้นหาให้อัตโนมัติ):", AutoSize = true, Location = new Point(20, 306), ForeColor = Gray };
            Controls.Add(addrLabel);
            txtAddresses.SetBounds(20, 328, 600, 46);
            txtAddresses.Multiline = true;
            txtAddresses.ReadOnly = true;
            txtAddresses.BorderStyle = BorderStyle.FixedSingle;
            txtAddresses.BackColor = Color.FromArgb(248, 250, 252);
            txtAddresses.Font = new Font("Consolas", 10.5f, FontStyle.Bold);
            Controls.Add(txtAddresses);

            var logLabel = new Label { Text = "บันทึกการทำงานล่าสุด:", AutoSize = true, Location = new Point(20, 384), ForeColor = Gray };
            Controls.Add(logLabel);
            txtLog.SetBounds(20, 406, 600, 104);
            txtLog.Multiline = true;
            txtLog.ReadOnly = true;
            txtLog.ScrollBars = ScrollBars.Vertical;
            txtLog.BorderStyle = BorderStyle.FixedSingle;
            txtLog.BackColor = Color.FromArgb(15, 23, 42);
            txtLog.ForeColor = Color.FromArgb(203, 213, 225);
            txtLog.Font = new Font(PickFont(), 9f);
            Controls.Add(txtLog);

            var repair = new LinkLabel { Text = "ติดตั้งหรือซ่อมระบบ", AutoSize = true, Location = new Point(20, 524) };
            repair.LinkClicked += (s, e) => RunRepair();
            Controls.Add(repair);
            var hint = new Label { Text = "ปิดหน้าต่างนี้ได้ — เซิร์ฟเวอร์ยังทำงานต่อ (ไอคอนอยู่ที่มุมขวาล่าง)", AutoSize = true, Location = new Point(200, 524), ForeColor = Gray };
            Controls.Add(hint);
        }

        void AddStatusRow(Control parent, string name, Label value, int y)
        {
            parent.Controls.Add(new Label { Text = name, Location = new Point(16, y), Size = new Size(260, 22) });
            value.Location = new Point(280, y);
            value.Size = new Size(310, 22);
            value.Font = new Font(Font, FontStyle.Bold);
            value.Text = "…";
            parent.Controls.Add(value);
        }

        void StyleButton(Button b, Point at, Color color)
        {
            b.Location = at;
            b.Size = new Size(196, 46);
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 0;
            b.BackColor = color;
            b.ForeColor = Color.White;
            b.Font = new Font(Font.FontFamily, 11f, FontStyle.Bold);
            b.Cursor = Cursors.Hand;
            Controls.Add(b);
        }

        Button MakeLink(string text, Point at, EventHandler onClick)
        {
            var b = new Button { Text = text, Location = at, Size = new Size(196, 36), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(241, 245, 249), Cursor = Cursors.Hand };
            b.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
            b.Click += onClick;
            Controls.Add(b);
            return b;
        }

        static string PickFont()
        {
            foreach (var name in new[] { "Leelawadee UI", "Leelawadee", "Tahoma" })
            {
                using (var f = new Font(name, 10f))
                {
                    if (f.Name == name) return name;
                }
            }
            return SystemFonts.DefaultFont.Name;
        }

        // ------------------------------------------------------------------ lifecycle
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            RefreshStatus();
            if (autostart)
            {
                Hide();
                ShowInTaskbar = false;
                if (!LauncherRunning()) StartServer();
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!reallyExit && e.CloseReason == CloseReason.UserClosing)
            {
                // keep running in the tray
                e.Cancel = true;
                Hide();
                ShowInTaskbar = false;
                tray.ShowBalloonTip(2500, "Purim POS Server", "ย่อไว้ที่มุมขวาล่าง — เซิร์ฟเวอร์ยังทำงานต่อ", ToolTipIcon.Info);
                return;
            }
            tray.Visible = false;
            base.OnFormClosing(e);
        }

        void ShowWindow()
        {
            ShowInTaskbar = true;
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
            RefreshStatus();
        }

        // ------------------------------------------------------------------ paths & processes
        static string FindRoot()
        {
            string dir = Path.GetDirectoryName(Application.ExecutablePath);
            for (int i = 0; i < 5 && dir != null; i++)
            {
                if (File.Exists(Path.Combine(dir, "Installer", "Server", "setup", "purim-server.js"))) return dir;
                dir = Path.GetDirectoryName(dir);
            }
            return Path.GetDirectoryName(Application.ExecutablePath);
        }

        static string FindNode()
        {
            var candidates = new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("ProgramW6432") ?? "C:\\Program Files", "nodejs", "node.exe"),
            };
            foreach (var c in candidates) if (File.Exists(c)) return c;
            foreach (var p in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                try
                {
                    var f = Path.Combine(p.Trim(), "node.exe");
                    if (File.Exists(f)) return f;
                }
                catch { }
            }
            return "node.exe";
        }

        string LauncherScript { get { return Path.Combine(setupDir, "purim-server.js"); } }

        bool LauncherRunning()
        {
            try
            {
                var pidText = File.ReadAllText(Path.Combine(logDir, "purim-server.pid")).Trim();
                int pid;
                if (!int.TryParse(pidText, out pid)) return false;
                var p = Process.GetProcessById(pid);
                return !p.HasExited;
            }
            catch { return false; }
        }

        Process RunNode(string args)
        {
            var psi = new ProcessStartInfo(FindNode(), "\"" + LauncherScript + "\"" + (args.Length > 0 ? " " + args : ""))
            {
                WorkingDirectory = setupDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            return Process.Start(psi);
        }

        // ------------------------------------------------------------------ actions
        void StartServer()
        {
            if (busy) return;
            if (!File.Exists(LauncherScript))
            {
                MessageBox.Show(this, "ไม่พบไฟล์ระบบ: " + LauncherScript + "\nกรุณารัน \"ติดตั้งหรือซ่อมระบบ\"", "Purim POS Server", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            if (LauncherRunning()) { RefreshStatus(); return; }
            try
            {
                announcedReady = false;
                RunNode("");
                SetBusy(true, "กำลังเริ่ม…");
                // the launcher writes its pid file almost immediately; status polling shows progress
                var t = new System.Windows.Forms.Timer { Interval = 2500 };
                t.Tick += (s, e) => { t.Stop(); t.Dispose(); SetBusy(false, null); RefreshStatus(); };
                t.Start();
            }
            catch (Exception ex)
            {
                SetBusy(false, null);
                MessageBox.Show(this, "เริ่มเซิร์ฟเวอร์ไม่ได้: " + ex.Message + "\n(ตรวจว่าติดตั้ง Node.js แล้ว หรือรัน \"ติดตั้งหรือซ่อมระบบ\")", "Purim POS Server", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        void StopServer(bool ask)
        {
            if (busy) return;
            if (ask && Visible)
            {
                var r = MessageBox.Show(this, "หยุดเซิร์ฟเวอร์?\nเครื่องขายทุกเครื่องจะใช้งานไม่ได้จนกว่าจะเปิดใหม่", "Purim POS Server", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (r != DialogResult.Yes) return;
            }
            SetBusy(true, "กำลังหยุด…");
            var worker = new Thread(() =>
            {
                try
                {
                    var p = RunNode("--stop");
                    p.WaitForExit(15000);
                }
                catch { }
                try { BeginInvoke((Action)(() => { SetBusy(false, null); RefreshStatus(); })); } catch { }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        void RestartServer()
        {
            if (busy) return;
            SetBusy(true, "กำลังรีสตาร์ท…");
            var worker = new Thread(() =>
            {
                try { RunNode("--stop").WaitForExit(15000); } catch { }
                Thread.Sleep(1500);
                try { BeginInvoke((Action)(() => { SetBusy(false, null); StartServer(); })); } catch { }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        void SetBusy(bool on, string text)
        {
            busy = on;
            btnStart.Enabled = btnStop.Enabled = btnRestart.Enabled = !on;
            if (on && text != null) { lblServer.Text = text; lblServer.ForeColor = Amber; }
            Cursor = on ? Cursors.WaitCursor : Cursors.Default;
        }

        void OpenApp()
        {
            var exe = Path.Combine(Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Purim POS", "Purim POS.exe");
            if (File.Exists(exe)) { try { Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true }); return; } catch { } }
            OpenUrl("http://localhost:3000/pos");
        }

        static void OpenUrl(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        static void OpenFolder(string dir)
        {
            try { Process.Start(new ProcessStartInfo("explorer.exe", "\"" + dir + "\"") { UseShellExecute = true }); } catch { }
        }

        void RunRepair()
        {
            var script = Path.Combine(setupDir, "install-server.ps1");
            var ps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            try
            {
                Process.Start(new ProcessStartInfo(ps, "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -InstallDir \"" + root + "\" -Pause") { UseShellExecute = true, Verb = "runas" });
            }
            catch { }
        }

        // ------------------------------------------------------------------ status
        void RefreshStatus()
        {
            if (Interlocked.Exchange(ref checking, 1) == 1) return;
            var worker = new Thread(() =>
            {
                bool launcher = LauncherRunning();
                string versionJson = HttpGet("http://127.0.0.1:3001/api/version");
                bool frontend = HttpGet("http://127.0.0.1:3000/login") != null;
                string tail = TailLog(Path.Combine(logDir, "launcher.log"), 12);
                string addresses = string.Join("\r\n", LanAddresses().Select(ip => "http://" + ip + ":3000"));
                try
                {
                    BeginInvoke((Action)(() => ApplyStatus(launcher, versionJson, frontend, tail, addresses)));
                }
                catch { }
                Interlocked.Exchange(ref checking, 0);
            });
            worker.IsBackground = true;
            worker.Start();
        }

        void ApplyStatus(bool launcher, string versionJson, bool frontend, string tail, string addresses)
        {
            bool backend = versionJson != null;
            if (!busy)
            {
                if (launcher && backend && frontend) { lblServer.Text = "● ทำงานอยู่"; lblServer.ForeColor = Green; }
                else if (launcher) { lblServer.Text = "● กำลังเริ่ม / มีบางส่วนไม่ตอบ"; lblServer.ForeColor = Amber; }
                else if (backend || frontend) { lblServer.Text = "● ทำงานอยู่ (เปิดจากที่อื่น)"; lblServer.ForeColor = Green; }
                else { lblServer.Text = "● หยุดอยู่"; lblServer.ForeColor = Red; }
            }
            lblBackend.Text = backend ? "● พร้อม" : "● ไม่ตอบ";
            lblBackend.ForeColor = backend ? Green : (launcher ? Amber : Gray);
            lblFrontend.Text = frontend ? "● พร้อม" : "● ไม่ตอบ";
            lblFrontend.ForeColor = frontend ? Green : (launcher ? Amber : Gray);
            string label = JsonString(versionJson, "label");
            lblVersion.Text = label != null ? "เวอร์ชัน " + label + "   ·   โฟลเดอร์: " + root : "โฟลเดอร์: " + root;
            if (txtAddresses.Text != addresses) txtAddresses.Text = addresses.Length > 0 ? addresses : "(ไม่พบการเชื่อมต่อเครือข่าย)";
            if (txtLog.Text != tail)
            {
                txtLog.Text = tail;
                txtLog.SelectionStart = txtLog.TextLength;
                txtLog.ScrollToCaret();
            }
            bool running = backend && frontend;
            btnStart.Enabled = !busy && !launcher && !running;
            btnStop.Enabled = !busy && (launcher || running);
            btnRestart.Enabled = !busy && (launcher || running);
            tray.Text = running ? "Purim POS Server — ทำงานอยู่" : launcher ? "Purim POS Server — กำลังเริ่ม" : "Purim POS Server — หยุดอยู่";
            if (running && !announcedReady)
            {
                announcedReady = true;
                if (!Visible) tray.ShowBalloonTip(3000, "Purim POS Server", "เซิร์ฟเวอร์พร้อมใช้งาน", ToolTipIcon.Info);
            }
            if (!running) announcedReady = false;
        }

        static string HttpGet(string url)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 2000;
                req.ReadWriteTimeout = 2000;
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    return r.ReadToEnd();
                }
            }
            catch (WebException ex)
            {
                // a 401/404 still means the server answered
                var res = ex.Response as HttpWebResponse;
                if (res != null && (int)res.StatusCode < 500) return "";
                return null;
            }
            catch { return null; }
        }

        static string JsonString(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var marker = "\"" + key + "\":\"";
            int i = json.IndexOf(marker, StringComparison.Ordinal);
            if (i < 0) return null;
            i += marker.Length;
            int j = json.IndexOf('"', i);
            return j > i ? json.Substring(i, j - i).Replace("\\u00b7", "·") : null;
        }

        static string TailLog(string file, int lines)
        {
            try
            {
                using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    long start = Math.Max(0, fs.Length - 8192);
                    fs.Seek(start, SeekOrigin.Begin);
                    using (var r = new StreamReader(fs, Encoding.UTF8))
                    {
                        var all = r.ReadToEnd().Replace("\r", "").Split('\n').Where(l => l.Trim().Length > 0).ToArray();
                        return string.Join("\r\n", all.Skip(Math.Max(0, all.Length - lines)));
                    }
                }
            }
            catch { return "(ยังไม่มีบันทึก)"; }
        }

        static string[] LanAddresses()
        {
            try
            {
                return NetworkInterface.GetAllNetworkInterfaces()
                    .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                    .Where(n => !System.Text.RegularExpressions.Regex.IsMatch(n.Name + " " + n.Description, "vEthernet|WSL|Docker|VirtualBox|VMware|Hyper-V|Bluetooth|Loopback", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                    .SelectMany(n => n.GetIPProperties().UnicastAddresses)
                    .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork)
                    .Select(a => a.Address.ToString())
                    .Where(ip => !ip.StartsWith("127.") && !ip.StartsWith("169.254."))
                    .Distinct()
                    .ToArray();
            }
            catch { return new string[0]; }
        }
    }
}
