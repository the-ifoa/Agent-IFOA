#!/usr/bin/env bash
# Start backend (port 5000) and frontend (port 5173) in background.
# Kills anything already on those ports, writes logs to ./logs, frees the terminal.
#
# Usage:
#   ./start.sh         start both
#   ./start.sh stop    stop both

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
LOG_DIR="$ROOT/logs"
BACKEND_LOG_DIR="$LOG_DIR/backend"
FRONTEND_LOG_DIR="$LOG_DIR/frontend"
PID_DIR="$LOG_DIR/.pids"

BACKEND_PORT="${BACKEND_PORT:-5000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

mkdir -p "$BACKEND_LOG_DIR" "$FRONTEND_LOG_DIR" "$PID_DIR"

kill_port() {
  local port=$1 pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || fuser "$port"/tcp 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "Port $port in use (PID: $(echo $pids | tr '\n' ' ')) - killing..."
    kill $pids 2>/dev/null
    sleep 1
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || fuser "$port"/tcp 2>/dev/null)
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  fi
}

kill_saved() {
  local name=$1 pidfile="$PID_DIR/$1.pid"
  if [ -f "$pidfile" ]; then
    local pid; pid=$(cat "$pidfile")
    # kill whole process group (npm -> node/nodemon/vite children)
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    rm -f "$pidfile"
    echo "Stopped $name (PID $pid)"
  fi
}

stop_all() {
  kill_saved backend
  kill_saved frontend
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
}

if [ "${1:-}" = "stop" ]; then
  stop_all
  echo "All stopped."
  exit 0
fi

stop_all

TS=$(date +%Y-%m-%d_%H-%M-%S)
BACKEND_LOG="$BACKEND_LOG_DIR/backend_$TS.log"
FRONTEND_LOG="$FRONTEND_LOG_DIR/frontend_$TS.log"

# Backend (nodemon via npm run dev)
cd "$BACKEND_DIR" || exit 1
setsid nohup npm run dev >"$BACKEND_LOG" 2>&1 < /dev/null &
echo $! > "$PID_DIR/backend.pid"
ln -sf "$BACKEND_LOG" "$BACKEND_LOG_DIR/latest.log"

# Frontend (vite)
cd "$FRONTEND_DIR" || exit 1
setsid nohup npm run dev -- --port "$FRONTEND_PORT" >"$FRONTEND_LOG" 2>&1 < /dev/null &
echo $! > "$PID_DIR/frontend.pid"
ln -sf "$FRONTEND_LOG" "$FRONTEND_LOG_DIR/latest.log"

cd "$ROOT"

echo ""
echo "Backend  -> http://localhost:$BACKEND_PORT  (PID $(cat "$PID_DIR/backend.pid"))"
echo "Frontend -> http://localhost:$FRONTEND_PORT  (PID $(cat "$PID_DIR/frontend.pid"))"
echo ""
echo "Logs:"
echo "  tail -f logs/backend/latest.log"
echo "  tail -f logs/frontend/latest.log"
echo "Stop: ./start.sh stop"
