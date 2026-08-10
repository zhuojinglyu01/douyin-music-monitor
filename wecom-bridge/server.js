// 企业微信 ⇄ 抖音监控 桥。
// 收企微成员的文字指令 → 调 ../ctl.js → 把结果主动发回该成员的企微。
// 回调验证走加解密；回复走主动发消息 API（异步、不受 5 秒被动回复限制）。
import http from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { verify, decrypt, pickXml } from "./crypto.js";

const CFG = new URL("./wecom.config.json", import.meta.url).pathname;
const CTL = new URL("../ctl.js", import.meta.url).pathname;
let cfg;

// —— 把成员发来的自然语言/命令，映射成 ctl.js 参数 ——
function toCtlArgs(text) {
  const t = (text || "").trim();
  if (/^(状态|status|在吗|运行)/i.test(t)) return ["status"];
  if (/(榜|rising|列表|飙升|榜单)/i.test(t)) {
    const n = (t.match(/\d+/) || [])[0];
    return n ? ["rising", n] : ["rising"];
  }
  if (/(配置|条件|config|设置)/i.test(t)) return ["config"];
  if (/(暂停|停一?下|停止|pause)/i.test(t)) return ["pause"];
  if (/(恢复|继续|启动|开始|resume)/i.test(t)) return ["resume"];
  if (/(日志|log)/i.test(t)) return ["log"];
  // 改阈值：如「预警 1000」「Breaking 3000」「间隔 120」「天数 5」
  let m;
  if ((m = t.match(/(预警|alert)\s*(\d+)/i))) return ["set", "alert", m[2]];
  if ((m = t.match(/(rising|上升)\s*(\d+)/i))) return ["set", "rising", m[2]];
  if ((m = t.match(/(breaking|爆)\s*(\d+)/i))) return ["set", "breaking", m[2]];
  if ((m = t.match(/(间隔|频率|interval)\s*(\d+)/i))) return ["set", "interval", m[2]];
  if ((m = t.match(/(天数|days)\s*(\d+)/i))) return ["set", "days", m[2]];
  if ((m = t.match(/加话题\s*(\S+)/))) return ["hashtag", "add", m[1]];
  if ((m = t.match(/删话题\s*(\S+)/))) return ["hashtag", "rm", m[1]];
  return null; // 不认识 → 回帮助
}

const HELP = `我能听懂：
· 状态 / 榜单[数字] / 配置 / 日志
· 暂停 / 恢复
· 预警 1000（改预警阈值）· 间隔 120 · 天数 5
· 加话题 XX · 删话题 XX`;

function runCtl(args) {
  return new Promise((resolve) => {
    execFile("node", [CTL, ...args], { timeout: 30000 }, (err, stdout, stderr) => {
      resolve((stdout || "").trim() || (stderr || "").trim() || (err ? "执行出错" : "（无输出）"));
    });
  });
}

// —— 企业微信主动发文本消息 ——
let tokenCache = { val: null, exp: 0 };
async function getToken() {
  if (tokenCache.val && Date.now() < tokenCache.exp) return tokenCache.val;
  const r = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${cfg.corpid}&corpsecret=${cfg.corpsecret}`);
  const j = await r.json();
  if (!j.access_token) throw new Error("gettoken 失败: " + JSON.stringify(j));
  tokenCache = { val: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return j.access_token;
}
async function sendText(touser, content) {
  const token = await getToken();
  const r = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ touser, msgtype: "text", agentid: Number(cfg.agentid), text: { content } }),
  });
  const j = await r.json();
  if (j.errcode !== 0) console.error("发送失败:", JSON.stringify(j));
}

const readBody = (req) =>
  new Promise((res) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => res(d));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const q = url.searchParams;
  const [sig, ts, nonce] = [q.get("msg_signature"), q.get("timestamp"), q.get("nonce")];

  // 回调 URL 验证（企微后台点“保存”时触发）
  if (req.method === "GET" && q.get("echostr")) {
    const echo = q.get("echostr");
    if (!verify(cfg.token, ts, nonce, echo, sig)) return res.writeHead(401).end("bad sig");
    const { message } = decrypt(cfg.aesKey, echo);
    return res.writeHead(200).end(message);
  }

  // 收消息
  if (req.method === "POST") {
    const body = await readBody(req);
    const encrypt = pickXml(body, "Encrypt");
    if (!encrypt || !verify(cfg.token, ts, nonce, encrypt, sig)) return res.writeHead(401).end("bad sig");
    res.writeHead(200).end(""); // 先回空 200，避免企微重试；结果走主动发送

    try {
      const { message } = decrypt(cfg.aesKey, encrypt);
      const from = pickXml(message, "FromUserName");
      const msgType = pickXml(message, "MsgType");
      if (msgType !== "text") return;
      if (cfg.allowUser && from !== cfg.allowUser) return sendText(from, "⛔ 无权限");
      const content = pickXml(message, "Content");
      const args = toCtlArgs(content);
      const reply = args ? await runCtl(args) : HELP;
      await sendText(from, reply.slice(0, 1900)); // 企微文本上限
    } catch (e) {
      console.error("处理失败:", e.message);
    }
    return;
  }
  res.writeHead(200).end("ok");
});

const boot = async () => {
  cfg = JSON.parse(await readFile(CFG, "utf8"));
  server.listen(cfg.port, () => console.log(`企微桥已启动，监听 :${cfg.port}（回调路径随意，指到本机此端口即可）`));
};
boot().catch((e) => {
  console.error("启动失败（先把 wecom.config.example.json 复制成 wecom.config.json 并填好）：", e.message);
  process.exit(1);
});
