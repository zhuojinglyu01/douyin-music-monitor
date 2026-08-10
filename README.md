# 抖音音乐飙升监控 · douyin-music-monitor

一个本地运行的小工具：盯抖音 `#新歌` / `#原创音乐` 等话题下的**近期新视频**，
当某条视频**24 小时点赞净增**冲破阈值时，通过 **Server酱**推一条到你微信。

## 原理（发现 + 逐条量）

- **发现**：搜索话题词，把命中标签、近 N 天发布的视频加进「观察名单」。
- **逐条量**：每轮打开 `douyin.com/video/{id}` 截获 `/aweme/detail/` 的实时点赞，
  逐条追踪——正在爆的视频一经发现就被咬住，连续算涨幅（不依赖它复现于搜索）。
- **分级**（24h 滚动窗口）：📈 Rising（≥500 且加速，静默进榜）·
  🔥 预警（≥2000 或 ≥3× 自身历史，推微信）· 🚨 Breaking（≥5000，推微信）。

## 快速开始

```bash
npm install
node login.js          # 用抖音【小号】扫码登录（登录态存本机 data/profile）
cp config.default.json config.json   # 然后填 push.serverchan.sendkey（Server酱）
node monitor.js        # 持续跑，每 90 分钟一轮
```

控制台：`node ctl.js status | rising | config | log | set <项> <值> | hashtag add|rm <词>`
测一发推送：`node fire-test.js`

## 桌面 App（electron-app/）

`cd electron-app && npm install && npm start`，或 `npm run dist` 打包成
macOS `.app` / Windows `.exe`（界面里登录、配置、看榜、启停）。

## 注意

- 必须**登录的小号 + 有头系统 Chrome**（无头会被风控识破）。用小号，别用主力号。
- 灰色地带、需养号；抖音改版可能让抓取失效，届时小修 `lib/scrape.js`。
- 只在电脑**醒着**时跑。
