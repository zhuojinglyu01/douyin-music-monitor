// 企业微信回调加解密（等价官方 WXBizMsgCrypt）。零依赖，用 node:crypto。
// 参考企微文档：AES-256-CBC，key=base64(EncodingAESKey+"=")，iv=key[:16]，PKCS7 padding。
import crypto from "node:crypto";

export function sha1(...args) {
  return crypto.createHash("sha1").update(args.sort().join("")).digest("hex");
}

// 校验签名：msg_signature 应等于 sha1(sort(token, timestamp, nonce, encrypt))
export function verify(token, timestamp, nonce, encrypt, signature) {
  return sha1(token, timestamp, nonce, encrypt) === signature;
}

function aesKey(encodingAESKey) {
  return Buffer.from(encodingAESKey + "=", "base64"); // 32 字节
}

// 解密 <Encrypt> → { message, corpid }
export function decrypt(encodingAESKey, encrypt) {
  const key = aesKey(encodingAESKey);
  const iv = key.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  let buf = Buffer.concat([decipher.update(Buffer.from(encrypt, "base64")), decipher.final()]);
  // 去 PKCS7 padding
  const pad = buf[buf.length - 1];
  buf = buf.subarray(0, buf.length - pad);
  // 结构：16字节随机 + 4字节msg_len(大端) + msg + corpid
  const msgLen = buf.readUInt32BE(16);
  const message = buf.subarray(20, 20 + msgLen).toString("utf8");
  const corpid = buf.subarray(20 + msgLen).toString("utf8");
  return { message, corpid };
}

// 加密（被动回复时用；本项目主要走主动发消息，这个留着备用）
export function encrypt(encodingAESKey, corpid, message) {
  const key = aesKey(encodingAESKey);
  const iv = key.subarray(0, 16);
  const rand = crypto.randomBytes(16);
  const msg = Buffer.from(message, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msg.length, 0);
  let raw = Buffer.concat([rand, lenBuf, msg, Buffer.from(corpid, "utf8")]);
  const padLen = 32 - (raw.length % 32);
  raw = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(raw), cipher.final()]).toString("base64");
}

// 从 XML 里取某个标签（企微回调是简单 XML，够用）
export function pickXml(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`)) ||
    xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}
