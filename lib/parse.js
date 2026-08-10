// 把 "1187" / "12.5K" / "145.2万" / "7500.1w" 之类的点赞文本转成数字。
// 注意：走接口时 digg_count 本来就是整数，用不上这个；只有 DOM 兜底时才需要。
export function parseCount(text) {
  if (text == null) return null;
  if (typeof text === "number") return text;
  const s = String(text).trim().replace(/,/g, "");
  const m = s.match(/^([\d.]+)\s*([wWkK万亿]?)/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  switch (m[2]) {
    case "k":
    case "K":
      n *= 1e3;
      break;
    case "w":
    case "W":
    case "万":
      n *= 1e4;
      break;
    case "亿":
      n *= 1e8;
      break;
  }
  return Math.round(n);
}
