// 统一路径：开发时用引擎自身目录；打包成 App 后由 DYMON_HOME 指到用户可写目录。
// 不设 DYMON_HOME 时行为和以前完全一致（不影响现有运行）。
import { fileURLToPath } from "node:url";
import path from "node:path";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE = path.join(LIB_DIR, ".."); // 引擎根目录（只读，打包后在 App 内）
export const HOME = process.env.DYMON_HOME || ENGINE; // 可写根目录

export const CONFIG = path.join(HOME, "config.json");
export const DATA_DIR = path.join(HOME, "data");
export const PROFILE = path.join(DATA_DIR, "profile");
export const RISING = path.join(DATA_DIR, "rising_list.json");
export const SNAPSHOTS = path.join(DATA_DIR, "snapshots.json");
export const HASHTAG_SNAPSHOTS = path.join(DATA_DIR, "hashtag_snapshots.json");
export const MONITOR_OUT = path.join(DATA_DIR, "monitor.out");
export const ALERTS_LOG = path.join(DATA_DIR, "alerts.log");
export const ALERTS_FEED = path.join(DATA_DIR, "alerts-feed.jsonl"); // 推到"对话流"用:结构化,由 agent 读取转达
