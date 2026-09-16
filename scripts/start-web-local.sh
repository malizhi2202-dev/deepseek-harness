#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${DSH_WEB_PORT:-3080}"
NODE_BIN="${DSH_NODE_BIN:-/tmp/node-v22.19.0-linux-x64/bin/node}"
LOG_FILE="${DSH_WEB_LOG:-/tmp/dsh-web-${PORT}.log}"
PID_FILE="${DSH_WEB_PID:-/tmp/dsh-web-${PORT}.pid}"

if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "node not found; set DSH_NODE_BIN to an existing Node 22.19+ binary" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOG_FILE")"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" 2>/dev/null || true
  fi
fi

while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  kill "$pid" 2>/dev/null || true
done < <(pgrep -f "apps/cli/(src/bin.ts|lib/bin.js) web --port ${PORT}" || true)
rm -f "$PID_FILE"
: >"$LOG_FILE"

TRUSTED_ARGS=(
  --trusted-host "127.0.0.1:${PORT}"
  --trusted-host "localhost:${PORT}"
  --trusted-host "0.0.0.0:${PORT}"
)

host_name="$(hostname 2>/dev/null || true)"
if [[ -n "$host_name" ]]; then
  TRUSTED_ARGS+=(--trusted-host "${host_name}:${PORT}")
fi

for ip in $(hostname -I 2>/dev/null || true); do
  [[ -n "$ip" ]] || continue
  if [[ "$ip" == *:* ]]; then
    TRUSTED_ARGS+=(--trusted-host "[$ip]")
  else
    TRUSTED_ARGS+=(--trusted-host "$ip")
  fi
done

setsid bash -c '
  set -euo pipefail
  root=$1
  node_bin=$2
  shift 2
  cd "$root"
  tail -f /dev/null | env DSH_WEB_LOCAL_NO_AUTH=1 PATH="$(dirname "$node_bin"):$PATH" "$node_bin" apps/cli/lib/bin.js web "$@"
' dsh-web-wrapper "$ROOT_DIR" "$NODE_BIN" --port "$PORT" "${TRUSTED_ARGS[@]}" --no-open >"$LOG_FILE" 2>&1 &

pid="$!"
printf '%s\n' "$pid" >"$PID_FILE"

for _ in {1..80}; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"
  if [[ -n "$(grep -Eo "http://127\.0\.0\.1:${PORT}/\?token=[^[:space:]]+" "$LOG_FILE" | tail -n 1 || true)" ]]; then
    url="$(grep -Eo "http://127\.0\.0\.1:${PORT}/\?token=[^[:space:]]+" "$LOG_FILE" | tail -n 1 || true)"
    echo "dsh web started: ${url:-http://127.0.0.1:${PORT}}"
    if [[ -n "$url" ]]; then
      echo "dsh web localhost: ${url/127.0.0.1/localhost}"
    fi
    echo "pid: $pid"
    echo "log: $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "dsh web failed to start; log: $LOG_FILE" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 0.5
done

if kill -0 "$pid" 2>/dev/null; then
  url="$(grep -Eo "http://127\.0\.0\.1:${PORT}/\?token=[^[:space:]]+" "$LOG_FILE" | tail -n 1 || true)"
  echo "dsh web started but health check timed out: ${url:-http://127.0.0.1:${PORT}}"
  if [[ -n "$url" ]]; then
    echo "dsh web localhost: ${url/127.0.0.1/localhost}"
  fi
  echo "pid: $pid"
  echo "log: $LOG_FILE"
  tail -n 20 "$LOG_FILE" || true
  exit 0
fi

echo "dsh web start timed out; log: $LOG_FILE" >&2
tail -n 80 "$LOG_FILE" >&2 || true
exit 1
