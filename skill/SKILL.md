---
name: douyin-monitor
description: >-
  Set up, run, and drive a local 抖音/Douyin new-song surge monitor — a Node engine
  (default at ~/douyin-music-monitor) that discovers videos published in the last few
  days by hashtag OR caption keyword, tracks each one's real like-growth every ~90 min,
  and flags the ones rising fastest (Rising / Watch / Breaking tiers by 24h like-gain).
  Alerts are relayed straight into THIS conversation (feed mode) — no external service,
  no keys. Use whenever the user mentions their 抖音监控 / Douyin monitor / 新歌 / 飙升 /
  冲量 / Rising List, or asks to install/set up, start, stop, check status, see what's
  rising, tune thresholds, add/remove hashtags or keywords, log in the 小号, or relay
  alerts. Goal is NOT "find hot videos" but "catch rising original new songs as early
  as possible."
---

# 抖音新歌飙升监控 · Skill

A local Node engine watches Douyin for **rising original new songs** and relays tiered
alerts **into the conversation**. Engine lives at **`~/douyin-music-monitor`** by default.

**Requirements:** Node 18+ · **Google Chrome installed** (the engine drives real Chrome —
headless is blocked by Douyin risk-control) · a Douyin **小号 (throwaway account)** — never
the user's main account.

---

## 首次安装（第一次做一遍）

1. **拿引擎代码：** clone 公开仓库到默认位置：
   ```bash
   git clone https://github.com/zhuojinglyu01/douyin-music-monitor.git ~/douyin-music-monitor
   ```
2. **装依赖：** `cd ~/douyin-music-monitor && npm install`（装 Playwright）。
3. **建配置：** `cp config.default.json config.json`（`config.json` 已 gitignore，改它不会污染仓库）。
4. **登录小号：** `node ~/douyin-music-monitor/login.js` → 弹出 Chrome，让用户用**自己的小号**扫码登录，别手动关窗口，成功后登录态自动存本机 `data/profile/`（不进 git）。
5. **开始跑：** `node ~/douyin-music-monitor/monitor.js`（持续运行，每 90 分钟一轮）。
   常驻/开机自启/防休眠按用户 OS 配（macOS: launchd + `caffeinate -s -i`；Windows: 任务计划；Linux: systemd）——先问清 OS。

> ⚠️ 引擎驱动的是**用户自己**的小号会话。你（agent）永远不替用户输入账号密码——只让用户在弹出的 Chrome 里自己扫码。

---

## 推送 = 推到「对话流」（默认，推荐）

`config.push.type` 默认 `"feed"`：命中时引擎把结构化告警**追加**到 `data/alerts-feed.jsonl`
（一行一条 JSON：`{t, title, body}`），**不发任何外部服务、不需要任何 key**。由你（agent）读取并转达用户。

**你要做的：挂一个『守望』后台循环**——阻塞等 `alerts-feed.jsonl` 增长，一有新行就读出来贴给用户；
顺带做**健康/失明检查**（引擎还活着吗？最近一次成功采数据多久了？）。参考循环（每 ~2 小时醒一次，或一有新命中立刻醒）：

```bash
cd ~/douyin-music-monitor
F=data/alerts-feed.jsonl; CUR=$(wc -l < "$F" 2>/dev/null||echo 0); END=$((SECONDS+7200))
until [ "$(wc -l < "$F" 2>/dev/null||echo 0)" -gt "$CUR" ] || [ $SECONDS -ge $END ]; do sleep 60; done
N=$(wc -l < "$F" 2>/dev/null||echo 0)
AGE=$(node -e 'try{const s=JSON.parse(require("fs").readFileSync("data/hashtag_snapshots.json","utf8"));let m=0;for(const v of Object.values(s))if(v.samples)for(const x of v.samples)if(x.t>m)m=x.t;console.log(((Date.now()-m)/3.6e6).toFixed(1))}catch(e){console.log(99)}')
ALIVE=$(pgrep -f "douyin-music-monitor/monitor.js" >/dev/null && echo 1 || echo 0)
if [ "$N" -gt "$CUR" ]; then echo "NEW_ALERTS"; tail -n +$((CUR+1)) "$F"
elif [ "$ALIVE" = 0 ] || awk -v a="$AGE" 'BEGIN{exit !(a+0>3)}'; then echo "BLIND alive=$ALIVE ageH=$AGE"
else echo "QUIET_OK ageH=$AGE"; fi
```

