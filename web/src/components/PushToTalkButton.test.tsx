// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJSON } from "@/lib/api";
import { PushToTalkButton } from "./PushToTalkButton";

vi.mock("@/lib/api", () => ({ fetchJSON: vi.fn() }));

class FakeMediaRecorder {
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state: "inactive" | "recording" = "recording";
  stream: MediaStream;

  constructor(stream: MediaStream) {
    this.stream = stream;
  }

  start() {}

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["chunk"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

class FakeFileReader {
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  result: string | null = null;

  readAsDataURL() {
    this.result = "data:audio/webm;base64,ZmFrZQ==";
    queueMicrotask(() => this.onload?.());
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let container: HTMLDivElement;
let root: Root;

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
}

beforeEach(() => {
  vi.mocked(fetchJSON).mockReset();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("FileReader", FakeFileReader);
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    },
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe("PushToTalkButton", () => {
  it("records on pointer hold and posts the transcript on release", async () => {
    vi.mocked(fetchJSON).mockResolvedValue({ transcript: "hello world" });
    const onTranscript = vi.fn();

    await render(
      <PushToTalkButton onTranscript={onTranscript} profile="default" />,
    );
    const button = container.querySelector("button")!;

    await act(async () => {
      button.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
      );
      await flush();
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      button.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
      );
      await flush();
      await flush();
    });

    expect(fetchJSON).toHaveBeenCalledWith(
      "/api/audio/transcribe?profile=default",
      expect.objectContaining({
        body: JSON.stringify({
          data_url: "data:audio/webm;base64,ZmFrZQ==",
          mime_type: "audio/webm",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(onTranscript).toHaveBeenCalledWith("hello world");
  });
});
