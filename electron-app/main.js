// Electron 主进程（打包就绪版）：
// - 用 Electron 自带 node 跑引擎脚本（ELECTRON_RUN_AS_NODE），朋友无需装 Node
// - App 自管监控子进程 + powerSaveBlocker 防系统休眠（替代 launchd/caffeinate）
// - 打包后 config/data 写到用户可写目录（DYMON_HOME）
const { app, BrowserWindow, ipcMain, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const ENGINE = isDev ? path.join(__dirname, "..") : path.join(process.resourcesPath, "engine");
// 独立 Node 二进制：Playwright 在 Electron 自带 node(ELECTRON_RUN_AS_NODE)下会卡死，必须用真 node 跑引擎
const NODE_BIN = isDev
  ? path.join(__dirname, "vendor", "node")
  : path.join(process.resourcesPath, "node");
// 开发时沿用引擎目录（现有 config/登录态）；打包后用系统用户数据目录
const HOME = isDev ? ENGINE : app.getPath("userData");

const CFG = path.join(HOME, "config.json");
const RISING = path.join(HOME, "data", "rising_list.json");
const LOGFILE = path.join(HOME, "data", "monitor.out");

// 全局崩溃日志：别让任何异常静默掀翻 App，落地到 data/app-error.log
const logErr = (tag, e) => {
  try {
    fs.mkdirSync(path.join(HOME, "data"), { recursive: true });
    fs.appendFileSync(path.join(HOME, "data", "app-error.log"), `\n[${new Date().toISOString()}] ${tag}: ${e?.stack || e}\n`);
  } catch {}
};
process.on("uncaughtException", (e) => logErr("uncaughtException", e));
process.on("unhandledRejection", (e) => logErr("unhandledRejection", e));

function ensureHome() {
  fs.mkdirSync(path.join(HOME, "data"), { recursive: true });
  if (!fs.existsSync(CFG)) {
    const def = fs.existsSync(path.join(ENGINE, "config.default.json"))
      ? path.join(ENGINE, "config.default.json")
      : path.join(ENGINE, "config.json");
    if (fs.existsSync(def)) fs.copyFileSync(def, CFG);
  }
}

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };
const runEnv = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: "1", DYMON_HOME: HOME });

// —— 监控子进程（App 自管）——
let monitorChild = null;
let blockerId = null;
function startMonitor() {
  if (monitorChild) return { ok: true, already: true };
  const out = fs.openSync(LOGFILE, "a");
  monitorChild = spawn(NODE_BIN, [path.join(ENGINE, "monitor.js")], {
    cwd: ENGINE,
    env: { ...process.env, DYMON_HOME: HOME }, // 真 node，不要 ELECTRON_RUN_AS_NODE
    stdio: ["ignore", out, out],
    detached: true,
  });
  monitorChild.on("exit", () => {
    monitorChild = null;
    if (blockerId != null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
  });
  if (blockerId == null) blockerId = powerSaveBlocker.start("prevent-app-suspension");
  return { ok: true };
}
function stopMonitor() {
  if (monitorChild) {
    try { process.kill(-monitorChild.pid); } catch {}      // 杀整个进程组（含 Chrome）
    try { monitorChild.kill("SIGKILL"); } catch {}
    monitorChild = null;
  }
  if (blockerId != null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
  return { ok: true };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 880, height: 760, minWidth: 720, minHeight: 560,
    title: "抖音音乐飙升监控", backgroundColor: "#f2ecdd",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.handle("get-config", () => readJson(CFG, {}));
ipcMain.handle("save-config", (_e, patch) => {
  const cfg = readJson(CFG, {});
  if (patch.hashtags) cfg.hashtags = patch.hashtags;
  if (patch.pollIntervalMinutes) cfg.pollIntervalMinutes = Number(patch.pollIntervalMinutes);
  cfg.hashtagSurge = cfg.hashtagSurge || {};
  cfg.hashtagSurge.tiers = cfg.hashtagSurge.tiers || {};
  if (patch.alertGain24h) cfg.hashtagSurge.tiers.alertGain24h = Number(patch.alertGain24h);
  if (patch.breakingGain24h) cfg.hashtagSurge.tiers.breakingGain24h = Number(patch.breakingGain24h);
  if (patch.recentDays) cfg.hashtagSurge.recentDays = Number(patch.recentDays);
  if (patch.sendkey != null) {
    cfg.push = cfg.push || {};
    cfg.push.type = patch.sendkey ? "serverchan" : "none";
    cfg.push.serverchan = { sendkey: patch.sendkey };
  }
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
  return { ok: true };
});
ipcMain.handle("get-rising", () => readJson(RISING, { updatedAt: "-", items: [] }));
ipcMain.handle("get-log", () => {
  try { return fs.readFileSync(LOGFILE, "utf8").trim().split("\n").slice(-60).join("\n"); }
  catch { return "（还没有日志——开始监控后这里会实时显示它在干嘛）"; }
});
ipcMain.handle("get-status", () => {
  const cfg = readJson(CFG, {});
  return { running: !!monitorChild, hashtags: (cfg.hashtags || []).length, interval: cfg.pollIntervalMinutes || 90 };
});
ipcMain.handle("start", () => startMonitor());
ipcMain.handle("stop", () => stopMonitor());
// 治本：登录在 App 自己的窗口里做（Electron 本身就是 Chromium，不外挂 Chrome，不会崩）。
// 登录成功后抓下抖音 cookie，写 data/douyin-login.json，引擎启动时注入到抓取上下文。
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
ipcMain.handle("login", async () => {
  return new Promise((resolve) => {
    let win;
    try {
      win = new BrowserWindow({
        width: 1100, height: 820, title: "登录抖音小号（扫码或验证码）",
        webPreferences: { partition: "persist:douyin-login" },
      });
    } catch (e) { logErr("login-window", e); return resolve({ ok: false, error: e.message }); }
    const ses = win.webContents.session;
    ses.setUserAgent(CHROME_UA);
    win.loadURL("https://www.douyin.com/");

    let done = false;
    const timer = setInterval(async () => {
      if (done || win.isDestroyed()) return;
      try {
        const cookies = await ses.cookies.get({ domain: "douyin.com" });
        if (cookies.some((c) => /^sessionid(_ss)?$/i.test(c.name) && c.value)) {
          done = true; clearInterval(timer);
          const all = await ses.cookies.get({});
          const dy = all.filter((c) => /douyin/.test(c.domain));
          const ss = { no_restriction: "None", lax: "Lax", strict: "Strict", unspecified: "Lax" };
          const pw = dy.map((c) => ({
            name: c.name, value: c.value,
            domain: c.domain.startsWith(".") ? c.domain : "." + c.domain,
            path: c.path || "/",
            expires: c.expirationDate ? Math.floor(c.expirationDate) : -1,
            httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: ss[c.sameSite] || "Lax",
          }));
          fs.mkdirSync(path.join(HOME, "data"), { recursive: true });
          fs.writeFileSync(path.join(HOME, "data", "douyin-login.json"), JSON.stringify(pw, null, 2));
          if (!win.isDestroyed()) win.close();
          resolve({ ok: true, count: pw.length });
        }
      } catch (e) { logErr("login-capture", e); }
    }, 2000);
    win.on("closed", () => { clearInterval(timer); if (!done) resolve({ ok: false, cancelled: true }); });
  });
});

app.whenReady().then(() => { ensureHome(); createWindow(); });
app.on("before-quit", stopMonitor);
app.on("window-all-closed", () => { stopMonitor(); if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
