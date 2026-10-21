// Aidem pitch: the prompter as its own window on Windows. Compiled at start by prompter.ps1 (Add-Type, C# 5).
// Always on top of every window (the full-screen deck too), never takes the keyboard from the show, and excluded from
// screen capture (WDA_EXCLUDEFROMCAPTURE): a screen share or a recording does not show it. A projector in «Расширить»
// mode does not show it either, since the window stays on the laptop screen. With «Повторить» the projector gets a copy of
// the laptop screen and shows everything, this window included. Built on the Demo Day prompter of 16 October.
// The text comes from the show program: it writes the current piece of the speech to a JSON file several times a second.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AidemPrompter {

static class W {
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr h, uint a);
  [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint a);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern bool ReleaseCapture();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
}

// Text that never takes focus or clicks; a left drag moves the window.
class Box : RichTextBox {
  public Form Owner2;
  protected override void WndProc(ref Message m) {
    const int WM_MOUSEACTIVATE = 0x21, WM_SETFOCUS = 0x7, WM_LBUTTONDOWN = 0x201, WM_LBUTTONDBLCLK = 0x203,
      WM_RBUTTONDOWN = 0x204, WM_RBUTTONUP = 0x205, WM_LBUTTONUP = 0x202, WM_MOUSEMOVE = 0x200, WM_SETCURSOR = 0x20;
    if (m.Msg == WM_MOUSEACTIVATE) { m.Result = (IntPtr)3; return; } // MA_NOACTIVATE
    if (m.Msg == WM_SETFOCUS) return;
    if (m.Msg == WM_LBUTTONDOWN || m.Msg == WM_LBUTTONDBLCLK) {
      W.ReleaseCapture();
      W.SendMessage(Owner2.Handle, 0xA1, (IntPtr)2, IntPtr.Zero); // WM_NCLBUTTONDOWN, HTCAPTION: drag
      return;
    }
    if (m.Msg == WM_LBUTTONUP || m.Msg == WM_RBUTTONDOWN || m.Msg == WM_RBUTTONUP || m.Msg == WM_MOUSEMOVE) return;
    if (m.Msg == WM_SETCURSOR) { Cursor.Current = Cursors.Default; m.Result = (IntPtr)1; return; }
    base.WndProc(ref m);
  }
}

public class PrompterForm : Form {
  readonly string stateFile, settingsFile;
  Box box = new Box();
  Label head = new Label();
  Panel grip = new Panel();
  Timer timer = new Timer();
  float fontSize = 24f;
  double[] opacities = { 0.92, 0.8, 0.65 };
  int opIdx = 0;
  bool captureHidden = false;
  string lastKey = null;
  int seenPid = 0; bool seenAlive = false;
  object lastWanted = null; // the show's «показать / спрятать» switch, followed only when it changes

  const int HK_BIG = 2, HK_SMALL = 3, HK_HIDE = 4, HK_UP = 7, HK_DOWN = 8, HK_QUIT = 9, HK_OPAC = 10;

  public PrompterForm(string dir, string stateFile) {
    this.stateFile = stateFile;
    settingsFile = Path.Combine(dir, "prompter-window.txt");
    Text = "Aidem: суфлёр";
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    TopMost = true;
    StartPosition = FormStartPosition.Manual;
    BackColor = Color.FromArgb(14, 16, 22);
    Rectangle wa = Screen.PrimaryScreen.WorkingArea;
    int w = Math.Min(1100, wa.Width - 80), h = Math.Max(260, wa.Height * 2 / 5);
    Bounds = new Rectangle(wa.Left + (wa.Width - w) / 2, wa.Top + 8, w, h);
    LoadSettings();
    Opacity = opacities[opIdx];
    Padding = new Padding(14, 6, 6, 8);

    head.Dock = DockStyle.Top;
    head.ForeColor = Color.FromArgb(150, 158, 175);
    head.BackColor = BackColor;
    head.AutoEllipsis = true;
    head.MouseDown += (s, e) => { W.ReleaseCapture(); W.SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); };

    box.Owner2 = this;
    box.ReadOnly = true;
    box.BorderStyle = BorderStyle.None;
    box.BackColor = BackColor;
    box.ForeColor = Color.White;
    box.ScrollBars = RichTextBoxScrollBars.Vertical;
    box.TabStop = false;
    box.DetectUrls = false;
    box.Dock = DockStyle.Fill;
    Controls.Add(box);
    Controls.Add(head);

