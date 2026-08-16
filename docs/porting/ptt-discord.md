# PTT + Discord VC notice port

Use the two immutable fork tags instead of searching history:

- `ptt-discord-source-v1`: original browser/TUI PTT and Discord VC behavior.
- `ptt-discord-integration-v1`: same behavior ported onto the current-release seams.

## Required seams

| Feature | Production seam | Regression seam |
| --- | --- | --- |
| Browser PTT | `web/src/components/PushToTalkButton.tsx`, `web/src/pages/ChatPage.tsx` | `web/src/components/PushToTalkButton.test.tsx`, `web/src/pages/ChatPage.test.tsx` |
| Discord VC notice | `gateway/kanban_watchers.py`, `hermes_cli/kanban.py` | `tests/hermes_cli/test_kanban_notify.py`, `tests/gateway/test_kanban_notifier.py`, `tests/gateway/test_discord_voice_mixer.py`, `tests/gateway/test_voice_command.py` |

Port the named producer and consumer together. Do not copy an entire page or watcher.

## Check

```sh
./scripts/verify-ptt-discord-port.sh
```

It runs the locale parity/placeholder guard, focused PTT and Discord-notice checks, builds the browser bundle, and rejects whitespace errors. It does not deploy, connect Discord, or join a voice channel.
