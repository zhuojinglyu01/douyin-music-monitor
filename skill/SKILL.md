---
name: douyin-monitor
description: >-
  Set up, run, and control a local 抖音/Douyin music-surge monitor — a Node engine
  (default at ~/douyin-music-monitor) that watches #新歌/#原创音乐 hashtag videos and
  pushes a WeChat alert (via Server酱) when a video's 24h like-gain crosses a tier
  (Rising / 预警 / Breaking). Use whenever the user mentions their 抖音监控 / Douyin
  monitor / Rising List / 飙升 / 冲量, or asks to install/set up, start, stop, check
  status, see what's rising, tune thresholds, add/remove hashtags, log in the 小号,
  or send a test push.
---

# 抖音音乐飙升监控 · Skill（Cowork / 本地 agent 版）

A local Node engine watches Douyin hashtag videos and pushes tiered WeChat alerts.
The engine lives at **`~/douyin-music-monitor`** by default (adjust if the user put
it elsewhere). Requires **Node 18+**, **Google Chrome installed**, and a Douyin
**小号 (throwaway account)**.

## 首次安装（第一次使用时做一遍）

1. **放好引擎**：确保 `engine/` 里的文件在 `~/douyin-music-monitor/`（把随本 skill
   附带的 `engine/` 整个复制过去）。
2. **装依赖**：`cd ~/douyin-music-monitor && npm install`（会装 Playwright）。
3. **登录小号**：`node ~/douyin-music-monitor/login.js` → 弹出 Chrome，用**小号**扫码
   登录，别手动关窗口，成功后自动保存。（登录态只存在本机 `data/profile/`。）
4. **配推送**：让用户去 https://sct.ftqq.com 拿一个 **Server酱 SendKey**（关注并绑定
   微信），填进 `~/douyin-music-monitor/config.json` 的 `push.serverchan.sendkey`，
   并把 `push.type` 改成 `"serverchan"`；或设环境变量 `SERVERCHAN_SENDKEY`。
5. **开始**：`node ~/douyin-music-monitor/monitor.js`（持续跑，每 90 分钟一轮）。
   要它常驻/开机自启/防休眠，按用户的操作系统配（macOS: launchd + caffeinate；
   Windows: 任务计划程序；Linux: systemd）——问清 OS 再设。

## 日常控制（命令都走 ctl.js，输出中文，直接转达用户）

| 用户说 | 执行 |
|--------|------|
| 状态 / 在跑吗 | `node ~/douyin-music-monitor/ctl.js status` |
| 看榜 / 正在冲的 | `node ~/douyin-music-monitor/ctl.js rising`（可 `rising 20`） |
| 当前配置 | `node ~/douyin-music-monitor/ctl.js config` |
| 看日志 | `node ~/douyin-music-monitor/ctl.js log` |
| 预警门槛改 1000 | `node ~/douyin-music-monitor/ctl.js set alert 1000` |
| Breaking 8000 / 间隔 120 / 近 3 天 | `set breaking 8000` / `set interval 120` / `set days 3` |
| 加/删话题 | `ctl.js hashtag add 新歌demo` / `hashtag rm 唱作人` |
| 重新登录 | `node ~/douyin-music-monitor/login.js` |
| 测一发推送 | `node ~/douyin-music-monitor/fire-test.js` |

> `ctl.js` 的 `pause`/`resume` 依赖 macOS launchd；非 macOS 环境请直接用
> `node monitor.js` 启动、结束进程来启停（或按该系统的服务方式）。改完配置需重启生效。

## 分级与原理

- **24h 滚动窗口**分级：📈 Rising（≥500 且加速，静默进榜）· 🔥 预警（≥2000 或 ≥3×
  自身历史，推微信）· 🚨 Breaking（≥5000，推微信）。阈值在 `config.hashtagSurge.tiers`。
- **发现 + 逐条量**：搜索只负责发现视频；之后逐条打开 `douyin.com/video/{id}` 读
  `/aweme/detail/` 的实时点赞，所以正在爆的视频一经发现就被咬住、连续算涨幅。
- 24h/加速指标需连续跑 ≥1 天才成熟。

## 注意事项 / 坑

- 必须**登录的小号 + 有头系统 Chrome**（无头会被抖音风控识破，搜索返回空）。
- 短时间跑太多轮会被风控标记（日志出现"没抓到搜索接口"）→ 让号歇几小时或重登。
- 用**小号**，别用主力号；灰色地带、要养号，抖音改版可能让抓取失效需小修。
- 只在电脑**醒着**时跑；想让窗口不打扰，monitor.js 已把浏览器窗口移到屏幕外。

## 数据文件（命令覆盖不到时才直接读）

- `data/rising_list.json` 当前在榜 · `data/hashtag_snapshots.json` 观察名单+点赞历史
- `data/monitor.out` 运行日志 · `data/alerts.log` 已推告警
