import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@nous-research/ui/ui/components/button";
import { fetchJSON } from "@/lib/api";

interface PushToTalkButtonProps {
  onTranscript: (transcript: string, autoSend: boolean, autosave: TranscriptAutosaveSettings) => void;
  // Fired synchronously at the top of the mic gesture (before any await),
  // while still inside the triggering click/keydown's call stack. Lets the
  // caller unlock playback of a later, async TTS reply — some browsers
  // (Safari) only honor programmatic audio.play() if the same element was
  // played at least once during a real user gesture.
  onGestureStart?: (cancel: boolean) => void;
  onGestureEnd?: () => void;
  profile?: string;
}

export interface TranscriptAutosaveSettings {
  enabled: boolean;
  path: string;
  timestamp?: boolean;
}

// Per-browser preference: whether a captured transcript is sent immediately
// (auto) or only dropped into the PTY input line for the user to edit and
// submit themselves (manual). Absent (never toggled, or storage blocked)
// means auto-send stays on.
const AUTO_SEND_KEY = "hermes.voice.autoSend";
const DOUBLE_TAP_CANCEL_MS = 300;
export const TRANSCRIPT_AUTOSAVE_ENABLED_KEY = "hermes.transcriptAutosave.enabled";
export const TRANSCRIPT_AUTOSAVE_PATH_KEY = "hermes.transcriptAutosave.path";
function readAutoSend(): boolean {
  try {
    const v = window.localStorage.getItem(AUTO_SEND_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}
function writeAutoSend(value: boolean): void {
  try {
    window.localStorage.setItem(AUTO_SEND_KEY, value ? "1" : "0");
  } catch {
    /* private mode / storage blocked */
  }
}

function writeTranscriptAutosaveSettings(settings: TranscriptAutosaveSettings): void {
  try {
    window.localStorage.setItem(TRANSCRIPT_AUTOSAVE_ENABLED_KEY, settings.enabled ? "1" : "0");
    window.localStorage.setItem(TRANSCRIPT_AUTOSAVE_PATH_KEY, settings.path);
  } catch {
    /* private mode / storage blocked */
  }
}

export function readTranscriptAutosaveSettings(): TranscriptAutosaveSettings {
  try {
    return {
      enabled: window.localStorage.getItem(TRANSCRIPT_AUTOSAVE_ENABLED_KEY) === "1",
      path: window.localStorage.getItem(TRANSCRIPT_AUTOSAVE_PATH_KEY) || "transcript.txt",
    };
  } catch {
    return { enabled: false, path: "transcript.txt" };
  }
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function playCue(frequency: number): void {
  try {
    const context = new AudioContext();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    gain.gain.setValueAtTime(0.025, context.currentTime);
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => void context.close();
    oscillator.start();
    oscillator.stop(context.currentTime + 0.06);
  } catch {
    // Audio cues are optional feedback; recording must still work without Web Audio.
  }
}

export function PushToTalkButton({ onTranscript, onGestureStart, onGestureEnd, profile }: PushToTalkButtonProps) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const requestingRef = useRef(false);
  const holdingRef = useRef(false);
  const disposedRef = useRef(false);
  const recordingRef = useRef(false);
  const pageUpHeldRef = useRef(false);
  const pageDownHeldRef = useRef(false);
  const gestureStartedAtRef = useRef(0);
  const lastTapAtRef = useRef(0);
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "error">("idle");
  const [autoSend, setAutoSend] = useState(() => readAutoSend());
  const [autosave, setAutosave] = useState(() => readTranscriptAutosaveSettings());
  const autoSendRef = useRef(autoSend);
  useEffect(() => {
    autoSendRef.current = autoSend;
  }, [autoSend]);

  const release = useCallback(() => {
    holdingRef.current = false;
    const now = Date.now();
    lastTapAtRef.current = now - gestureStartedAtRef.current <= DOUBLE_TAP_CANCEL_MS ? now : 0;
    onGestureEnd?.();
    if (!recordingRef.current) {
      setState((prev) => (prev === "error" ? prev : "idle"));
      return;
    }
    recordingRef.current = false;
    setState("idle");
    playCue(440);
    recorderRef.current?.stop();
  }, [onGestureEnd]);

  const start = useCallback(async (options?: { autoSend?: boolean; autosave?: TranscriptAutosaveSettings }) => {
    if (requestingRef.current || recordingRef.current) return;
    // Still synchronous within the triggering gesture's call stack — must
    // run before the getUserMedia await below breaks that chain.
    const now = Date.now();
    const cancel = lastTapAtRef.current > 0 && now - lastTapAtRef.current <= DOUBLE_TAP_CANCEL_MS;
    lastTapAtRef.current = 0;
    gestureStartedAtRef.current = now;
    onGestureStart?.(cancel);
    holdingRef.current = true;
    requestingRef.current = true;
    setState("requesting");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!holdingRef.current) {
        stopTracks(stream);
        return;
      }
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stopTracks(streamRef.current);
        streamRef.current = null;
        recorderRef.current = null;
        if (disposedRef.current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) return;
        void dataUrl(blob)
          .then((data_url) => fetchJSON<{ transcript?: string }>(
            `/api/audio/transcribe${profile ? `?profile=${encodeURIComponent(profile)}` : ""}`,
            {
              body: JSON.stringify({ data_url, mime_type: blob.type }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            },
          ))
          .then((response) => {
            const transcript = response.transcript?.trim();
            if (transcript) onTranscript(transcript, options?.autoSend ?? autoSendRef.current, options?.autosave ?? autosave);
          })
          .catch(() => {});
      };
      recorder.start();
      recordingRef.current = true;
      setState("recording");
      playCue(660);
    } catch {
      stopTracks(stream);
      setState("error");
    } finally {
      requestingRef.current = false;
    }
  }, [autosave, onGestureStart, onTranscript, profile]);

  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean =>
      !(target instanceof HTMLTextAreaElement && target.classList.contains("xterm-helper-textarea"))
      && target instanceof Element
      && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      if (event.key === "PageUp") {
        if (pageUpHeldRef.current) {
          event.preventDefault();
          return;
        }
        pageUpHeldRef.current = true;
        event.preventDefault();
        void start();
      } else if (event.key === "PageDown" && autosave.enabled) {
        if (pageDownHeldRef.current) {
          event.preventDefault();
          return;
        }
        pageDownHeldRef.current = true;
        event.preventDefault();
        void start({ autosave: { ...autosave, enabled: true, timestamp: true } });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "PageUp" && pageUpHeldRef.current) {
        pageUpHeldRef.current = false;
        event.preventDefault();
        release();
      } else if (event.key === "PageDown" && pageDownHeldRef.current) {
        pageDownHeldRef.current = false;
        event.preventDefault();
        release();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [autosave, release, start]);

  useEffect(() => () => {
    disposedRef.current = true;
    holdingRef.current = false;
    pageUpHeldRef.current = false;
    pageDownHeldRef.current = false;
    if (recordingRef.current) playCue(440);
    recordingRef.current = false;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    stopTracks(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  return (
    <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 sm:bottom-3 sm:left-3">
      <Button
        type="button"
        aria-label={
          state === "requesting" ? "Requesting microphone"
          : state === "recording" ? "Recording. Release to send"
          : state === "error" ? "Microphone error. Press to retry"
          : "Send (PgUp)"
        }
        aria-pressed={state === "recording"}
        aria-busy={state === "requesting"}
        className={`rounded border px-2 py-1 text-xs text-white shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white ${state === "recording" ? "border-red-400 bg-red-950" : state === "requesting" ? "border-yellow-300 bg-yellow-950" : state === "error" ? "border-orange-400 bg-orange-950" : "border-white/70 bg-black"}`}
        onKeyDown={(event) => {
          if (event.key === "PageUp") {
            event.preventDefault();
            void start();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === "PageUp") {
            event.preventDefault();
            release();
          }
        }}
        onPointerCancel={release}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          void start();
        }}
        onLostPointerCapture={release}
        onPointerUp={release}
      >
        <Mic className="size-3" />
        <span className="ml-1">{state === "idle" ? "Send (PgUp)" : state === "error" ? "retry" : state}</span>
      </Button>
      <Button
        type="button"
        aria-label="Send + Save (PgDown)"
        disabled={!autosave.enabled}
        className="rounded border border-white/70 bg-black px-2 py-1 text-xs text-white shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
        onKeyDown={(event) => {
          if (event.key === "PageDown" && autosave.enabled) {
            event.preventDefault();
            void start({ autosave: { ...autosave, enabled: true, timestamp: true } });
          }
        }}
        onKeyUp={(event) => {
          if (event.key === "PageDown") {
            event.preventDefault();
            release();
          }
        }}
        onPointerCancel={release}
        onPointerDown={(event) => {
          if (!autosave.enabled) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          void start({ autosave: { ...autosave, enabled: true, timestamp: true } });
        }}
        onLostPointerCapture={release}
        onPointerUp={release}
      >
        Send + Save (PgDown)
      </Button>
      <label className="flex items-center gap-1 rounded border border-current/30 bg-black/20 px-2 py-1 text-xs opacity-80 hover:opacity-100">
        <input
          type="checkbox"
          checked={autoSend}
          onChange={(event) => {
            const next = event.target.checked;
            writeAutoSend(next);
            setAutoSend(next);
          }}
          aria-label="Auto-send voice transcript"
        />
        auto-send
      </label>
      <label className="flex items-center gap-1 rounded border border-current/30 bg-black/20 px-2 py-1 text-xs opacity-80 hover:opacity-100">
        <input
          type="checkbox"
          checked={autosave.enabled}
          onChange={(event) => {
            const next = { ...autosave, enabled: event.target.checked };
            writeTranscriptAutosaveSettings(next);
            setAutosave(next);
          }}
          aria-label="Save transcripts"
        />
        save transcripts
      </label>
      <input
        className="w-28 rounded border border-current/30 bg-black/20 px-1 py-1 text-xs"
        aria-label="Transcript output path"
        value={autosave.path}
        onChange={(event) => {
          const next = { ...autosave, path: event.target.value };
          writeTranscriptAutosaveSettings(next);
          setAutosave(next);
        }}
        placeholder="transcript.txt"
      />
    </div>
  );
}