- `NEW_ALERTS` → 解析每行 JSON 的 `title`/`body`，贴给用户（去重：同一视频升级会再推一次，展示时按视频合并）。
- `BLIND`（进程挂了，或 >3 小时没采到新数据）→ **主动告诉用户出问题了**，别假装平静。常见原因见「坑」。
- `QUIET_OK` → 静默续守望，不打扰。

> 其它推送渠道（可选、需用户自备 key）：`wecombot`（企业微信机器人 webhook）、`pushdeer`、`serverchan`。改 `config.push.type` 并填对应字段。

---

## 日常控制（走 ctl.js，输出中文，直接转达）

| 用户说 | 执行 |
|--------|------|
| 状态 / 在跑吗 | `node ~/douyin-music-monitor/ctl.js status` |
| 看榜 / 正在冲的 | `node ~/douyin-music-monitor/ctl.js rising`（可 `rising 20`） |
| 当前配置 | `node ~/douyin-music-monitor/ctl.js config` |
| 看日志 | `node ~/douyin-music-monitor/ctl.js log` |
| Watch 门槛改 1500 | `node ~/douyin-music-monitor/ctl.js set watch 1500` |
| Breaking 8000 / 间隔 120 / 近 3 天 | `set breaking 8000` / `set interval 120` / `set days 3` |
| 加/删话题 | `ctl.js hashtag add 新歌demo` / `hashtag rm 唱作人` |
| 重新登录 | `node ~/douyin-music-monitor/login.js` |

> 改完配置需**重启** monitor 生效。非 macOS 环境直接起/停 `node monitor.js` 进程（或按该系统服务方式）。

---

## 分级与原理

- **发现（双路）：** 每轮搜 `hashtags` 里的词，返回的视频只要【标签 命中 或 文案 命中】`keywords` 里任一词，且在近 `recentDays` 天内发布，就进观察名单（上限 `watchlistMax`，满了智能淘汰：老且不涨的先踢）。
- **逐条量：** 搜索只负责**发现**；之后逐条打开 `douyin.com/video/{id}` 读 `/aweme/detail/` 的实时点赞——所以正在爆的视频一经发现就被咬住，连续算涨幅，哪怕它掉出搜索结果也不丢。
- **分级（纯绝对量）：** 按 **24h 绝对涨赞** 分 Rising（≥500，只进榜不推）· Watch（≥2000，推）· Breaking（≥5000，推，重点）。阈值在 `config.hashtagSurge.tiers`。
- **真实 24h：** 涨幅 = 当前赞 − 最接近 24h 前的采样点。**追踪不满 24h** 时推送标 `Tracking · 6h +1240 赞`（真实窗口，不编 24h 假数）；满 24h 自动切 `24h +N 赞`。
- **去重：** 同一视频只在**首次达到某级**或 **Watch→Breaking 升级**时才推。
- 指标需连续跑 ≥1 天才成熟。

---

## 坑 / 注意事项

- **必须小号 + 有头系统 Chrome。** 无头会被风控识破，搜索返回空。
- **「没抓到搜索接口」＝抓取失效。** 两种可能：①短时间跑太多轮被风控标记 → 让号歇几小时或重登；②**抖音改版换了搜索接口地址**（历史上从 `/general/search/single/` 改成过 `/search/item/`）。若重登+歇号仍全灭，去 `lib/scrape.js` 的 `scrapeHashtag` 里更新接口匹配（开一个有头 Chrome 搜一次、在 Network 里找真正返回视频列表的 `/aweme/...` 请求，把路径加进正则）。
- 用小号、灰色地带、要养号；只在电脑**醒着**时跑（合盖会睡）。想窗口不打扰，monitor.js 已把浏览器移到屏幕外。
- `config.json` / `data/` 都在 `.gitignore` 里——**登录态和你的配置永远不会进 git**，可以放心把仓库分享出去。

---

## 数据文件（命令覆盖不到时才直接读）

- `data/alerts-feed.jsonl` 推到对话流的告警（一行一条 JSON）· `data/alerts.log` 人读版
- `data/hashtag_snapshots.json` 观察名单 + 点赞采样历史（含时间戳，用来算真实 24h）
- `data/rising_list.json` 当前在榜 · `data/monitor.out` 运行日志
