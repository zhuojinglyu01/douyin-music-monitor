// 一次性登录：打开一个【带独立配置文件的真浏览器】，你用小号扫码/验证码登录抖音。
// 登录态直接持久化在 data/profile/ 里，脚本自动检测登录成功，不用你回终端按键。
// 你的密码只在抖音页面里输，脚本只读登录后写下的 cookie，不碰密码。
import { chromium } from "playwright";

import { PROFILE as USER_DATA, DATA_DIR } from "./lib/paths.js";
import { mkdir } from "node:fs/promises";
await mkdir(DATA_DIR, { recursive: true }).catch(() => {});

const ctx = await chromium.launchPersistentContext(USER_DATA, {
  channel: "chrome", // 用系统装的正版 Chrome，别用 Playwright 自带 Chromium（新版 macOS 上会崩）
  headless: false,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  args: [
    "--disable-blink-features=AutomationControlled", // 去掉“我是自动化”的标记
    "--disable-dev-shm-usage",
  ],
});

// 页面级异常不让它掀翻整个进程（抖音登录后偶尔会让渲染进程抖一下）
process.on("unhandledRejection", (e) => console.log("（忽略一个瞬时异常）", e?.message || e));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n👉 在弹出的浏览器里用【小号】登录抖音（扫码或手机验证码都行）。");
console.log("   ⚠️ 别手动关窗口——登录成功后脚本会自动检测并保存，然后自己关。\n");

// 轮询是否出现登录 cookie（抖音登录后会写 sessionid）。用定时器 sleep，不依赖任何页面。
const deadline = Date.now() + 5 * 60 * 1000; // 最多等 5 分钟
let loggedIn = false;
while (Date.now() < deadline) {
  await sleep(3000);
  let cookies = [];
  try {
    cookies = await ctx.cookies();
  } catch {
    continue; // 上下文正忙，下一轮再查
  }
  if (cookies.some((c) => /^sessionid(_ss)?$/i.test(c.name) && c.value)) {
    loggedIn = true;
    break;
  }
}

if (loggedIn) {
  console.log("✅ 检测到登录成功，登录态已保存在 data/profile/。");
} else {
  console.log("⌛ 5 分钟内没检测到登录。没关系——只要你确实登录了，profile 也已经存下，");
  console.log("   直接跑 `npm run once` 试试；不行再跑一次 `npm run login`。");
}
await page.waitForTimeout(1500);
await ctx.close();
process.exit(0);
