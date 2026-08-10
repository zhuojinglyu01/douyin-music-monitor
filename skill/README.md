# 抖音音乐飙升监控 · Skill 合包（Cowork / 本地 agent 版）

给**用 Cowork（或其它能操作电脑的 AI agent）**的朋友。装好后，在 agent 里一句话就能
查/控这个监控：它盯 #新歌 / #原创音乐 等话题的新视频，某条 24h 涨赞破阈值就微信告诉你。

## 里面有什么

```
SKILL.md      ← 技能说明（放进你 agent 的 skills 目录）
engine/       ← 监控引擎（Node 代码，放到 ~/douyin-music-monitor/）
README.md     ← 本文件
```

> 不含任何私密信息：没有登录态、没有 Server酱 key，需要你自己登录、填自己的 key。

## 装法（3 步）

1. **放引擎**：把 `engine/` 整个复制到你的用户主目录，改名成 `douyin-music-monitor`
   —— 即最终路径是 `~/douyin-music-monitor/`（macOS/Linux）或 `C:\Users\你\douyin-music-monitor\`（Windows）。
2. **放 skill**：把 `SKILL.md` 放进你 agent 的技能目录。
   - Claude Code / Cowork：`~/.claude/skills/douyin-monitor/SKILL.md`
   - 其它 agent：按它的技能安装方式放。
3. **让 agent 装好**：新开一个会话，对 agent 说
   **"帮我把抖音监控装好并登录"** —— 它会照 SKILL.md 里的「首次安装」跑
   `npm install`、拉起扫码登录、引导你填 Server酱 key。

## 前置要求

- **Node 18+**、**装了 Google Chrome**
- 一个抖音**小号**（别用主力号）
- 一个 **Server酱 SendKey**（https://sct.ftqq.com ，关注并绑定微信，用来收推送）

## 之后怎么用

在 agent 里自然说就行：「看下抖音榜」「暂停监控」「预警门槛改 1000」「加个话题 新歌demo」
「给我测一发」…… 它会跑对应命令、把结果回你。

⚠️ 灰色地带、需养号：用小号、别太频繁；抖音改版可能让抓取失效，届时让 agent 小修 `lib/scrape.js`。