    grip.Size = new Size(18, 18);
    grip.BackColor = Color.FromArgb(60, 66, 80);
    grip.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
    grip.Location = new Point(ClientSize.Width - 18, ClientSize.Height - 18);
    grip.MouseDown += (s, e) => { W.ReleaseCapture(); W.SendMessage(Handle, 0xA1, (IntPtr)17, IntPtr.Zero); }; // HTBOTTOMRIGHT
    Controls.Add(grip);
    grip.BringToFront();
    SetHeadFont();

    timer.Interval = 200;
    timer.Tick += (s, e) => Tick();
    ResizeEnd += (s, e) => SaveSettings();
    Move += (s, e) => SaveSettings();
  }

  void SetHeadFont() {
    head.Font = new Font("Segoe UI", Math.Max(9, fontSize * 0.5f), FontStyle.Bold);
    head.Height = (int)(head.Font.GetHeight() * 1.5f);
  }

  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= 0x08 | 0x80 | 0x08000000; // TOPMOST | TOOLWINDOW | NOACTIVATE
      return cp;
    }
  }

  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    // AIDEM_PROMPTER_TEST_VISIBLE=1 only for checking the layout in a screenshot
    if (Environment.GetEnvironmentVariable("AIDEM_PROMPTER_TEST_VISIBLE") != "1")
      captureHidden = W.SetWindowDisplayAffinity(Handle, 0x11); // WDA_EXCLUDEFROMCAPTURE, Windows 10 2004 and later
    uint a; if (W.GetWindowDisplayAffinity(Handle, out a)) captureHidden = captureHidden && a == 0x11;
    uint M = 0x0002 | 0x0001 | 0x4000; // CONTROL | ALT | NOREPEAT
    Reg(HK_BIG, M, 0xBB, "Ctrl+Alt+=");
    Reg(HK_SMALL, M, 0xBD, "Ctrl+Alt+-");
    Reg(HK_HIDE, M, (uint)Keys.H, "Ctrl+Alt+H");
    Reg(HK_UP, M, (uint)Keys.PageUp, "Ctrl+Alt+PgUp");
    Reg(HK_DOWN, M, (uint)Keys.PageDown, "Ctrl+Alt+PgDn");
    Reg(HK_QUIT, M, (uint)Keys.Q, "Ctrl+Alt+Q");
    Reg(HK_OPAC, M, (uint)Keys.O, "Ctrl+Alt+O");
    timer.Start();
    Tick();
  }

  List<string> busy = new List<string>();
  void Reg(int id, uint mod, uint vk, string name) { if (!W.RegisterHotKey(Handle, id, mod, vk)) busy.Add(name); }

  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x21) { m.Result = (IntPtr)3; return; } // WM_MOUSEACTIVATE: no activate
    if (m.Msg == 0x312) { OnHotKey(m.WParam.ToInt32()); return; }
    base.WndProc(ref m);
  }

  void OnHotKey(int id) {
    switch (id) {
      case HK_BIG: fontSize = Math.Min(60, fontSize + 2); SetHeadFont(); break;
      case HK_SMALL: fontSize = Math.Max(10, fontSize - 2); SetHeadFont(); break;
      case HK_HIDE: if (Visible) Hide(); else { Show(); KeepOnTop(); } break;
      case HK_UP: W.SendMessage(box.Handle, 0xB5, (IntPtr)2, IntPtr.Zero); return; // EM_SCROLL page up
      case HK_DOWN: W.SendMessage(box.Handle, 0xB5, (IntPtr)3, IntPtr.Zero); return;
      case HK_QUIT: Close(); return;
      case HK_OPAC: opIdx = (opIdx + 1) % opacities.Length; Opacity = opacities[opIdx]; break;
    }
    SaveSettings();
    lastKey = null;
    Tick();
  }

  void KeepOnTop() { W.SetWindowPos(Handle, (IntPtr)(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); } // HWND_TOPMOST, NOSIZE|NOMOVE|NOACTIVATE

  protected override void OnFormClosed(FormClosedEventArgs e) {
    for (int i = 1; i <= 10; i++) W.UnregisterHotKey(Handle, i);
    SaveSettings();
    base.OnFormClosed(e);
  }

  // ---------- data ----------
  static object Get(object o, string k) {
    IDictionary<string, object> d = o as IDictionary<string, object>;
    if (d == null || !d.ContainsKey(k)) return null;
    return d[k];
  }
  static string S(object o) { return o == null ? "" : Convert.ToString(o); }

  Dictionary<string, object> ReadState() {
    try {
      if (!File.Exists(stateFile)) return null;
      string txt;
      using (FileStream fs = new FileStream(stateFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
      using (StreamReader r = new StreamReader(fs, Encoding.UTF8)) txt = r.ReadToEnd();
      return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(txt);
    } catch { return null; }
  }

  Dictionary<string, object> st;
  int tick = 0;
  void Tick() {
    if (++tick % 25 == 0 && Visible) KeepOnTop();
    Dictionary<string, object> fresh = ReadState();
    if (fresh != null) st = fresh; // a half-written file: keep the last good one
    string waitNote = null;
    if (st == null) waitNote = "Ждём программу показа…";
    else {
      int pid = Convert.ToInt32(Get(st, "pid") ?? 0);
      bool alive = false;
      try { alive = pid > 0 && !Process.GetProcessById(pid).HasExited; } catch { }
      if (alive) { seenAlive = true; seenPid = pid; }
      else if (seenAlive && pid == seenPid) { Close(); return; } // the show was closed: close too
      else waitNote = "Программа показа не запущена";
      object wanted = Get(st, "visible");
      if (wanted != null && !object.Equals(wanted, lastWanted)) {
        lastWanted = wanted;
        if (Convert.ToBoolean(wanted)) { if (!Visible) Show(); KeepOnTop(); } else if (Visible) Hide();
      }
    }
    RenderHead(waitNote);
    string body = st == null ? "" : new JavaScriptSerializer().Serialize(Get(st, "body"));
    string renderKey = body + "|" + fontSize + "|" + waitNote;
    if (renderKey == lastKey) return;
    lastKey = renderKey;
    RenderBody(st == null ? null : Get(st, "body"), waitNote);
  }

  // ---------- drawing ----------
  Color Gray = Color.FromArgb(150, 158, 175), Cue = Color.FromArgb(90, 200, 255), Hi = Color.FromArgb(255, 214, 90),
        Warn = Color.FromArgb(255, 110, 100), Ok = Color.FromArgb(110, 220, 140), Alt = Color.FromArgb(185, 190, 205);

  void RenderHead(string waitNote) {
    var parts = new List<string>();
    string title = st == null ? "" : S(Get(st, "head"));
    parts.Add(title.Length > 0 ? title : "Aidem · суфлёр");
    object t0 = st == null ? null : Get(st, "t0");
    if (t0 != null) {
      double ms = (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds - Convert.ToDouble(t0);
      int sec = Math.Max(0, (int)(ms / 1000));
      parts.Add(string.Format("{0}:{1:00}", sec / 60, sec % 60) + S(Get(st, "plan")));
    }
    if (st != null && Convert.ToBoolean(Get(st, "paused") ?? false)) parts.Add("⏸ ПАУЗА");
    bool one = st != null && Convert.ToInt32(Get(st, "screens") ?? 0) == 1;
    if (!captureHidden) parts.Add("⚠ НЕ СКРЫТ ОТ ДЕМОНСТРАЦИИ");
    else parts.Add("скрыт от демонстрации ✓");
    if (one) parts.Add("один экран: при «Повторить» окно видно в зале, Ctrl+Alt+H спрятать");
    if (busy.Count > 0) parts.Add("заняты: " + string.Join(", ", busy.ToArray()));
    if (waitNote != null) parts.Add(waitNote);
    string text = string.Join("   ·   ", parts.ToArray());
    if (head.Text != text) head.Text = text;
    Color c = (!captureHidden || one) ? Warn : Gray;
    if (head.ForeColor != c) head.ForeColor = c;
  }

  void Put(string text, float size, Color c, bool bold) {
    box.SelectionStart = box.TextLength; box.SelectionLength = 0;
    box.SelectionFont = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular);
    box.SelectionColor = c;
    box.AppendText(text);
  }

  // **bold** -> gold bold, [stage direction] -> blue
  void Rich(string text, float size, Color baseColor) {
    foreach (string part in Regex.Split(text, @"(\*\*[^*]+\*\*|\[[^\]]+\])")) {
      if (part.Length == 0) continue;
      if (part.StartsWith("**") && part.EndsWith("**") && part.Length > 4) Put(part.Substring(2, part.Length - 4), size, Hi, true);
      else if (part.StartsWith("[") && part.EndsWith("]")) Put(part, size * 0.85f, Cue, true);
      else Put(part.Replace("*", ""), size, baseColor, false);
    }
  }

  void RenderBody(object body, string waitNote) {
    box.SuspendLayout();
    box.Clear();
    float hs = Math.Max(9, fontSize * 0.55f);
    if (body == null) { Put(waitNote ?? "Нет текста", fontSize, Gray, false); box.ResumeLayout(); return; }
    string speaker = S(Get(body, "speaker"));
    string screen = S(Get(body, "screen"));
    string beat = S(Get(body, "beat"));
    if (speaker.Length > 0) Put("Говорит " + speaker + (screen.Length > 0 ? "   " : "\n"), hs * 1.1f, Cue, true);
    if (screen.Length > 0) Put(screen + "\n", hs, Gray, false);
    if (beat.Length > 0) Put(beat + "\n", hs, Ok, true);
    string prev = S(Get(body, "prev"));
    if (prev.Length > 0) { Rich(prev, hs, Gray); Put("\n", hs, Gray, false); }
    ArrayList now = Get(body, "now") as ArrayList;
    if (now != null) {
      bool first = true;
      foreach (object p in now) { if (!first) Put("\n", fontSize * 0.5f, Color.White, false); Rich(S(p).Trim(), fontSize, Color.White); first = false; }
    }
    string next = S(Get(body, "next"));
    if (next.Length > 0) { Put("\n\n→ ", hs * 1.1f, Cue, true); Rich(next, hs * 1.1f, Cue); }
    ArrayList notes = Get(body, "notes") as ArrayList;
    if (notes != null && notes.Count > 0) {
      Put("\n\nЕСЛИ ЧТО-ТО НЕ ТАК", hs, Warn, true);
      foreach (object n in notes) { Put("\n", hs, Gray, false); Rich(S(n), hs, Alt); }
    }
    box.SelectionStart = 0; box.SelectionLength = 0;
    box.ScrollToCaret();
    box.ResumeLayout();
  }

  // ---------- settings: where the window was and its font, kept next to the program ----------
  bool loading = false;
  void LoadSettings() {
    try {
      if (!File.Exists(settingsFile)) return;
      loading = true;
      string[] p = File.ReadAllText(settingsFile).Trim().Split(',');
      Rectangle r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
      bool onScreen = false;
      foreach (Screen sc in Screen.AllScreens) if (sc.WorkingArea.IntersectsWith(r)) onScreen = true;
      if (onScreen && r.Width >= 200 && r.Height >= 100) {
        Rectangle wa = Screen.FromRectangle(r).WorkingArea;
        r.Width = Math.Min(r.Width, wa.Width); r.Height = Math.Min(r.Height, wa.Height);
        r.X = Math.Max(wa.Left, Math.Min(r.X, wa.Right - r.Width)); r.Y = Math.Max(wa.Top, Math.Min(r.Y, wa.Bottom - r.Height));
        Bounds = r;
      }
      fontSize = float.Parse(p[4], System.Globalization.CultureInfo.InvariantCulture);
      opIdx = int.Parse(p[5]) % opacities.Length;
    } catch { } finally { loading = false; }
  }
  void SaveSettings() {
    if (loading || !IsHandleCreated) return;
    try {
      File.WriteAllText(settingsFile, string.Format(System.Globalization.CultureInfo.InvariantCulture,
        "{0},{1},{2},{3},{4},{5}", Left, Top, Width, Height, fontSize, opIdx));
    } catch { }
  }

  public static void Run(string dir, string stateFile) {
    try { W.SetProcessDPIAware(); } catch { }
    Application.EnableVisualStyles();
    Application.Run(new PrompterForm(dir, stateFile));
  }
}
}
