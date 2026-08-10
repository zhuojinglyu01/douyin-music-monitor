// 推送层。默认 none：只在终端打印 + 落地到 data/alerts.log。
// 想推到微信，把 config.push.type 改成 serverchan / wecombot / pushdeer 并填 key。
import { appendFile, mkdir } from "node:fs/promises";
import { ALERTS_LOG as LOG, DATA_DIR } from "./paths.js";

export async function push(cfg, title, body) {
  // 无论哪种渠道，都先落地一份，方便回看
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(LOG, `\n[${new Date().toISOString()}] ${title}\n${body}\n`);
  } catch {}

  const type = cfg?.type || "none";
  if (type === "none") {
    console.log(`\n🔔 ${title}\n${body}\n`);
    return;
  }
  try {
    if (type === "serverchan") {
      // 优先读环境变量 SERVERCHAN_SENDKEY，其次读 config
      const key = process.env.SERVERCHAN_SENDKEY || cfg.serverchan?.sendkey;
      await fetch(`https://sctapi.ftqq.com/${key}.send`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ title, desp: body }),
      });
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
    }
    console.log(`🔔 已推送: ${title}`);
  } catch (e) {
    console.error(`推送失败(${type}):`, e.message, "— 已存 data/alerts.log");
  }
}
