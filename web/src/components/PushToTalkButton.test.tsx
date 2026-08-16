// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PushToTalkButton } from "./PushToTalkButton";

vi.mock("lucide-react", () => ({ Mic: () => null }));
vi.mock("@nous-research/ui/ui/components/button", () => ({
  Button: (props: Record<string, unknown>) => <button {...props} />,
}));
const { fetchJSON } = vi.hoisted(() => ({ fetchJSON: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchJSON }));

class FakeTrack { stop = vi.fn(); }
class FakeStream {
  track = new FakeTrack();
  getTracks() { return [this.track]; }
}
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: FakeStream;
  constructor(stream: FakeStream) { this.stream = stream; FakeRecorder.instances.push(this); }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
  emit(blob: Blob) { this.ondataavailable?.({ data: blob }); }
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  close = vi.fn();
  createGain = vi.fn(() => ({
    connect: vi.fn(),
    gain: { setValueAtTime: vi.fn() },
  }));
  createOscillator = vi.fn(() => ({
    connect: vi.fn(),
    frequency: { setValueAtTime: vi.fn() },
    onended: null as (() => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
    type: "sine",
  }));
  destination = {};
  constructor() { FakeAudioContext.instances.push(this); }
}

let root: Root;
let container: HTMLDivElement;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchJSON.mockReset();
  fetchJSON.mockResolvedValue({ transcript: "voice input" });
  // jsdom in this pool has no localStorage (about:blank document URL), so
  // stub a minimal in-memory implementation — mirrors the try/catch
  // defensiveness the component uses around window.localStorage.
  const localStorageStore = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => localStorageStore.clear(),
    getItem: (key: string) =>
      localStorageStore.has(key) ? localStorageStore.get(key)! : null,
    removeItem: (key: string) => localStorageStore.delete(key),
    setItem: (key: string, value: string) => {
      localStorageStore.set(key, value);
    },
  });
  FakeRecorder.instances = [];
  FakeAudioContext.instances = [];
  getUserMedia = vi.fn(async () => new FakeStream());
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.stubGlobal("FileReader", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    result = "data:audio/webm;base64,AA==";
    readAsDataURL() { this.onload?.(); }
  });
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button() { return container.querySelector("button") as HTMLButtonElement; }
async function render(onTranscript = vi.fn(), onGestureStart = vi.fn()) {
  root = createRoot(container);
  await act(async () => root.render(<PushToTalkButton onGestureStart={onGestureStart} onTranscript={onTranscript} />));
  return onTranscript;
}

async function startRecording(expected = 1) {
  await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
  await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(expected));
}

