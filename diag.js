// 一次性诊断：打开一个音乐人主页，把 aweme/post 接口的真实返回打出来，
// 并检查页面上有没有验证码/滑块。看清风控到底是哪种。
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const USER_DATA = new URL("./data/profile", import.meta.url).pathname;
const cfg = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));
const artist = cfg.artists[0];

const ctx = await chromium.launchPersistentContext(USER_DATA, {
  headless: false,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] || (await ctx.newPage());

page.on("response", async (resp) => {
  const url = resp.url();
  if (!url.includes("/aweme/post/")) return;
  let info = { status: resp.status() };
  try {
    const j = await resp.json();
    info.status_code = j?.status_code;
    info.status_msg = j?.status_msg;
    info.aweme_list_len = (j?.aweme_list || []).length;
    info.keys = Object.keys(j || {}).slice(0, 12);
  } catch (e) {
    info.parseErr = e.message;
  }
  console.log("📡 API:", JSON.stringify(info));
});

console.log(`打开 ${artist.name} 主页诊断中…`);
await page.goto(artist.url, { waitUntil: "domcontentloaded" }).catch((e) => console.log("nav:", e.message));
await page.waitForTimeout(8000);

const diag = await page.evaluate(() => {
  const t = document.body?.innerText || "";
  return {
    hasServiceErr: t.includes("服务异常"),
    hasLoginWall: t.includes("登录后即可") || t.includes("扫码登录"),
    hasCaptcha: /验证|滑块|拖动|captcha|verify/i.test(t) ||
      !!document.querySelector('[id*="captcha"],[class*="captcha"],[class*="verify"]'),
    fansShown: /粉丝|获赞/.test(t),
    textHead: t.replace(/\s+/g, " ").slice(0, 160),
  };
});
console.log("🔎 页面:", JSON.stringify(diag, null, 0));
console.log("\n（浏览器窗口保留 40 秒——如果上面 hasCaptcha=true，请在窗口里手动完成验证/滑块，再回来告诉我）");
await page.waitForTimeout(40000);
await ctx.close();
process.exit(0);
