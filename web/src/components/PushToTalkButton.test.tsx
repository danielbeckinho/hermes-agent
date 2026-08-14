// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJSON = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ fetchJSON }));

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor() {
    FakeRecorder.instances.push(this);
  }

  start() {}

  stop() {
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

let container: HTMLDivElement;
let root: Root;
let resolveMedia!: (stream: MediaStream) => void;
const getUserMedia = vi.fn(
  () => new Promise<MediaStream>((resolve) => { resolveMedia = resolve; }),
);
const stop = vi.fn();

beforeEach(() => {
  fetchJSON.mockResolvedValue({ transcript: "voice turn" });
  getUserMedia.mockClear();
  stop.mockClear();
  FakeRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("PushToTalkButton", () => {
  it("guards microphone requests and sends the released recording", async () => {
    const { PushToTalkButton } = await import("./PushToTalkButton");
    const onTranscript = vi.fn();
    await act(async () => root.render(<PushToTalkButton onTranscript={onTranscript} profile="worker" />));

    const button = container.querySelector("button")!;
    await act(async () => {
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => resolveMedia({ getTracks: () => [{ stop }] } as unknown as MediaStream));
    await act(async () => button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));

    await vi.waitFor(() => expect(fetchJSON).toHaveBeenCalledWith(
      "/api/audio/transcribe?profile=worker",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(onTranscript).toHaveBeenCalledWith("voice turn");
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
