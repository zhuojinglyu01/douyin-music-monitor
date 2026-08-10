#!/usr/bin/env node
// 监控控制台：给 WorkBuddy / 企业微信 agent（或你自己）调用的统一入口。
// 输出都是给人看的纯文本，方便 agent 直接转发到微信。
//
// 用法:
//   node ctl.js status                 查看运行状态
//   node ctl.js rising [n]             看当前 Rising List 前 n 条（默认 10）
//   node ctl.js config                 看当前监控条件
//   node ctl.js pause                  暂停监控
//   node ctl.js resume                 恢复监控
//   node ctl.js set <项> <值>          改配置：interval/rising/alert/breaking/days
//   node ctl.js hashtag add <词> | rm <词>
//   node ctl.js log [n]                看最近 n 行运行日志（默认 15）
import { readFile, writeFile, rename, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { CONFIG as CFG, RISING, MONITOR_OUT as OUT, ENGINE } from "./lib/paths.js";

const DIR = ENGINE + "/";
const LABEL = "com.ivy.douyin-music-monitor";
const PLIST = `${process.env.HOME}/Library/LaunchAgents/${LABEL}.plist`;
const PLIST_OFF = `${DIR}launchd-disabled/${LABEL}.plist`;

const sh = (c) => {
  try {
    return execSync(c, { encoding: "utf8" }).trim();
  } catch (e) {
    return ((e.stdout || "") + (e.stderr || "")).trim();
  }
};
const uid = () => sh("id -u");
const isRunning = () => !!sh('pgrep -f "douyin-music-monitor/monitor.js"');
const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};
const readCfg = async () => JSON.parse(await readFile(CFG, "utf8"));
const writeCfg = (c) => writeFile(CFG, JSON.stringify(c, null, 2));

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const cfg = await readCfg();

  if (cmd === "status") {
    const run = isRunning();
    const last = sh(`grep -E "本轮完成|话题监控" "${OUT}" 2>/dev/null | tail -2`);
    let rn = 0;
    if (await exists(RISING)) rn = (JSON.parse(await readFile(RISING, "utf8")).items || []).length;
    console.log(`状态：${run ? "🟢 运行中" : "⏸️ 已暂停"}`);
    console.log(`频率：每 ${cfg.pollIntervalMinutes} 分钟一轮 · 话题 ${cfg.hashtags.length} 个`);
    console.log(`Rising List：当前 ${rn} 条`);
    if (last) console.log(`最近一轮：\n${last}`);
    return;
  }

  if (cmd === "rising") {
    const n = parseInt(a) || 10;
    if (!(await exists(RISING))) return console.log("Rising List 还没生成（监控需先跑至少一轮）。");
    const { updatedAt, items } = JSON.parse(await readFile(RISING, "utf8"));
    console.log(`📈 Rising List（${updatedAt}，共 ${items.length} 条）`);
    items.slice(0, n).forEach((it, i) =>
      console.log(`${i + 1}. ${it.tier} 24h+${it.gain24h} 增速${it.accel}× · ${it.likes}赞 · ${it.author}\n   ${(it.title || "").slice(0, 30)}\n   ${it.url}`)
    );
    return;
  }

  if (cmd === "config") {
    const t = cfg.hashtagSurge?.tiers || {};
    console.log(`频率：每 ${cfg.pollIntervalMinutes} 分钟`);
    console.log(`话题(${cfg.hashtags.length})：${cfg.hashtags.join(" / ")}`);
    console.log(`只看近 ${cfg.hashtagSurge?.recentDays} 天新视频`);
    console.log(`分级(24h)：📈Rising≥${t.risingGain24h}且加速${t.risingAccelX}× · 🔥预警≥${t.alertGain24h}或${t.alertAccelX}× · 🚨Breaking≥${t.breakingGain24h}`);
    console.log(`推送：${cfg.push?.type}`);
    return;
  }

  if (cmd === "pause") {
    sh(`launchctl bootout gui/${uid()}/${LABEL} 2>/dev/null`);
    sh('pkill -9 -f "douyin-music-monitor/monitor.js" 2>/dev/null');
    console.log(isRunning() ? "⚠️ 仍在运行，请重试" : "⏸️ 已暂停。");
    return;
  }

  if (cmd === "resume") {
    if (!(await exists(PLIST)) && (await exists(PLIST_OFF))) await rename(PLIST_OFF, PLIST);
    sh(`launchctl bootout gui/${uid()}/${LABEL} 2>/dev/null`);
    console.log(sh(`launchctl bootstrap gui/${uid()} "${PLIST}" 2>&1`));
    console.log(isRunning() || sh(`launchctl list | grep ${LABEL}`) ? "🟢 已恢复运行。" : "⚠️ 启动可能失败，看日志。");
    return;
  }

  if (cmd === "set") {
    const map = {
      interval: ["pollIntervalMinutes"],
      rising: ["hashtagSurge", "tiers", "risingGain24h"],
      alert: ["hashtagSurge", "tiers", "alertGain24h"],
      breaking: ["hashtagSurge", "tiers", "breakingGain24h"],
      days: ["hashtagSurge", "recentDays"],
    };
    const path = map[a];
    if (!path || b == null) return console.log("用法：set <interval|rising|alert|breaking|days> <数字>");
    let o = cfg;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
    o[path[path.length - 1]] = Number(b);
    await writeCfg(cfg);
    console.log(`✅ 已设 ${a} = ${b}。重启生效：node ctl.js resume`);
    return;
  }

  if (cmd === "hashtag") {
    if (a === "add" && b) {
      if (!cfg.hashtags.includes(b)) cfg.hashtags.push(b);
      await writeCfg(cfg);
      console.log(`✅ 已加 #${b}。现有 ${cfg.hashtags.length} 个。重启生效：node ctl.js resume`);
    } else if ((a === "rm" || a === "remove") && b) {
      cfg.hashtags = cfg.hashtags.filter((h) => h !== b);
      await writeCfg(cfg);
      console.log(`✅ 已删 #${b}。现有 ${cfg.hashtags.length} 个。重启生效：node ctl.js resume`);
    } else console.log("用法：hashtag add <词> | hashtag rm <词>");
    return;
  }

  if (cmd === "log") {
    console.log(sh(`tail -${parseInt(a) || 15} "${OUT}" 2>/dev/null`) || "（暂无日志）");
    return;
  }

  console.log(`监控控制台。用法：
  node ctl.js status              状态
  node ctl.js rising [n]          看 Rising List
  node ctl.js config              看监控条件
  node ctl.js pause | resume      暂停 / 恢复
  node ctl.js set <项> <值>       改：interval/rising/alert/breaking/days
  node ctl.js hashtag add|rm <词> 加/删话题
  node ctl.js log [n]             看运行日志`);
}
main();
