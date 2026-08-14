# Discord Kanban lifecycle delivery — scope manifest

Status: owner-approved (2026-08-13 revision). This document authorizes no
deployment, gateway reload, merge, or runtime configuration change.

## Baseline

- Clean fork branch: `feat/discord-kanban-lifecycle-delivery`, based on
  `fork/main` at `e3c7f3e7f1`.
- Reuse only existing infrastructure: `task_events`, `kanban_notify_subs`,
  `GatewayKanbanWatchersMixin`, the Discord adapter send path, and the
  Discord adapter voice path.
- Zero new config keys, zero new DB schema, zero new source files.

## Exact allowlist

- `docs/discord-kanban-lifecycle-scope.md`
- `gateway/kanban_watchers.py`
- `plugins/platforms/discord/adapter.py`
- `tests/gateway/test_kanban_notifier.py`
- `tests/gateway/test_discord_voice_mixer.py`

No other path is authorized without a revised accepted scope.

## Routing

- Lifecycle notices go to `#hermes` (`1536516305803550832`).
- Decision briefs go to `#decisions` (`1536516701972205668`).
- Owner authorization remains the existing `.env:DISCORD_ALLOWED_USERS`.

## Mechanism

1. **Auto-subscribe (card creation).** The notifier tick, when a Discord
   adapter is connected, polls each board's `task_events` for `created`
   events newer than a per-board cursor held in watcher state
   (`self._kanban_lifecycle_created_cursor`). For each new card it inserts a
   `kanban_notify_subs` row targeting `#hermes`, so the existing per-task
   notifier delivers its lifecycle events. No new config key, no new table.
2. **Decision routing (needs_input block).** When the notifier processes a
   `blocked` event with `payload.kind == "needs_input"`, or a
   `block_loop_detected` event, it sends one bounded brief to `#decisions`
   through the existing Discord adapter send path.
3. **Dedup.** Auto-subscribe uses the per-board event cursor in watcher
   state. Decision briefs use an in-memory set keyed by `(board, event id)`;
   a failed send removes the key so the next tick retries. No new DB schema.
4. **Voice.** After durable text delivery, events in `completed` / `blocked` /
   `block_loop_detected` trigger best-effort VC speech only if the Discord
   adapter is already connected to a voice channel containing an allowed
   owner (`DiscordAdapter.speak_kanban_notice`). The adapter never joins,
   moves, or leaves a voice channel.

## Event and idempotency matrix

| Source event | Lifecycle notice | Decision brief | VC audio | Idempotency |
| --- | --- | --- | --- | --- |
| `created` | auto-subscribed to #hermes | no | no | per-board created-event cursor |
| `completed` | yes (via #hermes sub) | no | owner-linked VC only | notifier sub cursor |
| `blocked` (needs_input) | yes | yes | owner-linked VC only | notifier sub cursor + decision set |
| `block_loop_detected` | yes | yes | owner-linked VC only | notifier sub cursor + decision set |
| other `blocked` kinds | yes | no | no | notifier sub cursor |
| `gave_up` / `crashed` / `timed_out` | yes | no | no | notifier sub cursor |
| `assigned` / `spawned` / `heartbeat` / `commented` / `archived` / `unblocked` | silent | no | no | n/a |

Delivery failure never mutates Kanban rows, tasks, runs, or status.

## Rollback and live acceptance

Rollback is the unmerged feature branch/PR. No service restart, deployment,
merge, or live VC test is authorized by this scope. After a separate
controlled approval: dry-run with a dummy task, verify one text notice and no
duplicate after watcher restart, verify the one-message decision format, then
verify speech only while the owner is already present in the linked VC.
