#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

./scripts/run_tests.sh \
  tests/hermes_cli/test_kanban_notify.py \
  tests/gateway/test_kanban_notifier.py \
  tests/gateway/test_discord_voice_mixer.py \
  tests/gateway/test_voice_command.py

(
  cd web
  npm test -- --run src/components/PushToTalkButton.test.tsx src/pages/ChatPage.test.tsx
  npm run build
)

git diff --check
