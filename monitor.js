// 主程序：带小号登录态，轮询名单里每个音乐人的主页，
// 对比上一轮点赞数算增速，命中“飙升/新预告”就推送。
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { scrapeArtist, scrapeHashtag, measureVideo } from "./lib/scrape.js";
import {
  loadSnapshots,
  saveSnapshots,
  loadHashtagSnapshots,
  saveHashtagSnapshots,
} from "./lib/store.js";
import { push } from "./lib/push.js";
import { CONFIG as CFG, PROFILE as USER_DATA, RISING, DATA_DIR } from "./lib/paths.js";
import { mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
await mkdir(DATA_DIR, { recursive: true }).catch(() => {}); // 确保可写数据目录存在

const LOGIN_SEED = `${DATA_DIR}/douyin-login.json`; // App 登录窗口抓到的 cookie

const ONCE = process.argv.includes("--once");

function hasTeaser(title, kws) {
  const t = title || "";
  return kws.some((k) => t.includes(k));
}

// 判断一条视频是否“飙升”，返回 null 或一段人话理由
function judge(v, prev, now, s) {
  const teaser = hasTeaser(v.title, s.teaserKeywords);
  const ageH = v.createTime ? (now - v.createTime) / 3.6e6 : null;

  if (!prev) {
    // 首次见到：只对“窗口内的新预告”报警，其余仅建基线，避免刷屏
    if (teaser && ageH != null && ageH <= s.newVideoWindowHours) {
      return `🆕 新预告：发布约 ${ageH.toFixed(1)} 小时，当前 ${v.likes} 赞`;
    }
    return null;
  }

  const dLikes = (v.likes ?? 0) - (prev.likes ?? 0);
  const dH = Math.max((now - prev.ts) / 3.6e6, 1 / 60);
  const perH = dLikes / dH;
  const pct = prev.likes > 0 ? (dLikes / prev.likes) * 100 : 0;

  const hits = [];
  if (perH >= s.minLikesPerHour) hits.push(`每小时 +${Math.round(perH)} 赞`);
  if (pct >= s.minPctGrowth) hits.push(`较上轮 +${pct.toFixed(0)}%`);
  if (!hits.length) return null;

  const tag = teaser ? "🔥🎵 预告飙升" : "🔥 飙升";
  return `${tag}：${hits.join("、")}（${prev.likes} → ${v.likes} 赞）`;
}

// 每轮开始先像真人一样逛一下首页，给会话“热身”，降低被风控标记的概率
async function warmup(context) {
  const p = await context.newPage();
  try {
    await p.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await p.waitForTimeout(4000 + Math.random() * 3000);
    await p.mouse.wheel(0, 1200).catch(() => {});
    await p.waitForTimeout(2000 + Math.random() * 2000);
  } catch {
    /* 热身失败不致命 */
  } finally {
    await p.close().catch(() => {});
  }
}

// ---- 话题分级监控（24h 滚动窗口 + 自身历史加速）----

// 采样历史里取“不晚于 targetT 的最新样本”点赞数；没有更早样本就用最早样本
function likesAt(samples, targetT) {
  let best = null;
  for (const s of samples) if (s.t <= targetT && (!best || s.t > best.t)) best = s;
  return best ? best.l : samples.length ? samples[0].l : null;
}

// 由采样历史算：24h 涨幅、近期增速(赞/时)、历史增速、加速倍数
export function metrics(samples, now) {
  if (!samples.length) return null;
  const first = samples[0];
  const likesNow = samples[samples.length - 1].l;
  const spanH = (now - first.t) / 3.6e6;
  const winH = Math.min(24, Math.max(spanH, 1 / 60));
  const likes24hAgo = likesAt(samples, now - 24 * 3.6e6);
  const gain24h = likesNow - likes24hAgo;
  const recentRate = gain24h / winH; // 赞/小时（近 24h）
  let histRate = null,
    accel = null;
  const cutT = now - 24 * 3.6e6;
  if (first.t < cutT - 3.6e6) {
    // 至少有 1 小时的“更早历史段”才谈加速
    const histSpanH = (cutT - first.t) / 3.6e6;
    histRate = (likes24hAgo - first.l) / histSpanH;
    if (histRate > 0.5) accel = recentRate / histRate;
    else if (recentRate > 0.5) accel = Infinity;
  }
  return { gain24h, recentRate, histRate, accel, spanH, likesNow };
}

const fmtX = (a) => (a == null ? "?" : a === Infinity ? "∞" : a.toFixed(1));

// 分级 → {tier,label,reason} 或 null。tier: 0=Rising 1=预警 2=Breaking
export function classify(m, t) {
  if (!m) return null;
  const rG = t.risingGain24h ?? 500,
    rX = t.risingAccelX ?? 1.5,
    aG = t.alertGain24h ?? 2000,
    aX = t.alertAccelX ?? 3,
    bG = t.breakingGain24h ?? 5000;
  if (m.gain24h >= bG) return { tier: 2, label: "🚨 Breaking", reason: `24h +${m.gain24h} 赞` };
  if (m.gain24h >= aG || (m.accel != null && m.accel >= aX))
    return { tier: 1, label: "🔥 预警", reason: m.gain24h >= aG ? `24h +${m.gain24h} 赞` : `增速 ${fmtX(m.accel)}× 自身历史` };
  if (m.gain24h >= rG && m.accel != null && m.accel >= rX)
    return { tier: 0, label: "📈 Rising", reason: `24h +${m.gain24h} 赞·增速 ${fmtX(m.accel)}×` };
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 话题监控（发现 + 逐条量）：搜话题只用来【发现】，之后【逐条量】每条在库视频的实时点赞，
// 这样正在爆的视频一经发现就被咬住、连续测涨幅，不再依赖它复现于搜索。
async function runHashtags(cfg, context, now) {
  const tags = cfg.hashtags || [];
  if (!tags.length) return;
  const t = cfg.hashtagSurge?.tiers || {};
  const recentDays = cfg.hashtagSurge?.recentDays ?? 7;
  const maxAgeMs = recentDays > 0 ? recentDays * 86400000 : Infinity;
  const cap = cfg.hashtagSurge?.watchlistMax ?? 100;
  const snaps = await loadHashtagSnapshots();
  const measuredThisPass = new Set();

  const ensureRec = (id, seed) => {
    let rec = snaps[id];
    if (!rec) {
      rec = { samples: [], firstSeen: now, alertedTier: -1 };
      snaps[id] = rec;
    }
    if (!Array.isArray(rec.samples)) rec.samples = [];
    if (rec.alertedTier == null) rec.alertedTier = -1;
    if (seed) Object.assign(rec, seed);
    return rec;
  };
  const addSample = (rec, likes) => {
    rec.samples.push({ t: now, l: likes });
    rec.samples = rec.samples.filter((s) => s.t >= now - 3 * 86400000); // 留 3 天采样
    rec.likes = likes;
  };

  // 1) 发现：搜话题，新视频入库、已知视频顺手更新一采样
  for (const term of tags) {
    try {
      const { videos, viaApi } = await scrapeHashtag(context, term, {
        debug: process.env.DEBUG === "1",
        recentDays,
      });
      if (!viaApi) {
        console.log(`· #${term}: ⚠️ 没抓到搜索接口，跳过`);
        continue;
      }
      let added = 0;
      for (const v of videos) {
        if (v.likes == null) continue;
        const isNew = !snaps[v.videoId];
        const rec = ensureRec(v.videoId, {
          title: v.title, author: v.author, tags: v.tags, url: v.url, term, createTime: v.createTime,
        });
        addSample(rec, v.likes);
        measuredThisPass.add(v.videoId);
        if (isNew) added++;
      }
      console.log(`· #${term}: 命中 ${videos.length}（新 ${added}）`);
    } catch (e) {
      console.error(`✗ #${term}:`, e.message);
    }
    await sleep(6000 + Math.random() * 6000);
  }

  // 2) 清理超龄/超容量：先按发布时间新→旧排，超 recentDays 的丢弃，其余进逐条量预算
  for (const [id, r] of Object.entries(snaps)) {
    if (r.createTime != null && now - r.createTime > maxAgeMs) delete snaps[id];
  }
  const notMeasured = Object.entries(snaps)
    .filter(([id]) => !measuredThisPass.has(id))
    .sort((a, b) => (b[1].createTime || 0) - (a[1].createTime || 0));
  const budget = Math.max(0, cap - measuredThisPass.size);
  const toMeasure = notMeasured.slice(0, budget);
  for (const [id] of notMeasured.slice(budget)) delete snaps[id]; // 超容量的老视频清出

  // 3) 逐条量：本轮没在搜索出现的在库视频，直接量它自己的实时点赞
  let measured = 0, miss = 0;
  for (const [id, rec] of toMeasure) {
    try {
      const r = await measureVideo(context, id, {});
      if (r && r.likes != null) {
        addSample(rec, r.likes);
        if (r.createTime) rec.createTime = r.createTime;
        measured++;
      } else miss++;
    } catch {
      miss++;
    }
    await sleep(2500 + Math.random() * 2500);
  }
  console.log(`· 逐条量：更新 ${measured} 条${miss ? `（${miss} 条没量到）` : ""}，名单共 ${Object.keys(snaps).length} 条`);

  // 4) 分级 + 推送 + Rising List（遍历整个名单，不再只看本轮搜到的）
  const rising = [], pushes = [];
  for (const [id, rec] of Object.entries(snaps)) {
    const m = metrics(rec.samples, now);
    const c = classify(m, t);
    if (!c) continue;
    rec.tierLabel = c.label;
    rising.push({ rec, c, m });
    if (c.tier >= 1 && c.tier > rec.alertedTier) {
      pushes.push({ rec, c });
      rec.alertedTier = c.tier;
    }
  }
  await saveHashtagSnapshots(snaps);

  rising.sort((a, b) => b.m.gain24h - a.m.gain24h);
  const risingOut = rising.map((r) => ({
    tier: r.c.label, gain24h: r.m.gain24h, accel: fmtX(r.m.accel),
    likes: r.rec.likes, author: r.rec.author, title: r.rec.title, url: r.rec.url,
  }));
  await writeFile(RISING, JSON.stringify({ updatedAt: new Date(now).toLocaleString(), items: risingOut }, null, 2)).catch(() => {});

  for (const p of pushes) {
    await push(
      cfg.push,
      `${p.c.label} — ${p.rec.author || "?"}`,
      `${p.rec.title}\n${p.c.reason}（当前 ${p.rec.likes} 赞）\n标签：${(p.rec.tags || []).join(" / ")}\n${p.rec.url}`
    );
  }
  const nB = rising.filter((r) => r.c.tier === 2).length;
  const nA = rising.filter((r) => r.c.tier === 1).length;
  const nR = rising.filter((r) => r.c.tier === 0).length;
  console.log(`话题监控：Rising ${nR} · 预警 ${nA} · Breaking ${nB}｜本轮新推 ${pushes.length} 条`);
}

async function runOnce(cfg, context) {
  const snaps = await loadSnapshots();
  const now = Date.now();
  const alerts = [];

  await warmup(context);

  for (const artist of cfg.artists) {
    try {
      const { videos, viaApi, blocked, nickname } = await scrapeArtist(context, artist, {
        debug: process.env.DEBUG === "1",
      });
      if (blocked) {
        console.log(`· ${artist.name}: ⚠️ 被风控拦截（服务异常），本轮跳过。建议 headless:false + 拉大间隔。`);
        continue;
      }
      if (!viaApi) {
        console.log(`· ${artist.name}: ⚠️ 没抓到作品接口，本轮跳过（不写入脏数据）。`);
        continue;
      }
      console.log(`· ${artist.name}${nickname ? ` [${nickname}]` : ""}: ${videos.length} 条 ✅`);
      for (const v of videos) {
        if (v.likes == null) continue;
        const reason = judge(v, snaps[v.videoId], now, cfg.surge);
        if (reason) {
          alerts.push({ artist: artist.name, v, reason });
        }
        snaps[v.videoId] = { likes: v.likes, ts: now, title: v.title, artist: artist.name };
      }
    } catch (e) {
      console.error(`✗ ${artist.name} 抓取失败:`, e.message);
    }
    // 名单间随机停顿，别太像机器人
    await new Promise((r) => setTimeout(r, 6000 + Math.random() * 6000));
  }

  await saveSnapshots(snaps);

  for (const a of alerts) {
    await push(
      cfg.push,
      `${a.reason.split("：")[0]} — ${a.artist}`,
      `${a.v.title}\n${a.reason}\n${a.v.url}`
    );
  }
  if (cfg.artists?.length) {
    console.log(`名单监控：${alerts.length} 条飙升告警，${Object.keys(snaps).length} 条视频在库。`);
  }

  await runHashtags(cfg, context, now);
  console.log("本轮完成。\n");
}

async function main() {
  const cfg = JSON.parse(await readFile(CFG, "utf8"));
  let context;
  try {
    context = await chromium.launchPersistentContext(USER_DATA, {
      channel: "chrome", // 用系统正版 Chrome，避开自带 Chromium 在新版 macOS 上的崩溃
      headless: cfg.headless !== false, // 被抖音拦时把 config.headless 设 false 改有头
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--window-position=-2400,-2400", // 窗口挪到屏幕外，有头(过风控)但你看不见、不抢焦点
        "--window-size=1200,800",
      ],
    });
  } catch (e) {
    console.error("❌ 起浏览器/读登录态失败。先跑 `npm run login` 登录小号。", e.message);
    process.exit(1);
  }

  // 一次性注入 App 登录窗口抓到的 cookie，让持久化上下文获得登录态
  try {
    if (existsSync(LOGIN_SEED)) {
      const cookies = JSON.parse(await readFile(LOGIN_SEED, "utf8"));
      await context.addCookies(cookies);
      await rename(LOGIN_SEED, LOGIN_SEED + ".used");
      console.log(`✅ 已注入 App 登录 cookie ${cookies.length} 条`);
    }
  } catch (e) {
    console.error("注入登录 cookie 失败:", e.message);
  }

  do {
    console.log(`\n=== 扫描 ${new Date().toLocaleString()} ===`);
    await runOnce(cfg, context);
    if (!ONCE) {
      const min = cfg.pollIntervalMinutes || 30;
      console.log(`💤 ${min} 分钟后下一轮…`);
      await new Promise((r) => setTimeout(r, min * 60000));
    }
  } while (!ONCE);

  await context.close();
}

// 只在直接运行时启动；被 import（测试）时不启动
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
