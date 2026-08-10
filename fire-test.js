// 一次性：挑当前名单里涨最快的真实视频，走真实推送链路发一条到微信。
// 用来验证"检测→推送"整条链路。数据真实，只是绕过阈值强制触发。
import { readFile } from "node:fs/promises";
import { loadHashtagSnapshots } from "./lib/store.js";
import { push } from "./lib/push.js";

const cfg = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));
const snaps = await loadHashtagSnapshots();
const now = Date.now();

const rows = Object.values(snaps)
  .filter((r) => Array.isArray(r.samples) && r.samples.length >= 2)
  .map((r) => {
    const f = r.samples[0], l = r.samples[r.samples.length - 1];
    return {
      gain: l.l - f.l,
      spanH: ((l.t - f.t) / 3.6e6).toFixed(1),
      rate: (l.t > f.t ? ((l.l - f.l) / ((l.t - f.t) / 3.6e6)) : 0).toFixed(0),
      likes: l.l, title: r.title || "", author: r.author || "?", url: r.url, tags: r.tags || [],
    };
  })
  .sort((a, b) => b.gain - a.gain);

if (!rows.length) {
  console.log("名单里还没有≥2采样的视频，无法演示。");
  process.exit(0);
}
const top = rows[0];
console.log("涨最快的一条:", JSON.stringify(top));

await push(
  cfg.push,
  `🔔 演示预警 — ${top.author}`,
  `${top.title}
——
这是【演示】：当前名单里涨最快的真实视频。
近 ${top.spanH} 小时 +${top.gain} 赞（约 ${top.rate} 赞/时），当前 ${top.likes} 赞。
真出现 24h 涨破 2000/5000 时，就是这个格式推给你。
标签：${top.tags.join(" / ")}
${top.url}`
);
console.log("✅ 已走真实推送链路发出。");
process.exit(0);
