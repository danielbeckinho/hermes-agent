# Porting TUI PTT/STT to the current Hermes dashboard

Use this runbook when porting the browser Push-to-Talk (PTT) / speech-to-text
(STT) path onto a newer Hermes dashboard. The deployment must preserve the
current backend and serve the browser through Tailscale HTTPS.

## Non-negotiables

- Do not deploy an old voice branch wholesale over the current backend.
- Start from the current live-derived `main`/release tree.
- Reuse the existing structured event feed; do not add a second transport.
- Browser PTT requires a secure context: use the Tailscale HTTPS MagicDNS URL.
- Keep the backend bound to the Tailscale IP and allow exactly the MagicDNS Host.
- Deploy the dashboard only; do not restart the gateway for browser assets.
- Keep the previous dashboard worktree/drop-in available for rollback.
- Treat **Send (PgUp)** and **Send + Save (PgDown)** as separate controls. The
  active recording state must be shown only on the control that started it.
- Save only on explicit PgDown/Send + Save; never autosave ordinary PgUp sends.

Example deployment topology:

```text
Browser:  https://node-01.tail6ba6bf.ts.net
Tailscale Serve: / -> http://100.81.246.101:9119
Backend bind: 100.81.246.101:9119
Allowed Host: node-01.tail6ba6bf.ts.net
```

## 1. Inspect the current runtime first

```bash
cd /home/hermesnubs/.hermes/hermes-agent

git fetch origin --quiet
git status --short --branch
git worktree list

systemctl show hermes-dashboard.service \
  -p MainPID -p WorkingDirectory -p ExecStart
systemctl show hermes-gateway.service \
  -p MainPID -p WorkingDirectory -p ExecStart

tailscale serve status
curl -sS https://node-01.tail6ba6bf.ts.net/
```

Record the live dashboard CWD, bind address, Tailscale Serve route, and the
current health response. Never assume a directory named `deployed-*` is live;
verify the process PID/CWD.

## 2. Trace the existing voice seam

Current dashboard chat is a PTY terminal plus a structured sidecar event feed.
The event feed already rebroadcasts the PTY gateway events:

```text
/api/events
  -> message.start    { voice_turn: true }
  -> message.complete { voice_turn: true, text: ... }
```

Reuse that path:

- `web/src/components/ChatSidebar.tsx`: expose callbacks for
  `message.start` and `message.complete`.
- `web/src/pages/ChatPage.tsx`: correlate only the current `voice_turn`.
- `web/src/components/PushToTalkButton.tsx`: capture browser microphone input
  and call the existing `/api/audio/transcribe` endpoint.
- Send the resulting transcript through the existing PTY input path.
- Mark the submitted turn with the existing voice-turn marker so the backend
  emits `voice_turn` metadata.
- On the correlated completion, call `/api/audio/speak` and play the returned
  data URL in the browser.
- For explicit Send + Save, POST the transcript to
  `/api/dashboard/transcript-autosave`; the server appends it below
  `$HERMES_HOME/transcripts/` and rejects absolute, traversal, and symlink
  escape paths.
- Pause/resume/cancel playback from the PTT gesture and show a visible Play
  retry if browser autoplay rejects `Audio.play()`.

Do not port an old `ChatPage.tsx` wholesale. The current page contains newer
PTY reconnect, resume, IME, mobile input, and session lifecycle behavior.
Port the smallest complete producer -> event -> playback seam.

## 3. Implement with TDD

Add the regression first, then run it RED:

```bash
pytest -q tests/hermes_cli/test_web_server_host_header.py \
  tests/test_transcript_autosave.py
```

The test must prove that an exact reverse-proxy alias is accepted while an
unrelated Host is rejected:

```python
allowed = ("node-01.tail6ba6bf.ts.net",)
assert _is_accepted_host(
    "node-01.tail6ba6bf.ts.net:443",
    "100.81.246.101",
    allowed,
)
assert not _is_accepted_host("evil.example", "100.81.246.101", allowed)
```

Then add the minimum backend plumbing:

- `hermes_cli/subcommands/dashboard.py`: repeatable `--allowed-host HOST`.
- `hermes_cli/main.py`: pass `allowed_hosts` to `start_server()`.
- `hermes_cli/web_server.py`: apply the exact allowlist to HTTP Host and
  WebSocket Host/Origin validation.

Run GREEN:

```bash
pytest -q tests/hermes_cli/test_web_server_host_header.py
npm --workspace web exec vitest run \
  src/components/PushToTalkButton.test.ts \
  src/components/ChatSidebar.test.tsx
npm --workspace web run typecheck
npm --workspace web run build
git diff --check
```

The expected baseline evidence for the current port is:

```text
Host-header + autosave tests: 18 passed in the live-derived target
Web suite: 37 files / 277 tests passed
Typecheck: passed
Build: passed
```

## 4. Build an isolated deployment worktree

Do not deploy from a dirty shared checkout. Create a clean worktree from the
current live-derived base, apply only the reviewed source/test slice, and commit
it:

```bash
repo=/home/hermesnubs/.hermes/hermes-agent
target=/home/hermesnubs/.hermes/worktrees/deploy-fix-tui-ptt-key-routing

git -C "$repo" worktree add --detach "$target" main
# Apply the reviewed tracked diff and copy any new in-scope source file.
# Then:
git -C "$target" add \
  web/src/components/ChatSidebar.test.tsx \
  web/src/components/ChatSidebar.tsx \
  web/src/pages/ChatPage.tsx \
  web/src/components/PushToTalkButton.tsx \
  hermes_cli/transcript_autosave.py \
  hermes_cli/web_routers/transcripts.py \
  hermes_cli/web_models.py \
  hermes_cli/web_server.py \
  hermes_cli/subcommands/dashboard.py \
  hermes_cli/main.py \
  tests/hermes_cli/test_web_server_host_header.py \
  tests/test_transcript_autosave.py
git -C "$target" commit -m \
  "fix(web): ship PTT routing and transcript autosave"
```

