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

let root: Root;
let container: HTMLDivElement;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchJSON.mockReset();
  fetchJSON.mockResolvedValue({ transcript: "voice input" });
  FakeRecorder.instances = [];
  getUserMedia = vi.fn(async () => new FakeStream());
  vi.stubGlobal("MediaRecorder", FakeRecorder);
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
async function render(onTranscript = vi.fn()) {
  root = createRoot(container);
  await act(async () => root.render(<PushToTalkButton onTranscript={onTranscript} />));
  return onTranscript;
}

async function startRecording(expected = 1) {
  await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
  await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(expected));
}

describe("PushToTalkButton", () => {
  it("starts on pointer hold and submits one transcript on release", async () => {
    const onTranscript = await render();
    await startRecording();
    const recorder = FakeRecorder.instances[0];
    recorder.emit(new Blob(["audio"]));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input"));
    expect(recorder.stream.track.stop).toHaveBeenCalled();
  });

  it("does not construct a recorder when released before permission resolves", async () => {
    let resolve: (stream: FakeStream) => void = () => {};
    getUserMedia.mockReturnValue(new Promise<FakeStream>((r) => { resolve = r; }));
    const onTranscript = await render();
    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await act(async () => button().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })));
    await act(async () => resolve(new FakeStream()));
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("cleans up after permission denial", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("denied"));
    await render();
    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  });

  it("cleans up when recorder construction fails", async () => {
    const stream = new FakeStream();
    getUserMedia.mockResolvedValueOnce(stream);
    vi.stubGlobal("MediaRecorder", class { constructor() { throw new Error("unsupported"); } });
    await render();
    await act(async () => button().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
    await vi.waitFor(() => expect(stream.track.stop).toHaveBeenCalled());
  });

  it("skips empty blobs and transcription rejection", async () => {
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
    await Promise.resolve();
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
    await act(async () => button().dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
    FakeRecorder.instances[0].emit(new Blob(["audio"]));
    await act(async () => button().dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })));
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith("voice input"));
  });
});
