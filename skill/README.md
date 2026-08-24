# 抖音新歌飙升监控 · Skill（给用 Claude Code / Cowork 的朋友）

装好后，在 AI agent 里一句话就能查/控这个监控。它做的事：盯抖音 #新歌 / #原创音乐 等话题里
**近几天发布**的视频，只要标签**或**文案命中你设的关键词就纳入观察，每 ~90 分钟量一次真实点赞，
挑出**涨得最快的原创新歌**（Rising / Watch / Breaking 三级），**直接在对话里**告诉你——
不发任何外部服务、不用任何 key。目标不是"找爆款"，而是"尽早逮住正在起量的原创新歌"。

## 装法（3 步）

1. **拉代码：**
   ```bash
   git clone https://github.com/zhuojinglyu01/douyin-music-monitor.git ~/douyin-music-monitor
   ```
2. **放 skill：** 把本仓库 `skill/SKILL.md` 放进你 agent 的技能目录
   （Claude Code / Cowork：`~/.claude/skills/douyin-monitor/SKILL.md`）。
3. **让 agent 装好：** 新开一个会话，对它说
   **"帮我把抖音监控装好并登录"** —— 它会照 SKILL.md 跑 `npm install`、
   建 `config.json`、拉起扫码登录，然后开始跑并把命中贴进对话。

## 前置要求

- **Node 18+**、**装了 Google Chrome**（引擎驱动真实 Chrome，无头会被抖音风控拦）
- 一个抖音**小号**（别用主力号；登录态只存你本机 `data/profile/`，不进 git）

## 之后怎么用

自然说就行：「看下抖音榜」「现在中了哪些」「暂停监控」「Watch 门槛改 1500」
「加个话题 新歌demo」「重新登录」…… agent 会跑对应命令、把结果回你，
并在后台守望——有新命中或抓取失效（"失明"）会主动冒泡。

⚠️ 灰色地带、需养号：用小号、别跑太频繁；抖音改版偶尔会让抓取失效
（日志出现"没抓到搜索接口"），届时让 agent 按 SKILL.md 的排查小修 `lib/scrape.js`。
安全：`config.json` 和 `data/` 都已 gitignore，登录态和配置永远不会进 git。
