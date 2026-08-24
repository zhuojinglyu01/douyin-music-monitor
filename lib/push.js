// 推送层。默认 none：只在终端打印 + 落地到 data/alerts.log。
// 想推到微信，把 config.push.type 改成 serverchan / wecombot / pushdeer 并填 key。
import { appendFile, mkdir } from "node:fs/promises";
import { ALERTS_LOG as LOG, ALERTS_FEED as FEED, DATA_DIR } from "./paths.js";

export async function push(cfg, title, body) {
  // 无论哪种渠道：都落地 alerts.log(人看) + alerts-feed.jsonl(结构化,给"对话流"读取转达)
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(LOG, `\n[${new Date().toISOString()}] ${title}\n${body}\n`);
    await appendFile(FEED, JSON.stringify({ t: Date.now(), title, body }) + "\n");
  } catch {}

  const type = cfg?.type || "none";
  // none = 只落本地;feed = 推到"对话流"(即只写 feed,由 agent 转达,不发外部)
  if (type === "none" || type === "feed") {
    console.log(`\n🔔 ${title}\n${body}\n`);
    return;
  }
  try {
    if (type === "serverchan") {
      // 优先读环境变量 SERVERCHAN_SENDKEY，其次读 config
      const key = process.env.SERVERCHAN_SENDKEY || cfg.serverchan?.sendkey;
      const r = await fetch(`https://sctapi.ftqq.com/${key}.send`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ title, desp: body }),
      });
      const j = await r.json().catch(() => ({}));
      // Server酱 成功 code=0；否则如实报错（免费版每天约 5 条，超了会被拒）
      if (j.code !== 0) throw new Error(`Server酱未送达: ${j.message || j.code || r.status}（常见原因：当天免费额度用尽，次日 0 点重置）`);
    } else if (type === "wecombot") {
      await fetch(cfg.wecombot.webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msgtype: "text", text: { content: `${title}\n${body}` } }),
      });
    } else if (type === "pushdeer") {
      await fetch("https://api2.pushdeer.com/message/push", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ pushkey: cfg.pushdeer.pushkey, text: title, desp: body }),
      });
    } else if (type === "wecomapp") {
      // 企业微信【自建应用】——不用建群，直接推给本人。需 corpid + agentid + secret。
      const { corpid, secret, agentid, touser = "@all" } = cfg.wecomapp || {};
      if (!corpid || !secret || !agentid) throw new Error("wecomapp 缺 corpid/secret/agentid");
      const tr = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpid}&corpsecret=${secret}`);
      const tj = await tr.json().catch(() => ({}));
      if (!tj.access_token) throw new Error(`取 token 失败: ${tj.errmsg || tj.errcode || tr.status}`);
      const sr = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${tj.access_token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ touser, msgtype: "text", agentid, text: { content: `${title}\n${body}` } }),
      });
      const sj = await sr.json().catch(() => ({}));
      if (sj.errcode !== 0) throw new Error(`应用消息未送达: ${sj.errmsg || sj.errcode}`);
    }
    console.log(`🔔 已推送: ${title}`);
  } catch (e) {
    console.error(`推送失败(${type}):`, e.message, "— 已存 data/alerts.log");
  }
}
