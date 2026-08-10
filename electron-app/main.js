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
// 开发时沿用引擎目录（现有 config/登录态）；打包后用系统用户数据目录
const HOME = isDev ? ENGINE : app.getPath("userData");

const CFG = path.join(HOME, "config.json");
const RISING = path.join(HOME, "data", "rising_list.json");
const LOGFILE = path.join(HOME, "data", "monitor.out");

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
  monitorChild = spawn(process.execPath, [path.join(ENGINE, "monitor.js")], {
    cwd: ENGINE, env: runEnv(), stdio: ["ignore", out, out], detached: true,
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
ipcMain.handle("login", () => {
  const p = spawn(process.execPath, [path.join(ENGINE, "login.js")], { cwd: ENGINE, env: runEnv(), detached: true, stdio: "ignore" });
  p.unref();
  return { ok: true };
});

app.whenReady().then(() => { ensureHome(); createWindow(); });
app.on("before-quit", stopMonitor);
app.on("window-all-closed", () => { stopMonitor(); if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
