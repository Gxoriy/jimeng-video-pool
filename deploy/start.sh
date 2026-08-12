#!/usr/bin/env bash
#
# aigen-panel 后端进程管理脚本（无 systemd 时备用）
# 用法（在 deploy/ 目录下执行，或任意位置指定路径）：
#   ./start.sh            # 后台启动（默认）
#   ./start.sh start      # 后台启动（等同无参数）
#   ./start.sh foreground # 前台启动（日志直接输出，Ctrl+C 退出）
#   ./start.sh status     # 查看运行状态与 PID
#   ./start.sh stop       # 停止
#   ./start.sh restart    # 重启
#
# 日志：backend/logs/app.log
# PID 文件：backend/logs/app.pid
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
LOG_DIR="$BACKEND_DIR/logs"
LOG_FILE="$LOG_DIR/app.log"
PID_FILE="$LOG_DIR/app.pid"
BIN="node dist/main.js"

cd "$BACKEND_DIR"
export NODE_ENV=production
mkdir -p "$LOG_DIR"

is_running() {
  # 返回 0 表示运行中
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || echo)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  # 兜底：pidfile 失效时按进程特征判断
  if pgrep -f "$BIN" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

get_pid() {
  if [ -f "$PID_FILE" ]; then
    cat "$PID_FILE" 2>/dev/null || true
  fi
}

do_start() {
  if is_running; then
    local pid
    pid="$(get_pid)"
    echo "==> 后端已在运行 (PID=$pid)，无需重复启动。"
    echo "    日志: tail -f $LOG_FILE"
    return 0
  fi
  echo "==> 后台启动后端 (日志: $LOG_FILE)"
  nohup node "$BIN" > "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  # 短暂等待，确认进程未立即退出
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "    已启动 PID=$pid"
    echo "    状态: ./start.sh status   日志: tail -f $LOG_FILE"
  else
    echo "::error:: 启动后进程立即退出，请检查日志: $LOG_FILE"
    rm -f "$PID_FILE"
    return 1
  fi
}

do_foreground() {
  if is_running; then
    echo "::warn:: 已有后端在运行 (PID=$(get_pid))，前台将另起一个进程。建议先 ./start.sh stop"
  fi
  echo "==> 前台启动 (Ctrl+C 退出)"
  exec node "$BIN"
}

do_status() {
  if is_running; then
    local pid
    pid="$(get_pid)"
    echo "==> 运行中 (PID=$pid)"
    echo "    日志: tail -f $LOG_FILE"
  else
    echo "==> 未运行"
    return 3
  fi
}

do_stop() {
  if ! is_running; then
    echo "==> 未找到运行中的后端进程"
    rm -f "$PID_FILE"
    return 0
  fi
  local pid
  pid="$(get_pid)"
  echo "==> 停止后端 (PID=$pid)..."
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    # 最多等待 10s 优雅退出
    local i=0
    while kill -0 "$pid" 2>/dev/null; do
      i=$((i + 1))
      if [ "$i" -ge 10 ]; then
        echo "    10s 内未退出，强制 kill -9"
        kill -9 "$pid" 2>/dev/null || true
        break
      fi
      sleep 1
    done
  fi
  # 兜底清理可能残留的同类进程
  pkill -f "$BIN" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "    已停止"
}

do_restart() {
  do_stop || true
  sleep 1
  do_start
}

case "${1:-start}" in
  start)     do_start ;;
  foreground) do_foreground ;;
  status)    do_status ;;
  stop)      do_stop ;;
  restart)   do_restart ;;
  *)
    echo "未知命令: $1" >&2
    echo "用法: $0 [start|frontend|status|stop|restart]" >&2
    exit 1
    ;;
esac
