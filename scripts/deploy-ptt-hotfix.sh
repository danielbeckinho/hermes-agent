#!/bin/sh
set -eu

UNIT=hermes-dashboard.service
TARGET=/home/hermesnubs/.hermes/worktrees/deploy-fix-tui-ptt-key-routing
DROPIN_DIR=/etc/systemd/system/hermes-dashboard.service.d
DROPIN="$DROPIN_DIR/zzzzzzzzzz-ptt-hotfix.conf"
MAGIC=https://node-01.tail6ba6bf.ts.net
HEALTH=http://100.81.246.101:9119/api/health
SWITCHED=0

rollback() {
  rc=$?
  trap - EXIT INT TERM
  if [ "$SWITCHED" = 1 ]; then
    printf '%s\n' 'DEPLOY FAILED; restoring previous dashboard drop-in.' >&2
    rm -f "$DROPIN"
    systemctl daemon-reload || true
    systemctl restart "$UNIT" || true
  fi
  exit "$rc"
}
trap rollback EXIT INT TERM

[ -d "$TARGET" ]
git -C "$TARGET" diff --quiet HEAD --
test -z "$(git -C "$TARGET" status --porcelain)"

asset=''
for candidate in "$TARGET"/hermes_cli/web_dist/assets/ChatPage-*.js; do
  if [ -s "$candidate" ]; then asset=${candidate##*/}; break; fi
done
[ -n "$asset" ]
grep -q 'Send + Save (PgDown)' "$TARGET/hermes_cli/web_dist/assets/$asset"

(cd "$TARGET" && /home/hermesnubs/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main dashboard --help >/dev/null)

highest=$(basename -a "$DROPIN_DIR"/*.conf 2>/dev/null | sort | tail -1 || true)
[ "$DROPIN" = "$DROPIN_DIR/$(printf '%s\n' "$highest" "$(basename "$DROPIN")" | sort | tail -1)" ]

mkdir -p "$DROPIN_DIR"
umask 022
printf '%s\n' \
  '[Service]' \
  "WorkingDirectory=$TARGET" \
  'ExecStart=' \
  'ExecStart=/home/hermesnubs/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main dashboard --no-open --host 100.81.246.101 --allowed-host node-01.tail6ba6bf.ts.net --port 9119 --skip-build' \
  > "$DROPIN"
chmod 0644 "$DROPIN"
systemctl daemon-reload
SWITCHED=1
systemctl restart "$UNIT"

ready=0
for _ in $(seq 1 30); do
  health=$(curl -fsS --max-time 3 "$HEALTH" 2>/dev/null || true)
  if systemctl is-active --quiet "$UNIT" \
    && [ "$(systemctl show -p WorkingDirectory --value "$UNIT")" = "$TARGET" ] \
    && printf '%s' "$health" | grep -q '"ok":true'; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ]

https_ready=0
for _ in $(seq 1 30); do
  code=$(curl -sS --max-time 3 -o /tmp/hermes-dashboard-ptt-root "$MAGIC/" -w '%{http_code}' 2>/dev/null || true)
  case "$code" in
    200|302)
      if curl -fsS --max-time 3 "$MAGIC/assets/$asset" 2>/dev/null | grep -q 'Send + Save (PgDown)'; then
        https_ready=1
        break
      fi
      ;;
  esac
  sleep 1
done
[ "$https_ready" = 1 ]

SWITCHED=0
trap - EXIT INT TERM
printf '%s\n' 'Dashboard PTT hotfix deployed and verified through Tailscale HTTPS.'
printf 'worktree=%s\nasset=%s\nurl=%s\n' "$TARGET" "$asset" "$MAGIC"
