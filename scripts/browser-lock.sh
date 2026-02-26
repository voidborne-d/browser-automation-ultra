#!/bin/bash
# browser-lock.sh — Playwright script runner with lock coordination
#
# Connects Playwright to OpenClaw's EXISTING Chrome (no kill/restart).
# Uses a lock file to prevent multiple Playwright scripts from running simultaneously.
# Chrome CDP supports multiple clients — OpenClaw browser tool and Playwright coexist,
# each on separate tabs.
#
# Usage:
#   browser-lock.sh run [--timeout S] <script> [args...]  — acquire lock → run → release
#   browser-lock.sh status                                 — show current state
#   browser-lock.sh release                                — force release stale lock
#
# Environment:
#   CDP_PORT        (default: 18800) — must match your browser profile's cdpPort
#   BROWSER_PROFILE (default: openclaw) — profile name for lock file isolation

set -euo pipefail

CDP_PORT="${CDP_PORT:-18800}"
BROWSER_PROFILE="${BROWSER_PROFILE:-openclaw}"
LOCK_FILE="/tmp/openclaw-browser-${BROWSER_PROFILE}.lock"
DEFAULT_TIMEOUT=300  # 5 minutes

# --- Lock management ---
# Lock file format: "PID TIMESTAMP"
write_lock() {
  echo "$$ $(date +%s)" > "$LOCK_FILE"
}

is_lock_alive() {
  if [ ! -f "$LOCK_FILE" ]; then
    return 1
  fi
  local shell_pid
  shell_pid=$(awk '{print $1}' "$LOCK_FILE")
  kill -0 "$shell_pid" 2>/dev/null
}

acquire() {
  if [ -f "$LOCK_FILE" ]; then
    if is_lock_alive; then
      local timestamp now age
      timestamp=$(awk '{print $2}' "$LOCK_FILE")
      now=$(date +%s)
      age=$(( now - ${timestamp:-0} ))
      if [ "$age" -gt "$DEFAULT_TIMEOUT" ]; then
        echo "⚠️ Lock is ${age}s old, force-releasing..."
        rm -f "$LOCK_FILE"
      else
        echo "❌ Lock held ($(cat "$LOCK_FILE")). Age: ${age}s. Use 'release' to force." >&2
        exit 1
      fi
    else
      echo "⚠️ Stale lock, cleaning..."
      rm -f "$LOCK_FILE"
    fi
  fi

  # Verify Chrome is running on CDP port
  if ! curl -s --max-time 2 "http://127.0.0.1:$CDP_PORT/json/version" &>/dev/null; then
    echo "❌ No Chrome on CDP port $CDP_PORT. Start it via OpenClaw: openclaw browser start" >&2
    exit 1
  fi
  echo "✅ Chrome ready (CDP: $CDP_PORT)"
  write_lock
}

release() {
  rm -f "$LOCK_FILE"
  echo "🔓 Released."
}

run_script() {
  local timeout=$DEFAULT_TIMEOUT

  # Parse --timeout flag
  if [ "${1:-}" = "--timeout" ]; then
    timeout="$2"
    shift 2
  fi

  if [ $# -lt 1 ]; then
    echo "Usage: browser-lock.sh run [--timeout S] <script.js> [args...]" >&2
    exit 1
  fi

  acquire

  local exit_code=0
  echo "▶ Running (timeout: ${timeout}s): node $*"

  # Export CDP_PORT so scripts can read it
  export CDP_PORT

  # Run with timeout
  local script_pid
  node "$@" &
  script_pid=$!

  # Update lock with script PID
  echo "$script_pid $(date +%s)" > "$LOCK_FILE"

  # Background watchdog
  (
    sleep "$timeout"
    if kill -0 "$script_pid" 2>/dev/null; then
      echo "⏰ Timeout (${timeout}s) — killing script PID $script_pid" >&2
      kill "$script_pid" 2>/dev/null
      sleep 2
      kill -0 "$script_pid" 2>/dev/null && kill -9 "$script_pid" 2>/dev/null
    fi
  ) &
  local watchdog_pid=$!

  wait "$script_pid" || exit_code=$?

  # Kill watchdog if script finished before timeout
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true

  release

  [ $exit_code -ne 0 ] && echo "❌ Script exited with code $exit_code"
  return $exit_code
}

status() {
  echo "--- Browser Lock Status ---"
  if [ -f "$LOCK_FILE" ]; then
    local shell_pid timestamp now age
    shell_pid=$(awk '{print $1}' "$LOCK_FILE")
    timestamp=$(awk '{print $2}' "$LOCK_FILE")
    now=$(date +%s)
    age=$(( now - ${timestamp:-0} ))
    if is_lock_alive; then
      echo "🔒 Locked (PID: $shell_pid, age: ${age}s)"
    else
      echo "⚠️ Stale lock (PID $shell_pid dead, age: ${age}s)"
    fi
  else
    echo "🔓 Unlocked"
  fi
  if curl -s --max-time 1 "http://127.0.0.1:$CDP_PORT/json/version" &>/dev/null; then
    echo "🌐 Chrome running on CDP port $CDP_PORT"
  else
    echo "⭕ No Chrome on CDP port $CDP_PORT"
  fi
}

case "${1:-status}" in
  release) release ;;
  run)     shift; run_script "$@" ;;
  status)  status ;;
  *)       echo "Usage: browser-lock.sh {run [--timeout S] <script.js>|status|release}" >&2; exit 1 ;;
esac
