import { Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@nous-research/ui/ui/components/button";
import { fetchJSON } from "@/lib/api";

interface PushToTalkButtonProps {
  onTranscript: (transcript: string) => void;
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

export function PushToTalkButton({ onTranscript, profile }: PushToTalkButtonProps) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const requestingRef = useRef(false);
  const holdingRef = useRef(false);
  const disposedRef = useRef(false);
  const recordingRef = useRef(false);
  const [state, setState] = useState<"idle" | "requesting" | "recording">("idle");

  const release = useCallback(() => {
    holdingRef.current = false;
    if (!recordingRef.current) {
      setState("idle");
      return;
    }
    recordingRef.current = false;
    setState("idle");
    playCue(440);
    recorderRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    if (requestingRef.current || recordingRef.current) return;
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
      playCue(660);
    } catch {
      stopTracks(stream);
      setState("idle");
    } finally {
      requestingRef.current = false;
    }
  }, [onTranscript, profile]);

  useEffect(() => () => {
    disposedRef.current = true;
    holdingRef.current = false;
    if (recordingRef.current) playCue(440);
    recordingRef.current = false;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    stopTracks(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  return (
    <Button
      type="button"
      aria-label={state === "requesting" ? "Requesting microphone" : state === "recording" ? "Recording. Release to send" : "Hold to talk"}
      aria-pressed={state === "recording"}
      aria-busy={state === "requesting"}
      className={`absolute bottom-2 left-2 z-10 rounded border px-2 py-1 text-xs text-white shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white ${state === "recording" ? "border-red-400 bg-red-950" : state === "requesting" ? "border-yellow-300 bg-yellow-950" : "border-white/70 bg-black"} sm:bottom-3 sm:left-3`}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          void start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") {
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
      <span className="ml-1">{state === "idle" ? "hold to talk" : state}</span>
    </Button>
  );
}
