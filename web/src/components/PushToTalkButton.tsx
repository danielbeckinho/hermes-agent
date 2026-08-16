import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@nous-research/ui/ui/components/button";
import { fetchJSON } from "@/lib/api";

interface PushToTalkButtonProps {
  onTranscript: (transcript: string) => void;
  // Fired synchronously at the top of the mic gesture (before any await), so
  // the caller can pause an in-flight TTS reply before the mic actually opens.
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  profile?: string;
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

export function PushToTalkButton({ onTranscript, onGestureStart, onGestureEnd, profile }: PushToTalkButtonProps) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const requestingRef = useRef(false);
  const holdingRef = useRef(false);
  const recordingRef = useRef(false);
  const disposedRef = useRef(false);
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "error">("idle");

  useEffect(() => () => {
    disposedRef.current = true;
    holdingRef.current = false;
    recordingRef.current = false;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    stopTracks(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const release = useCallback(() => {
    holdingRef.current = false;
    onGestureEnd?.();
    if (!recordingRef.current) {
      setState((prev) => (prev === "error" ? prev : "idle"));
      return;
    }
    recordingRef.current = false;
    setState("idle");
    recorderRef.current?.stop();
  }, [onGestureEnd]);

  const start = useCallback(async () => {
    if (requestingRef.current || recordingRef.current) return;
    // Must fire before the getUserMedia await below — still inside the
    // triggering gesture's call stack.
    onGestureStart?.();
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
            if (transcript) onTranscript(transcript);
          })
          .catch(() => {});
      };
      recorder.start();
      recordingRef.current = true;
      setState("recording");
    } catch {
      stopTracks(stream);
      setState("error");
    } finally {
      requestingRef.current = false;
    }
  }, [onGestureStart, onTranscript, profile]);

  return (
    <Button
      type="button"
      aria-label={
        state === "requesting" ? "Requesting microphone"
        : state === "recording" ? "Recording. Release to send"
        : state === "error" ? "Microphone error. Press to retry"
        : "Hold to talk"
      }
      aria-pressed={state === "recording"}
      aria-busy={state === "requesting"}
      className={`absolute bottom-2 left-2 z-10 rounded border px-2 py-1 text-xs text-white shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white sm:bottom-3 sm:left-3 ${state === "recording" ? "border-red-400 bg-red-950" : state === "requesting" ? "border-yellow-300 bg-yellow-950" : state === "error" ? "border-orange-400 bg-orange-950" : "border-white/70 bg-black"}`}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
          event.preventDefault();
          void start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter" || event.key === " ") {
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
      <span className="ml-1">{state === "idle" ? "Hold to talk" : state === "error" ? "retry" : state}</span>
    </Button>
  );
}
