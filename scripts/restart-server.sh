#!/usr/bin/env bash
# Kills the running Paperclip server and restarts it in the same terminal.
# Designed to be called from Claude Code (which cannot nest inside Paperclip).
#
# Usage: ./scripts/restart-server.sh [--dev]
#   --dev   Use `pnpm dev` instead of `npx paperclipai run`

set -euo pipefail

PAPERCLIP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${PAPERCLIP_API_URL:-http://127.0.0.1:3100}"
MODE="${1:-run}"

# ── 1. Kill existing Paperclip server ──────────────────────────────────────────

echo "[restart] Looking for running Paperclip server..."

# Find the main paperclipai process (the node process, not npm wrapper)
PIDS=$(pgrep -f "paperclipai run" 2>/dev/null || true)

if [ -z "$PIDS" ]; then
  echo "[restart] No running Paperclip server found."
else
  echo "[restart] Killing PIDs: $PIDS"
  # SIGTERM first for graceful shutdown
  kill $PIDS 2>/dev/null || true

  # Wait up to 10 seconds for processes to exit
  for i in $(seq 1 20); do
    if ! pgrep -f "paperclipai run" >/dev/null 2>&1; then
      echo "[restart] Server stopped."
      break
    fi
    sleep 0.5
  done

  # Force kill if still running
  if pgrep -f "paperclipai run" >/dev/null 2>&1; then
    echo "[restart] Force killing..."
    kill -9 $PIDS 2>/dev/null || true
    sleep 1
  fi
fi

# ── 2. Start Paperclip server ─────────────────────────────────────────────────

cd "$PAPERCLIP_DIR"

# Clear Claude Code session markers so spawned claude processes don't detect
# a nested session and refuse to start (adapter_failed).
unset CLAUDECODE 2>/dev/null || true
unset CLAUDE_CODE_SESSION 2>/dev/null || true

if [ "$MODE" = "--dev" ]; then
  echo "[restart] Starting Paperclip in dev mode (pnpm dev)..."
  nohup pnpm dev </dev/null >>"$PAPERCLIP_DIR/logs/server.log" 2>&1 &
else
  echo "[restart] Starting Paperclip (npx paperclipai run)..."
  nohup npx paperclipai run </dev/null >>"$PAPERCLIP_DIR/logs/server.log" 2>&1 &
fi

SERVER_PID=$!
echo "[restart] Server starting with PID $SERVER_PID"

# ── 3. Wait for server to be healthy ──────────────────────────────────────────

echo "[restart] Waiting for server at $API_URL..."

for i in $(seq 1 30); do
  if curl -sf "$API_URL/api/health" >/dev/null 2>&1 || curl -sf "$API_URL" >/dev/null 2>&1; then
    echo "[restart] Server is up! (took ~${i}s)"
    exit 0
  fi
  sleep 1
done

echo "[restart] WARNING: Server did not respond within 30 seconds."
echo "[restart] Check logs: tail -f $PAPERCLIP_DIR/logs/server.log"
exit 1
