// 极简本地存储：上一轮每条视频的点赞快照，用来算增速。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SNAPSHOTS as SNAP, HASHTAG_SNAPSHOTS as HSNAP } from "./paths.js";

async function load(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}
async function save(path, map) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(map, null, 2));
}

// 名单监控用：{ [videoId]: { likes, ts, title, artist } }
export const loadSnapshots = () => load(SNAP);
export const saveSnapshots = (map) => save(SNAP, map);

// 话题监控用：{ [videoId]: { likes, ts, dayKey, dayBaseLikes, lastAlertDay, title, author, term } }
export const loadHashtagSnapshots = () => load(HSNAP);
export const saveHashtagSnapshots = (map) => save(HSNAP, map);
