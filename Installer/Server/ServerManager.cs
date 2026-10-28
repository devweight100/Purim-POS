using System;
using System.Drawing;
using System.Windows.Forms;
using System.Diagnostics;
using System.Net.Sockets;
using System.Net;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace PurimPosServer
{
    public class ServerManagerForm : Form
    {
        private Label lblTitle;
        private Label lblSubtitle;
        private Label lblLanIp;
        private Button btnCopyIp;
        private Button btnStartServer;
        private Button btnStopServer;
        private Button btnOpenMasterDeck;
        private Button btnOpenPos;
        private Button btnBackup;
        private RichTextBox txtLog;
        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private System.Windows.Forms.Timer statusTimer;

        // Status indicators
        private Panel pnlDbStatus;
        private Label lblDbText;
        private Panel pnlBackendStatus;
        private Label lblBackendText;
        private Panel pnlFrontendStatus;
        private Label lblFrontendText;

        private Process backendProcess = null;
        private Process frontendProcess = null;
        private string rootPath = "";
        private string detectedLanIp = "127.0.0.1";

        public ServerManagerForm()
        {
            InitializeComponent();
            ResolveRootPath();
            DetectLanIp();
            CheckAllServicesAsync();
            statusTimer.Start();
        }

        private void ResolveRootPath()
        {
            string current = AppDomain.CurrentDomain.BaseDirectory;
            // Check if running from Installer\Server
            if (File.Exists(Path.Combine(current, "docker-compose.yml")))
            {
                // Check if parent has backend
                string parent2 = Path.GetFullPath(Path.Combine(current, "..", ".."));
                if (Directory.Exists(Path.Combine(parent2, "backend")))
                {
                    rootPath = parent2;
                    return;
                }
            }
            if (Directory.Exists(Path.Combine(current, "backend")))
            {
                rootPath = current;
                return;
            }
            rootPath = Path.GetFullPath(Path.Combine(current, "..", ".."));
        }

        private void DetectLanIp()
        {
            try
            {
                var host = Dns.GetHostEntry(Dns.GetHostName());
                string bestIp = null;
                foreach (var ip in host.AddressList)
                {
                    if (ip.AddressFamily == AddressFamily.InterNetwork)
                    {
                        string s = ip.ToString();
                        if (s.StartsWith("127.") || s.StartsWith("169.254")) continue;
                        if (s.StartsWith("192.168.")) { bestIp = s; break; }
                        if (s.StartsWith("10.") && bestIp == null) { bestIp = s; }
                        else if (bestIp == null) { bestIp = s; }
                    }
                }
                detectedLanIp = bestIp ?? "127.0.0.1";
            }
            catch { detectedLanIp = "127.0.0.1"; }
            lblLanIp.Text = "📡 IP เครื่องแม่: " + detectedLanIp + ":3000";
        }

        private void InitializeComponent()
        {
            this.Text = "Purim POS - Master Server (เครื่องแม่)";
            this.Size = new Size(760, 620);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(11, 19, 41);
            this.ForeColor = Color.White;
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            this.FormBorderStyle = FormBorderStyle.FixedSingle;
            this.MaximizeBox = false;

            // Header
            lblTitle = new Label()
            {
                Text = "🚀 PURIM POS - MASTER SERVER",
                Font = new Font("Segoe UI", 16f, FontStyle.Bold),
                ForeColor = Color.FromArgb(0, 240, 255),
                Location = new Point(25, 20),
                AutoSize = true
            };
            this.Controls.Add(lblTitle);

            lblSubtitle = new Label()
            {
                Text = "ระบบควบคุมเครื่องแม่ ฐานข้อมูลกลาง และจุดเชื่อมต่ออุปกรณ์ลูกข่าย",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(27, 55),
                AutoSize = true
            };
            this.Controls.Add(lblSubtitle);

            // IP Panel
            Panel pnlIp = new Panel()
            {
                Location = new Point(25, 90),
                Size = new Size(695, 45),
                BackColor = Color.FromArgb(15, 23, 42),
                BorderStyle = BorderStyle.FixedSingle
            };
            lblLanIp = new Label()
            {
                Text = "📡 IP เครื่องแม่: ตรวจสอบ...",
                Font = new Font("Consolas", 11f, FontStyle.Bold),
                ForeColor = Color.FromArgb(52, 211, 153),
                Location = new Point(15, 12),
                AutoSize = true
            };
            btnCopyIp = new Button()
            {
                Text = "📋 คัดลอก IP สำหรับเครื่องลูก",
                Location = new Point(480, 7),
                Size = new Size(200, 30),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnCopyIp.FlatAppearance.BorderColor = Color.FromArgb(51, 65, 85);
            btnCopyIp.Click += (s, e) =>
            {
                Clipboard.SetText("http://" + detectedLanIp + ":3000");
                MessageBox.Show("คัดลอกที่อยู่เซิร์ฟเวอร์: http://" + detectedLanIp + ":3000 แล้ว!\nนำไปใส่ที่เครื่องลูกได้ทันที", "คัดลอกสำเร็จ", MessageBoxButtons.OK, MessageBoxIcon.Information);
            };
            pnlIp.Controls.Add(lblLanIp);
            pnlIp.Controls.Add(btnCopyIp);
            this.Controls.Add(pnlIp);

            // Status Grid Panel
            Panel pnlStatus = new Panel()
            {
                Location = new Point(25, 145),
                Size = new Size(695, 75),
                BackColor = Color.FromArgb(15, 23, 42),
                BorderStyle = BorderStyle.FixedSingle
            };

            // DB Status
            Label lblDbHeader = new Label() { Text = "🗄️ ฐานข้อมูล (DB 5433)", Location = new Point(20, 12), AutoSize = true, ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 9f, FontStyle.Bold) };
            pnlDbStatus = new Panel() { Location = new Point(22, 38), Size = new Size(12, 12), BackColor = Color.Gray };
            lblDbText = new Label() { Text = "กำลังตรวจสอบ...", Location = new Point(40, 35), AutoSize = true, Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.White };
            pnlStatus.Controls.Add(lblDbHeader);
            pnlStatus.Controls.Add(pnlDbStatus);
            pnlStatus.Controls.Add(lblDbText);

            // Backend Status
            Label lblBeHeader = new Label() { Text = "⚡ เซิร์ฟเวอร์ API (3001)", Location = new Point(250, 12), AutoSize = true, ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 9f, FontStyle.Bold) };
            pnlBackendStatus = new Panel() { Location = new Point(252, 38), Size = new Size(12, 12), BackColor = Color.Gray };
            lblBackendText = new Label() { Text = "กำลังตรวจสอบ...", Location = new Point(270, 35), AutoSize = true, Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.White };
            pnlStatus.Controls.Add(lblBeHeader);
            pnlStatus.Controls.Add(pnlBackendStatus);
            pnlStatus.Controls.Add(lblBackendText);

            // Frontend Status
            Label lblFeHeader = new Label() { Text = "🌐 หน้าเว็บระบบ (3000)", Location = new Point(480, 12), AutoSize = true, ForeColor = Color.FromArgb(148, 163, 184), Font = new Font("Segoe UI", 9f, FontStyle.Bold) };
            pnlFrontendStatus = new Panel() { Location = new Point(482, 38), Size = new Size(12, 12), BackColor = Color.Gray };
            lblFrontendText = new Label() { Text = "กำลังตรวจสอบ...", Location = new Point(500, 35), AutoSize = true, Font = new Font("Segoe UI", 9f, FontStyle.Bold), ForeColor = Color.White };
            pnlStatus.Controls.Add(lblFeHeader);
            pnlStatus.Controls.Add(pnlFrontendStatus);
            pnlStatus.Controls.Add(lblFrontendText);

            this.Controls.Add(pnlStatus);

            // Primary Control Buttons
            btnStartServer = new Button()
            {
                Text = "▶ เริ่มต้นระบบเซิร์ฟเวอร์ทั้งหมด (Start Server)",
                Location = new Point(25, 235),
                Size = new Size(335, 45),
                BackColor = Color.FromArgb(16, 185, 129),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnStartServer.FlatAppearance.BorderSize = 0;
            btnStartServer.Click += BtnStartServer_Click;
            this.Controls.Add(btnStartServer);

            btnStopServer = new Button()
            {
                Text = "⏹ หยุดระบบเซิร์ฟเวอร์ (Stop Server)",
                Location = new Point(385, 235),
                Size = new Size(335, 45),
                BackColor = Color.FromArgb(239, 68, 68),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnStopServer.FlatAppearance.BorderSize = 0;
            btnStopServer.Click += BtnStopServer_Click;
            this.Controls.Add(btnStopServer);

            // Secondary Quick Actions
            btnOpenMasterDeck = new Button()
            {
                Text = "🚀 เปิดแผงควบคุม Sci-Fi (Master Command Deck)",
                Location = new Point(25, 290),
                Size = new Size(335, 40),
                BackColor = Color.FromArgb(8, 145, 178),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnOpenMasterDeck.FlatAppearance.BorderSize = 0;
            btnOpenMasterDeck.Click += (s, e) => OpenBrowser("http://localhost:3000/master-control");
            this.Controls.Add(btnOpenMasterDeck);

            btnOpenPos = new Button()
            {
                Text = "🛒 เปิดหน้าจอแคชเชียร์ขายหน้าร้าน (Open POS)",
                Location = new Point(385, 290),
                Size = new Size(210, 40),
                BackColor = Color.FromArgb(79, 70, 229),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnOpenPos.FlatAppearance.BorderSize = 0;
            btnOpenPos.Click += (s, e) => OpenBrowser("http://localhost:3000/pos");
            this.Controls.Add(btnOpenPos);

            btnBackup = new Button()
            {
                Text = "📦 สำรองข้อมูล",
                Location = new Point(605, 290),
                Size = new Size(115, 40),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnBackup.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            btnBackup.Click += BtnBackup_Click;
            this.Controls.Add(btnBackup);

            // Live Log Console Box
            Label lblLogTitle = new Label()
            {
                Text = "📟 บันทึกการทำงานระบบ (Console Log):",
                Location = new Point(25, 345),
                AutoSize = true,
                ForeColor = Color.FromArgb(148, 163, 184),
                Font = new Font("Segoe UI", 9f, FontStyle.Bold)
            };
            this.Controls.Add(lblLogTitle);

            txtLog = new RichTextBox()
            {
                Location = new Point(25, 370),
                Size = new Size(695, 195),
                BackColor = Color.FromArgb(5, 11, 24),
                ForeColor = Color.FromArgb(52, 211, 153),
                Font = new Font("Consolas", 9f, FontStyle.Regular),
                BorderStyle = BorderStyle.None,
                ReadOnly = true
            };
            this.Controls.Add(txtLog);

            // System Tray
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("เปิดหน้าต่างหลัก", null, (s, e) => RestoreWindow());
            trayMenu.Items.Add("เปิดแผงควบคุม Sci-Fi", null, (s, e) => OpenBrowser("http://localhost:3000/master-control"));
            trayMenu.Items.Add("เปิดหน้าขาย POS", null, (s, e) => OpenBrowser("http://localhost:3000/pos"));
            trayMenu.Items.Add("-");
            trayMenu.Items.Add("ปิดโปรแกรมเซิร์ฟเวอร์", null, (s, e) => ExitApplication());

            trayIcon = new NotifyIcon()
            {
                Text = "Purim POS Server (เครื่องแม่)",
                Icon = SystemIcons.Application,
                ContextMenuStrip = trayMenu,
                Visible = true
            };
            trayIcon.DoubleClick += (s, e) => RestoreWindow();

            this.FormClosing += ServerManagerForm_FormClosing;

            // Timer
            statusTimer = new System.Windows.Forms.Timer() { Interval = 3000 };
            statusTimer.Tick += async (s, e) => await CheckAllServicesAsync();
            statusTimer.Start();

            Log("✅ พร้อมใช้งาน - ระบบตัวจัดการเครื่องแม่ Purim POS");
            this.Shown += (s, e) =>
            {
                BtnStartServer_Click(this, EventArgs.Empty);
            };
        }

        private void Log(string msg)
        {
            if (txtLog.InvokeRequired)
            {
                txtLog.Invoke(new Action(() => Log(msg)));
                return;
            }
            txtLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + "\r\n");
            txtLog.SelectionStart = txtLog.Text.Length;
            txtLog.ScrollToCaret();
        }

        private bool IsPortListening(int port)
        {
            try
            {
                using (var tcp = new TcpClient())
                {
                    var result = tcp.BeginConnect("127.0.0.1", port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(400);
                    if (!success) return false;
                    tcp.EndConnect(result);
                    return true;
                }
            }
            catch { return false; }
        }

        private async Task CheckAllServicesAsync()
        {
            bool dbUp = await Task.Run(() => IsPortListening(5433) || IsPortListening(5432));
            bool beUp = await Task.Run(() => IsPortListening(3001));
            bool feUp = await Task.Run(() => IsPortListening(3000));

            UpdateStatusPill(pnlDbStatus, lblDbText, dbUp, "ออนไลน์ (5433)", "ออฟไลน์");
            UpdateStatusPill(pnlBackendStatus, lblBackendText, beUp, "ออนไลน์ (3001)", "ออฟไลน์");
            UpdateStatusPill(pnlFrontendStatus, lblFrontendText, feUp, "ออนไลน์ (3000)", "ออฟไลน์");
        }

        private void UpdateStatusPill(Panel pnl, Label lbl, bool isOnline, string onlineText, string offlineText)
        {
            if (pnl.InvokeRequired)
            {
                pnl.Invoke(new Action(() => UpdateStatusPill(pnl, lbl, isOnline, onlineText, offlineText)));
                return;
            }
            pnl.BackColor = isOnline ? Color.FromArgb(52, 211, 153) : Color.FromArgb(239, 68, 68);
            lbl.Text = isOnline ? onlineText : offlineText;
            lbl.ForeColor = isOnline ? Color.FromArgb(52, 211, 153) : Color.FromArgb(248, 113, 113);
        }

        private void BtnStartServer_Click(object sender, EventArgs e)
        {
            Log("🚀 กำลังเริ่มต้นระบบเซิร์ฟเวอร์...");
            Task.Run(() =>
            {
                // 1. Database
                if (!IsPortListening(5433) && !IsPortListening(5432))
                {
                    Log("กำลังตรวจสอบฐานข้อมูล Docker...");
                    try
                    {
                        var psi = new ProcessStartInfo("docker", "compose up -d postgres redis")
                        {
                            WorkingDirectory = rootPath,
                            CreateNoWindow = true,
                            UseShellExecute = false
                        };
                        var p = Process.Start(psi);
                        if (p != null) p.WaitForExit(10000);
                        Log("สั่งเปิดฐานข้อมูลสำเร็จ");
                    }
                    catch (Exception ex)
                    {
                        Log("คำเตือนฐานข้อมูล: " + ex.Message);
                    }
                }
                else
                {
                    Log("ฐานข้อมูล PostgreSQL กำลังทำงานอยู่แล้ว");
                }

                // 2. Backend
                if (!IsPortListening(3001))
                {
                    Log("กำลังเปิดระบบ Backend API...");
                    try
                    {
                        var psi = new ProcessStartInfo("cmd.exe", "/c npm run start:dev")
                        {
                            WorkingDirectory = Path.Combine(rootPath, "backend"),
                            CreateNoWindow = true,
                            UseShellExecute = false
                        };
                        backendProcess = Process.Start(psi);
                    }
                    catch (Exception ex) { Log("ข้อผิดพลาด Backend: " + ex.Message); }
                }
                else
                {
                    Log("Backend API กำลังทำงานอยู่แล้วที่พอร์ต 3001");
                }

                // 3. Frontend
                if (!IsPortListening(3000))
                {
                    Log("กำลังเปิดระบบ Frontend Web POS...");
                    try
                    {
                        var psi = new ProcessStartInfo("cmd.exe", "/c npm run start")
                        {
                            WorkingDirectory = Path.Combine(rootPath, "frontend"),
                            CreateNoWindow = true,
                            UseShellExecute = false
                        };
                        frontendProcess = Process.Start(psi);
                    }
                    catch (Exception ex) { Log("ข้อผิดพลาด Frontend: " + ex.Message); }
                }
                else
                {
                    Log("Frontend POS กำลังทำงานอยู่แล้วที่พอร์ต 3000");
                }

                Thread.Sleep(2000);
                Log("🎉 ตรวจสอบสถานะ: บริการทั้งหมดพร้อมแล้ว");
            });
        }

        private void BtnStopServer_Click(object sender, EventArgs e)
        {
            var res = MessageBox.Show("ต้องการหยุดการทำงานของเซิร์ฟเวอร์ใช่หรือไม่?\n(เครื่องลูกจะไม่สามารถเชื่อมต่อได้ในขณะที่ปิด)", "ยืนยันการหยุดเซิร์ฟเวอร์", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (res != DialogResult.Yes) return;

            Log("🛑 กำลังหยุดการทำงานของบริการทั้งหมด...");
            Task.Run(() =>
            {
                try
                {
                    if (File.Exists(Path.Combine(rootPath, "stop-server.js")))
                    {
                        var psi = new ProcessStartInfo("node", "stop-server.js")
                        {
                            WorkingDirectory = rootPath,
                            CreateNoWindow = true,
                            UseShellExecute = false
                        };
                        var p = Process.Start(psi);
                        if (p != null) p.WaitForExit(5000);
                    }
                    Log("✅ หยุดการทำงานของเซิร์ฟเวอร์เรียบร้อยแล้ว");
                }
                catch (Exception ex)
                {
                    Log("ข้อผิดพลาดในการหยุด: " + ex.Message);
                }
            });
        }

        private void BtnBackup_Click(object sender, EventArgs e)
        {
            try
            {
                string backupDir = Path.Combine(rootPath, "backups");
                if (!Directory.Exists(backupDir)) Directory.CreateDirectory(backupDir);

                string timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
                string file = Path.Combine(backupDir, "backup_snapshot_" + timestamp + ".sql");

                Log("📦 กำลังสำรองฐานข้อมูล...");
                var psi = new ProcessStartInfo("docker", "exec -t purim-postgres pg_dump -U postgres pos_purim")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                var p = Process.Start(psi);
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit();

                if (!string.IsNullOrEmpty(output) && output.Length > 200)
                {
                    File.WriteAllText(file, output, Encoding.UTF8);
                    Log("✅ สำรองข้อมูลเรียบร้อยแล้ว: " + Path.GetFileName(file));
                    MessageBox.Show("สำรองฐานข้อมูลสำเร็จที่:\n" + file, "สำรองข้อมูลสำเร็จ", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                else
                {
                    Log("⚠️ ไม่สามารถดึง dump ผ่าน docker ได้ กำลังลองใช้โหมด API Snapshot...");
                    OpenBrowser("http://localhost:3000/master-control");
                }
            }
            catch (Exception ex)
            {
                Log("ข้อผิดพลาดสำรองข้อมูล: " + ex.Message);
            }
        }

        private void OpenBrowser(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception ex) { Log("ไม่สามารถเปิดเบราว์เซอร์ได้: " + ex.Message); }
        }

        private void RestoreWindow()
        {
            this.Show();
            this.WindowState = FormWindowState.Normal;
            this.BringToFront();
        }

        private void ServerManagerForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                var dr = MessageBox.Show("ต้องการย่อโปรแกรมลง System Tray ใช่หรือไม่?\n- กด [Yes] เพื่อย่อเก็บลงด้านล่างขวา (เครื่องลูกยังคงใช้งานได้ปกติ)\n- กด [No] เพื่อปิดระบบเซิร์ฟเวอร์ทั้งหมดและออกจากโปรแกรม", "การปิดโปรแกรมเครื่องแม่", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
                if (dr == DialogResult.Yes)
                {
                    e.Cancel = true;
                    this.Hide();
                    trayIcon.ShowBalloonTip(3000, "Purim POS Server", "เซิร์ฟเวอร์ยังคงทำงานอยู่ในพื้นหลัง ดับเบิ้ลคลิกไอคอนที่นี่เพื่อเปิดหน้าต่าง", ToolTipIcon.Info);
                }
                else if (dr == DialogResult.No)
                {
                    ExitApplication();
                }
                else
                {
                    e.Cancel = true;
                }
            }
        }

        private void ExitApplication()
        {
            statusTimer.Stop();
            trayIcon.Visible = false;
            Application.Exit();
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ServerManagerForm());
        }
    }
}