describe("PushToTalkButton", () => {
  it("marks a second quick press as a speech-cancel gesture", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(100).mockReturnValueOnce(200);
    const onGestureStart = vi.fn();
    await render(vi.fn(), onGestureStart);
    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2 })));
    expect(onGestureStart).toHaveBeenNthCalledWith(1, false);
    expect(onGestureStart).toHaveBeenNthCalledWith(2, true);
    now.mockRestore();
  });

  it("renders exactly two capture buttons: Send (PgUp) and Send + Save (PgDown)", async () => {
    await render();
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Send (PgUp)",
      "Send + Save (PgDown)",
    ]);
  });

  it("shows requesting synchronously, then records with one start cue", async () => {
    let resolve: (stream: FakeStream) => void = () => {};
    getUserMedia.mockReturnValue(new Promise<FakeStream>((r) => { resolve = r; }));
    await render();

    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    expect(button().getAttribute("aria-label")).toBe("Requesting microphone");
    expect(button().textContent).toContain("requesting");
    expect(FakeAudioContext.instances).toHaveLength(0);

    await act(async () => resolve(new FakeStream()));
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    expect(button().getAttribute("aria-label")).toBe("Recording. Release to send");
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("plays one stop cue only after recording starts", async () => {
    await render();
    await startRecording();
    await act(async () => button().dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })));
    expect(FakeAudioContext.instances).toHaveLength(2);

    let resolve: (stream: FakeStream) => void = () => {};
    getUserMedia.mockReturnValue(new Promise<FakeStream>((r) => { resolve = r; }));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await act(async () => resolve(new FakeStream()));
    expect(FakeAudioContext.instances).toHaveLength(2);
  });

  it("plays one stop cue when pointer capture is lost", async () => {
    await render();
    await startRecording();
    await act(async () => button().dispatchEvent(new Event("lostpointercapture", { bubbles: true })));
    expect(FakeAudioContext.instances).toHaveLength(2);
  });

  it("starts on pointer hold and submits one transcript on release", async () => {
    const onTranscript = await render();
    await startRecording();
    const recorder = FakeRecorder.instances[0];
    recorder.emit(new Blob(["audio"]));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input", true, { enabled: false, path: "transcript.txt" }));
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(recorder.stream.track.stop).toHaveBeenCalled();
  });

  it("sends a held transcript without autosaving", async () => {
    const onTranscript = await render();
    const send = container.querySelector('button[aria-label="Send (PgUp)"]') as HTMLButtonElement;
    await act(async () => send.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    FakeRecorder.instances[0].emit(new Blob(["audio"]));
    await act(async () => send.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input", true, { enabled: false, path: "transcript.txt" }));
  });

  it("sends and timestamps a held transcript when saving", async () => {
    const onTranscript = await render();
    const saveToggle = container.querySelector('input[aria-label="Save transcripts"]') as HTMLInputElement;
    await act(async () => saveToggle.click());
    const sendAndSave = container.querySelector('button[aria-label="Send + Save (PgDown)"]') as HTMLButtonElement;
    await act(async () => sendAndSave.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    FakeRecorder.instances[0].emit(new Blob(["audio"]));
    await act(async () => sendAndSave.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input", true, {
      enabled: true,
      path: "transcript.txt",
      timestamp: true,
    }));
  });

  it("does not construct a recorder when released before permission resolves", async () => {
    let resolve: (stream: FakeStream) => void = () => {};
    getUserMedia.mockReturnValue(new Promise<FakeStream>((r) => { resolve = r; }));
    const onTranscript = await render();
    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    expect(button().getAttribute("aria-label")).toBe("Send (PgUp)");
    await act(async () => resolve(new FakeStream()));
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("shows a visible retryable error state after permission denial, then retries", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("denied"));
    await render();
    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(button().getAttribute("aria-label")).toBe("Microphone error. Press to retry"));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    expect(button().getAttribute("aria-label")).toBe("Microphone error. Press to retry");
    expect(FakeAudioContext.instances).toHaveLength(0);

    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    expect(button().getAttribute("aria-label")).toBe("Recording. Release to send");
  });

  it("cleans up when recorder construction fails", async () => {
    const stream = new FakeStream();
    getUserMedia.mockResolvedValueOnce(stream);
    vi.stubGlobal("MediaRecorder", class { constructor() { throw new Error("unsupported"); } });
    await render();
    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(stream.track.stop).toHaveBeenCalled());
  });

  it("skips empty blobs and shows a retryable error after transcription rejection", async () => {
    const onTranscript = await render();
    await startRecording();
    const recorder = FakeRecorder.instances[0];
    recorder.emit(new Blob());
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await Promise.resolve();
    expect(fetchJSON).not.toHaveBeenCalled();
    fetchJSON.mockRejectedValueOnce(new Error("network"));
    await startRecording(2);
    FakeRecorder.instances[1].emit(new Blob(["audio"]));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(button().getAttribute("aria-label")).toBe("Microphone error. Press to retry"));
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("stops recording and tracks on unmount", async () => {
    await render();
    await startRecording();
    const recorder = FakeRecorder.instances[0];
    await act(async () => root.unmount());
    expect(recorder.stream.track.stop).toHaveBeenCalled();
  });

  it("supports keyboard hold and release", async () => {
    const onTranscript = await render();
    await act(async () => button().dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true })));
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    FakeRecorder.instances[0].emit(new Blob(["audio"]));
    await act(async () => button().dispatchEvent(new KeyboardEvent("keyup", { key: "PageUp", bubbles: true })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input", true, { enabled: false, path: "transcript.txt" }));
  });

  it("sends and saves when PageDown is held on its control", async () => {
    const onTranscript = await render();
    const saveToggle = container.querySelector('input[aria-label="Save transcripts"]') as HTMLInputElement;
    await act(async () => saveToggle.click());
    const sendAndSave = container.querySelector('button[aria-label="Send + Save (PgDown)"]') as HTMLButtonElement;
    await act(async () => sendAndSave.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    FakeRecorder.instances[0].emit(new Blob(["audio"]));
    await act(async () => sendAndSave.dispatchEvent(new KeyboardEvent("keyup", { key: "PageDown", bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input", true, {
      enabled: true,
      path: "transcript.txt",
      timestamp: true,
    }));
  });

  it("sends without saving when PageUp is held on its control", async () => {
    const onTranscript = await render();
    const send = container.querySelector('button[aria-label="Send (PgUp)"]') as HTMLButtonElement;
    await act(async () => send.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    FakeRecorder.instances[0].emit(new Blob(["audio"]));
    await act(async () => send.dispatchEvent(new KeyboardEvent("keyup", { key: "PageUp", bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input", true, { enabled: false, path: "transcript.txt" }));
  });

  it("starts and releases on a page-level PageUp event, without focusing a control", async () => {
    const onTranscript = await render();
    document.body.focus();
    const down = new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true });
    await act(async () => window.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    FakeRecorder.instances[0].emit(new Blob(["audio"]));
    const up = new KeyboardEvent("keyup", { key: "PageUp", bubbles: true, cancelable: true });
    await act(async () => window.dispatchEvent(up));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input", true, { enabled: false, path: "transcript.txt" }));
  });

  it("ignores a page-level PageDown when Save transcripts is off, captures it once turned on", async () => {
    await render();
    document.body.focus();
    const offEvent = new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true });
    await act(async () => window.dispatchEvent(offEvent));
    expect(offEvent.defaultPrevented).toBe(false);
    expect(FakeRecorder.instances).toHaveLength(0);

    const saveToggle = container.querySelector('input[aria-label="Save transcripts"]') as HTMLInputElement;
    await act(async () => saveToggle.click());
    const onEvent = new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true });
    await act(async () => window.dispatchEvent(onEvent));
    expect(onEvent.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
  });

  it("skips page-level PageUp while an editable element is the target", async () => {
    await render();
    const input = document.createElement("input");
    container.append(input);
    const event = new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it("de-duplicates a repeated page-level PageUp keydown while held", async () => {
    await render();
    document.body.focus();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true })));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true })));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    expect(FakeRecorder.instances).toHaveLength(1);
  });

  function autoSendToggle() {
    return container.querySelector(
      'input[aria-label="Auto-send voice transcript"]',
    ) as HTMLInputElement | null;
  }

  it("defaults the auto-send toggle to checked when no preference is stored", async () => {
    await render();
    expect(autoSendToggle()?.checked).toBe(true);
  });

  it("loads a stored manual preference as unchecked on mount", async () => {
    window.localStorage.setItem("hermes.voice.autoSend", "0");
    await render();
    expect(autoSendToggle()?.checked).toBe(false);
  });

  it("persists a toggle change and passes it on the next transcript", async () => {
    const onTranscript = await render();
    await act(async () => autoSendToggle()?.click());
    expect(window.localStorage.getItem("hermes.voice.autoSend")).toBe("0");
    await startRecording();
    FakeRecorder.instances[0].emit(new Blob(["audio"]));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input", false, { enabled: false, path: "transcript.txt" }));
  });

  it("persists transcript autosave settings and attaches them to a voice send", async () => {
    const onTranscript = await render();
    const enabled = container.querySelector('input[aria-label="Save transcripts"]') as HTMLInputElement;
    const path = container.querySelector('input[aria-label="Transcript output path"]') as HTMLInputElement;
    await act(async () => enabled.click());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(path, "notes/voice.txt");
      path.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(window.localStorage.getItem("hermes.transcriptAutosave.enabled")).toBe("1");
    expect(window.localStorage.getItem("hermes.transcriptAutosave.path")).toBe("notes/voice.txt");
    await startRecording();
    FakeRecorder.instances[0].emit(new Blob(["audio"]));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input", true, { enabled: true, path: "notes/voice.txt" }));
  });
});
