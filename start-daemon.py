#!/usr/bin/env python3
"""以独立会话（setsid 等效）启动抖音监控，免疫进程组回收，替代被系统限制的 launchd。

用法:
  python3 start-daemon.py start    启动（已在运行则不重复启动）
  python3 start-daemon.py stop     停止
  python3 start-daemon.py status   查看状态
"""
import os
import subprocess
import sys

HOME = os.path.expanduser("~")
ENGINE = os.path.join(HOME, "douyin-music-monitor")
NODE = "/opt/homebrew/bin/node"
MONITOR = os.path.join(ENGINE, "monitor.js")
OUT = os.path.join(ENGINE, "data", "monitor.out")
ERR = os.path.join(ENGINE, "data", "monitor.err")
PID_FILE = os.path.join(ENGINE, "data", "monitor.pid")


def running():
    try:
        out = subprocess.run(
            ["pgrep", "-f", "douyin-music-monitor/monitor.js"],
            capture_output=True, text=True)
        return [p for p in out.stdout.split() if p.strip()]
    except Exception:
        return []


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "start"

    if action == "stop":
        subprocess.run(["pkill", "-f", "douyin-music-monitor/monitor.js"], check=False)
        subprocess.run(["pkill", "-f", "caffeinate.*douyin-music-monitor"], check=False)
        print("⏹️ 已停止。")
        return

    if action == "status":
        pids = running()
        print("🟢 运行中 PID: " + " ".join(pids) if pids else "⏸️ 未运行")
        return

    # ---- start ----
    pids = running()
    if pids:
        print(f"🟢 已在运行 PID: {' '.join(pids)}，不重复启动。")
        return

    os.makedirs(os.path.join(ENGINE, "data"), exist_ok=True)
    out = open(OUT, "ab", buffering=0)
    err = open(ERR, "ab", buffering=0)
    # start_new_session=True → 子进程调用 setsid()，自成会话组长，
    # 父 shell 退出/进程组被杀都不影响它，等效 nohup+setsid
    p = subprocess.Popen(
        ["caffeinate", "-s", "-i", NODE, MONITOR],
        cwd=ENGINE,
        stdin=subprocess.DEVNULL,
        stdout=out,
        stderr=err,
        start_new_session=True,
        close_fds=True,
    )
    with open(PID_FILE, "w") as f:
        f.write(str(p.pid))
    print(f"🚀 已启动 PID: {p.pid}（独立会话 + caffeinate 防休眠）")
    print(f"   日志: {OUT}")


if __name__ == "__main__":
    main()
