#!/usr/bin/env bash
# Manage backend (port 5000) + frontend (port 5173) as systemd *user* services.
# No sudo needed. Services auto-restart on crash.
# Logs: each run writes logs/<backend|frontend>/<name>_<timestamp>.log
#       (logs/<name>/latest.log points at the current run) and also journald.
#
# Usage: ./service.sh <command> [backend|frontend|all]   (target defaults to all)
#
#   install     write unit files to ~/.config/systemd/user and reload systemd
#   uninstall   stop, disable and remove the unit files
#   start       start service(s); kills anything already on the ports first
#   stop        stop service(s)
#   restart     same as start (stop, free ports, start)
#   status      show status of service(s)
#   logs        follow backend + frontend logs (Ctrl+C to exit); -n = last 200 lines, no follow
#   enable      start automatically when you log in
#   disable     stop starting automatically on login
#
# Re-run `./service.sh install` after switching node versions with nvm
# (the node bin path is baked into the unit files).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
PREFIX="agent-service"
BACKEND_PORT="${BACKEND_PORT:-5000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOG_DIR="$ROOT/logs"
KEEP_LOGS="${KEEP_LOGS:-20}"   # log files kept per service

unit() { echo "$PREFIX-$1.service"; }

targets() {
  case "${1:-all}" in
    backend)  echo "$(unit backend)" ;;
    frontend) echo "$(unit frontend)" ;;
    all)      echo "$(unit backend) $(unit frontend)" ;;
    *) echo "Unknown target '$1' (use backend|frontend|all)" >&2; exit 1 ;;
  esac
}

ensure_installed() {
  if [ ! -f "$UNIT_DIR/$(unit backend)" ] || [ ! -f "$UNIT_DIR/$(unit frontend)" ]; then
    echo "Units not installed - installing first..."
    install_units
  fi
}

write_unit() {
  # $1=name $2=workdir $3=port $4=npm args
  local name=$1 dir=$2 port=$3 args=$4
  local node_bin; node_bin="$(dirname "$(command -v node)")"
  cat >"$UNIT_DIR/$(unit "$name")" <<EOF
[Unit]
Description=Agent-service $name (port $port)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$dir
Environment=PATH=$node_bin:/usr/local/bin:/usr/bin:/bin
Environment=FORCE_COLOR=0
# Free the port if a stray process still holds it
ExecStartPre=-/usr/bin/fuser -k $port/tcp
ExecStart=/bin/bash $ROOT/service.sh _run $name $args
Restart=on-failure
RestartSec=3
KillMode=control-group
TimeoutStopSec=10

[Install]
WantedBy=default.target
EOF
}

install_units() {
  command -v node >/dev/null || { echo "node not found in PATH" >&2; exit 1; }
  mkdir -p "$UNIT_DIR"
  write_unit backend  "$ROOT/backend"  "$BACKEND_PORT"  "run dev"
  write_unit frontend "$ROOT/frontend" "$FRONTEND_PORT" "run dev -- --port $FRONTEND_PORT --strictPort"
  systemctl --user daemon-reload
  echo "Installed $(unit backend) and $(unit frontend) in $UNIT_DIR"
}

uninstall_units() {
  for u in $(targets all); do
    systemctl --user disable --now "$u" 2>/dev/null || true
    rm -f "$UNIT_DIR/$u"
  done
  systemctl --user daemon-reload
  echo "Uninstalled."
}

kill_group() {
  # Kill a process and its whole process group (npm -> sh -> nodemon/vite -> node)
  local pid=$1 pgid
  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
  if [ -n "$pgid" ] && [ "$pgid" != "$$" ]; then
    kill -- -"$pgid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  else
    kill "$pid" 2>/dev/null || true
  fi
}

in_our_unit() {
  grep -q "$PREFIX-" "/proc/$1/cgroup" 2>/dev/null
}

free_ports() {
  # $@ = names (backend|frontend). Units must already be stopped.
  local name port pid pids
  for name in "$@"; do
    [ "$name" = backend ] && port=$BACKEND_PORT || port=$FRONTEND_PORT

    # 1. stray nodemon/vite started from this repo outside systemd
    for pid in $(pgrep -f "$ROOT/$name/node_modules/.bin/" || true); do
      in_our_unit "$pid" && continue
      echo "Killing stray $name process $pid"
      kill_group "$pid"
    done

    # 2. anything still listening on the port
    pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "Port $port in use (PID $(echo $pids | tr '\n' ' ')) - killing..."
      for pid in $pids; do kill_group "$pid"; done
      sleep 1
      pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)
      [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    fi
  done
}

names() {
  case "${1:-all}" in
    all) echo "backend frontend" ;;
    *)   echo "$1" ;;
  esac
}

do_start() {
  local tgt=${1:-all}
  install_units >/dev/null   # always refresh units so script changes apply
  systemctl --user stop $(targets "$tgt") 2>/dev/null || true
  free_ports $(names "$tgt")
  systemctl --user start $(targets "$tgt")
  urls
  sleep 2
  local n
  for n in $(names "$tgt"); do
    echo ""
    echo "== $n log: $LOG_DIR/$n/latest.log =="
    tail -n 15 "$LOG_DIR/$n/latest.log" 2>/dev/null || echo "(no output yet)"
  done
  echo ""
  echo "Follow logs: ./service.sh logs [backend|frontend]"
}

# Called by the systemd unit: run npm, writing output to a per-run log file
# (and stdout, which goes to journald).
run_service() {
  local name=$1; shift
  local dir="$LOG_DIR/$name" ts file
  mkdir -p "$dir"
  ts=$(date +%Y-%m-%d_%H-%M-%S)
  file="$dir/${name}_$ts.log"
  ln -sfn "$file" "$dir/latest.log"
  # prune old runs
  ls -1t "$dir"/"${name}"_*.log 2>/dev/null | tail -n +"$((KEEP_LOGS + 1))" | xargs -r rm -f || true
  cd "$ROOT/$name"
  npm "$@" 2>&1 | tee -a "$file"
}

urls() {
  echo "Backend  -> http://localhost:$BACKEND_PORT/api"
  echo "Frontend -> http://localhost:$FRONTEND_PORT"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  install)   install_units ;;
  uninstall) uninstall_units ;;
  start|restart) targets "${1:-all}" >/dev/null; do_start "${1:-all}" ;;
  stop)      systemctl --user stop $(targets "${1:-all}") 2>/dev/null || true
             free_ports $(names "${1:-all}"); echo "Stopped." ;;
  status)    systemctl --user --no-pager status $(targets "${1:-all}") || true ;;
  enable)    ensure_installed; systemctl --user enable $(targets "${1:-all}") ;;
  disable)   systemctl --user disable $(targets "${1:-all}") ;;
  _run)      run_service "$@" ;;
  logs)
    follow=1; tgt="all"
    for a in "$@"; do [ "$a" = "-n" ] && follow=0 || tgt="$a"; done
    targets "$tgt" >/dev/null
    files=(); for n in $(names "$tgt"); do files+=("$LOG_DIR/$n/latest.log"); done
    if [ "$follow" = 1 ]; then
      tail -n 50 -F "${files[@]}"
    else
      tail -n 200 "${files[@]}"
    fi
    ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