Build in that exact worktree. With `--skip-build`, the service serves the
worktree's `hermes_cli/web_dist`, not the source tree's latest files.

## 5. Verify Tailscale HTTPS before deployment

```bash
tailscale serve status
curl -sS -i https://node-01.tail6ba6bf.ts.net/
curl -sS -i \
  https://node-01.tail6ba6bf.ts.net/assets/ChatPage-<HASH>.js
```

The root may return `302 /login`; that is expected. The hashed asset must return
`200` and contain a unique port marker such as `Voice reply`.

A `400 Invalid Host header` on the asset means the deployment is not ready. It
usually means the service is bound to `100.81.246.101` but the application has
not been given:

```text
--allowed-host node-01.tail6ba6bf.ts.net
```

Do not “fix” this with `0.0.0.0`, wildcard Host acceptance, or plain HTTP.

## 6. Use a guarded dashboard-only deployment

The owner-run handoff script is versioned at `scripts/deploy-ptt-hotfix.sh`; the
owner-run copy used on this host is `/home/hermesnubs/.hermes/release-handoff/deploy-ptt-hotfix.sh` and must:

1. Assert the target worktree is clean and the built marker exists.
2. Validate the target parser accepts `--allowed-host` from the target CWD.
3. Snapshot any prior dashboard drop-in.
4. Install a highest-priority dashboard drop-in containing:

```ini
[Service]
WorkingDirectory=/home/hermesnubs/.hermes/worktrees/deploy-fix-tui-ptt-key-routing
ExecStart=
ExecStart=/home/hermesnubs/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main dashboard --no-open --host 100.81.246.101 --allowed-host node-01.tail6ba6bf.ts.net --port 9119 --skip-build
```

5. Run `systemctl daemon-reload` and restart only `hermes-dashboard.service`.
6. Retry backend health and the Tailscale HTTPS asset for a bounded window.
7. On any failed assertion, restore the previous drop-in, reload, and restart
   the previous dashboard automatically.
8. On success, verify the service PID/CWD, health, MagicDNS HTTPS route, and
   the new hashed asset.

The script uses `mkdir`, shell redirection, and `chmod` for portability; do not
replace that with an `install /dev/stdin` pipeline. Run:

```bash
sudo /home/hermesnubs/.hermes/release-handoff/deploy-ptt-hotfix.sh
```

Never run an unguarded `WorkingDirectory` switch or restart the gateway for
this dashboard-only change.

## 7. Browser acceptance

Open only:

```text
https://node-01.tail6ba6bf.ts.net
```

After a hard refresh:

1. Hold **Send (PgUp)** and speak.
2. Confirm the transcript reaches the TUI.
3. Confirm the PgUp control, not PgDown, shows the active recording state.
4. Enable **save transcripts**, set a relative path such as `voice.txt`, then
   hold **Send + Save (PgDown)**.
5. Confirm the correlated reply starts browser playback.
6. If autoplay is blocked, click **Voice reply — Play**.
7. Hold PTT during playback and confirm pause/resume.
8. Perform the short second gesture and confirm cancellation.
9. Confirm a later non-voice reply does not play automatically.
10. On the host, verify `~/.hermes/transcripts/voice.txt` contains the saved
    entry. Never use an absolute path or `..` component in the browser field.

Do not accept a test performed through `http://100.81.246.101:9119` as browser
PTT validation. Direct HTTP health is only a backend readiness check.

## Rollback

If browser acceptance fails, restore the prior dashboard drop-in and restart
only the dashboard. Keep the Tailscale Serve route unchanged:

```bash
sudo rm -f \
  /etc/systemd/system/hermes-dashboard.service.d/zzzzzzzzzz-ptt-hotfix.conf
sudo systemctl daemon-reload
sudo systemctl restart hermes-dashboard.service
```

Then verify:

```bash
systemctl is-active hermes-dashboard.service hermes-gateway.service
curl -sS http://100.81.246.101:9119/api/health
systemctl show hermes-dashboard.service -p WorkingDirectory
```

Preserve the failed target and logs until the failure is understood. Remove
only clean, unreferenced worktrees and generated artifacts afterward.

## Known failure modes

| Symptom | Cause | Correct response |
|---|---|---|
| Root is `302`, assets are `400 Invalid Host header` | Tailscale Host differs from numeric bind | Add exact `--allowed-host` support and pass the MagicDNS hostname |
| Deployment rolls back immediately after startup | HTTPS readiness was checked only once | Retry backend and HTTPS asset checks for a bounded window |
| Old voice branch requires `--allowed-host` but rejects it | Branch is older than current dashboard CLI | Port the allowlist plumbing onto current `main`; do not downgrade |
| Browser microphone unavailable | Page served over HTTP | Use the Tailscale HTTPS MagicDNS URL |
| Dashboard works but voice events do not correlate | Wrong/duplicate event transport | Reuse `/api/events` and gate playback on `voice_turn: true` |
| TTS is silent with no control | `Audio.play()` rejection was swallowed | Keep the visible `Voice reply — Play` retry |
| PgDown records but PgUp appears active | Both controls shared one visual recording state | Track the active shortcut and render state only on that control |
| Save checkbox changes but no file appears | Browser preference existed without a server consumer | Verify the built asset contains `/api/dashboard/transcript-autosave` and restart the dashboard |
| Handoff says `install: No such file or directory` | `install /dev/stdin` is unavailable in the sudo environment | Use the owner handoff script's `mkdir` + redirection + `chmod` path |
