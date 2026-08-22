# Desktop Windows microphone capture diagnostic

Status: investigation branch
Issue: [#84316](https://github.com/NousResearch/hermes-agent/issues/84316)
Branch: `fix/desktop-windows-mic-diagnostic`

## Finding

Hermes Desktop voice capture fails on the reporter's Windows 11 system with:

> Microphone is already in use by another app.

The failure affects multiple physical and virtual microphones. Independent
PortAudio tests open the same hardware through both WASAPI and MME, while
Electron/Chromium `getUserMedia` fails. This points to the Windows Chromium
capture/device-selection boundary, not to the N100 Hermes gateway.

Remote wake capture is intentionally client-side:

```text
Windows Electron renderer
  getUserMedia → PCM/resampling → wake.feed
  → Tailscale/WebSocket → Hermes gateway on N100
```

The affected paths are:

- `apps/desktop/src/app/chat/composer/hooks/use-mic-recorder.ts`
- `apps/desktop/src/lib/wake-client-capture.ts`
- Electron media permission handling in `apps/desktop/electron/main.ts`

The Electron permission handlers are already present, including the Windows
case where Chromium may provide incomplete media metadata. No evidence yet
shows that a missing permission declaration is the root cause.

## Current baseline

Verified on the N100 against current `main`:

- `npm ci --ignore-scripts --no-audit --no-fund` — passed
- `npm run typecheck` — passed
- `npm run test:desktop:platforms` — 1,574 passed, 3 skipped
- `npm run build` — passed
- Source build uses Electron `40.10.2` in desktop package metadata

The N100 is suitable for development, typechecking, focused tests, and source
builds. Windows audio-driver behavior still requires validation on the
reporter's Windows machine. Full installer packaging should not be repeated
unnecessarily on the N100 because disk space is limited.

## Why this note is here

Do not create a new top-level Electron/TUI folder. The repository already has
the correct ownership boundaries:

- Electron/native shell: `apps/desktop/electron/`
- Desktop renderer: `apps/desktop/src/`
- TUI: `ui-tui/`
- Shared gateway/backend behavior: existing gateway and voice modules
- Contribution investigation notes: `docs/`

This note records the diagnostic branch and acceptance evidence. It is not a
second architecture document and should be deleted or replaced by the final
PR description if maintainers prefer not to retain investigation notes.

## Diagnostic plan

1. Add the smallest shared capture-opening path needed by both manual STT and
   remote wake capture; do not duplicate device-selection logic.
2. Capture actionable failure data: DOMException name/message, available
   `audioinput` count/labels, selected/default device information, and the
   attempted constraint variant. Do not record raw audio or secrets.
3. Test, on Windows, in this order:
   - default device with current constraints;
   - explicit physical `deviceId` with current constraints;
   - explicit physical `deviceId` with relaxed constraints;
   - default device with relaxed constraints.
4. Keep the first implementation renderer-side. Do not add a native audio
   dependency or global Chromium flag unless the diagnostic proves the
   existing API cannot open a working device.
5. Exercise both consumers: manual STT and remote wake-word capture.
6. Add a focused regression test for the selected fallback/diagnostic behavior.
7. Run the N100 gates, then build a Windows artifact and validate it against the
   Arctis, Synaptics, and Sonar-disabled configurations from #84316.

## Ranked hypotheses

1. Chromium's default Windows device selection is confused by the large mixed
   endpoint list, including SteelSeries Sonar WDM-KS devices.
2. Chromium's Windows audio service fails during endpoint enumeration or format
   negotiation and misreports the failure as `NotReadableError` / "in use".
3. One or more capture constraints cause a driver-specific negotiation failure.
4. Electron permission handling remains incomplete on this Windows/Electron
   combination.
5. A native PortAudio fallback is required. This is the last resort, not the
   starting design.

## Scope

In scope:

- Windows desktop renderer microphone acquisition;
- shared behavior for manual STT and client-side remote wake capture;
- device selection and actionable error reporting;
- focused tests and Windows validation;
- one small upstream PR if the fix is reproduced and verified.

Out of scope:

- changing the N100 voice/STT backend;
- changing Tailscale or gateway routing;
- adding a new TUI implementation;
- replacing Chromium capture with PortAudio before the renderer path is tested;
- broad Electron refactoring or unrelated voice UX work.

## PR recommendation

Open one short-lived bug-fix PR only after a Windows run demonstrates that the
change opens a working microphone and preserves both STT and wake capture.
Prefer a diff limited to the capture helper, its two callers, and focused tests.
Avoid `electron/main.ts` unless permission diagnostics prove that seam is wrong.

The voice capture seam is comparatively stable: client wake capture last changed
materially in early August, while the wider desktop tree is changing quickly.
This makes a narrow branch reasonable; daily mergeback cost becomes high only if
the change crosses the active Electron shell or adds a native dependency.
