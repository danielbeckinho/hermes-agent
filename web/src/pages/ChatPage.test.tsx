// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeFitAddon {
  fit() {}
}

class FakeWebglAddon {
  onContextLoss() {
    return { dispose() {} };
  }
}

class FakeTerminal {
  static instances: FakeTerminal[] = [];
  options: Record<string, unknown>;
  rows = 24;
  cols = 80;
  onDataHandler: ((data: string) => void) | null = null;
  parser = {
    registerOscHandler: vi.fn(),
  };
  unicode = { activeVersion: "" };

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeTerminal.instances.push(this);
  }

  attachCustomKeyEventHandler() {
    return true;
  }

  attachCustomWheelEventHandler() {
    return true;
  }

  clearSelection() {}

  dispose() {}

  focus() {}

  getSelection() {
    return "";
  }

  loadAddon() {}

  onData(handler: (data: string) => void) {
    this.onDataHandler = handler;
    return { dispose() {} };
  }

  onResize() {
    return { dispose() {} };
  }

  open() {}

  paste() {}

  refresh() {}

  write() {}
}

const maybeReloadForLoopbackWsAuthFailure = vi.fn(() => false);
const apiMocks = vi.hoisted(() => ({
  buildWsUrl: vi.fn(async () => "ws://localhost/api/pty?channel=chat-1"),
  fetchJSON: vi.fn(async () => ({ data_url: "data:audio/wav;base64,AA==" })),
}));

vi.mock("@xterm/addon-fit", () => ({ FitAddon: FakeFitAddon }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: FakeWebglAddon }));
vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
const { sidebarState } = vi.hoisted(() => ({ sidebarState: { current: {} as Record<string, ((payload: unknown) => void) | undefined> } }));
vi.mock("@/components/ChatSidebar", () => ({
  ChatSidebar: (props: Record<string, unknown>) => {
    sidebarState.current = props as typeof sidebarState.current;
    return null;
  },
}));
const { voiceState } = vi.hoisted(() => ({ voiceState: { onTranscript: null as ((text: string, autoSend: boolean, autosave?: { enabled: boolean; path: string; timestamp?: boolean }) => void) | null } }));
vi.mock("@/components/PushToTalkButton", () => ({
  PushToTalkButton: (props: { onTranscript: (text: string, autoSend: boolean, autosave?: { enabled: boolean; path: string; timestamp?: boolean }) => void }) => {
    voiceState.onTranscript = props.onTranscript;
    return null;
  },
  readTranscriptAutosaveSettings: () => ({
    enabled: window.localStorage.getItem("hermes.transcriptAutosave.enabled") === "1",
    path: window.localStorage.getItem("hermes.transcriptAutosave.path") || "transcript.txt",
  }),
}));
vi.mock("@/components/ChatSessionList", () => ({
  ChatSessionList: () => null,
}));
vi.mock("@/components/Backdrop", () => ({ Backdrop: () => null }));
vi.mock("@/plugins", () => ({
  PluginSlot: () => null,
}));
vi.mock("@/contexts/usePageHeader", () => ({
  usePageHeader: () => ({ setEnd: vi.fn(), setTitle: vi.fn() }),
}));
vi.mock("@/contexts/useProfileScope", () => ({
  useProfileScope: () => ({ profile: "" }),
}));
vi.mock("@/themes", () => ({
  useTheme: () => ({ theme: { terminalBackground: "#000000" } }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: {
      app: {
        closeModelTools: "Close model tools",
        modelToolsSheetSubtitle: "Tools",
        modelToolsSheetTitle: "Model",
      },
    },
  }),
}));
vi.mock("@/lib/dashboard-auth-reload", () => ({
  maybeReloadForLoopbackWsAuthFailure,
}));
vi.mock("@/lib/api", () => ({
  api: apiMocks,
  buildWsUrl: apiMocks.buildWsUrl,
  fetchJSON: apiMocks.fetchJSON,
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;

  binaryType = "blob";
  onclose: ((event: CloseEventLike) => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer | string }) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = FakeWebSocket.OPEN;
  url: string;

  sent: string[] = [];
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
  }

  send(value: string) { this.sent.push(value); }
}

type CloseEventLike = {
  code: number;
  reason: string;
  wasClean: boolean;
};

let container: HTMLDivElement;
let root: Root;

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
}

beforeEach(() => {
  apiMocks.fetchJSON.mockReset();
  apiMocks.fetchJSON.mockResolvedValue({ data_url: "data:audio/wav;base64,AA==" });
  sidebarState.current = {};
  voiceState.onTranscript = null;
  vi.stubGlobal("fetch", vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({ data_url: "data:audio/wav;base64,AA==" }),
    clone() { return this; },
  })));
  vi.stubGlobal("Audio", class { play() { return Promise.resolve(); } });
  FakeTerminal.instances = [];
  FakeWebSocket.instances = [];
  maybeReloadForLoopbackWsAuthFailure.mockClear();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", () => ({
    addEventListener() {},
    matches: false,
    media: "",
    removeEventListener() {},
  }));
  vi.stubGlobal("crypto", {
    getRandomValues: (values: Uint8Array) => {
      values.fill(7);
      return values;
    },
    randomUUID: () => "chat-test-id",
  });

  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {}, width: 1280 },
  });
  Object.defineProperty(window, "__HERMES_SESSION_TOKEN__", {
    configurable: true,
    value: "stale-token",
    writable: true,
  });
  Object.defineProperty(window, "__HERMES_AUTH_REQUIRED__", {
    configurable: true,
    value: false,
    writable: true,
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async () => {}),
    },
  });
  sessionStorage.clear();
  const localStorageStore = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => localStorageStore.clear(),
    getItem: (key: string) => (localStorageStore.has(key) ? localStorageStore.get(key)! : null),
    removeItem: (key: string) => localStorageStore.delete(key),
    setItem: (key: string, value: string) => localStorageStore.set(key, value),
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe("ChatPage", () => {
  it("waits for the voice transcript to reach the PTY before submitting", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    const ws = FakeWebSocket.instances.at(-1)!;

    vi.useFakeTimers();
    voiceState.onTranscript?.("voice prompt", true);
    expect(ws.sent.slice(-1)).toEqual(["voice prompt\uE000"]);

    await vi.advanceTimersByTimeAsync(100);
    expect(ws.sent.slice(-2)).toEqual(["voice prompt\uE000", "\r"]);
    vi.useRealTimers();
  });

  it("timestamps only an explicit voice send-and-save entry", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T22:00:00.000Z"));

    voiceState.onTranscript?.("voice prompt", true, { enabled: true, path: "transcript.txt", timestamp: true });

    expect(apiMocks.fetchJSON).toHaveBeenCalledWith("/api/dashboard/transcript-autosave", expect.objectContaining({
      body: JSON.stringify({ path: "transcript.txt", text: "2026-08-15T22:00:00.000Z voice prompt" }),
    }));
    vi.useRealTimers();
  });

  it("timestamps every non-empty line in an explicit multiline send-and-save entry", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T22:00:00.000Z"));

    voiceState.onTranscript?.("first line\n\nsecond line", true, { enabled: true, path: "transcript.txt", timestamp: true });

    expect(apiMocks.fetchJSON).toHaveBeenCalledWith("/api/dashboard/transcript-autosave", expect.objectContaining({
      body: JSON.stringify({ path: "transcript.txt", text: "2026-08-15T22:00:00.000Z first line\n2026-08-15T22:00:00.000Z second line" }),
    }));
    vi.useRealTimers();
  });

  it("does not write a transcript for a plain voice send even when autosave is enabled", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));

    // Checkbox on makes Send + Save available, but a plain Send (PgUp) must
    // NOT append to the transcript file — only an explicit Send + Save does.
    voiceState.onTranscript?.("voice prompt", true, { enabled: true, path: "transcript.txt" });

    expect(apiMocks.fetchJSON).not.toHaveBeenCalledWith(
      "/api/dashboard/transcript-autosave",
      expect.anything(),
    );
  });

  it("does not save typed text or a manual voice transcript submitted via Enter", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    const terminal = FakeTerminal.instances.at(-1)!;
    await vi.waitFor(() => expect(terminal.onDataHandler).toBeTypeOf("function"));
    const ws = FakeWebSocket.instances.at(-1)!;
    await act(async () => ws.onopen?.());

    // Checkbox on (persisted). Typed text followed by Enter routes through
    // the onData submit seam and must never append to the transcript file —
    // only Send + Save does.
    window.localStorage.setItem("hermes.transcriptAutosave.enabled", "1");
    await act(async () => terminal.onDataHandler?.("typed text"));
    await act(async () => terminal.onDataHandler?.("\r"));
    expect(apiMocks.fetchJSON).not.toHaveBeenCalledWith(
      "/api/dashboard/transcript-autosave",
      expect.anything(),
    );

    // A manually-edited voice transcript submitted later via Enter is also
    // not a Send + Save, so likewise must not be written.
    voiceState.onTranscript?.("editable voice", false);
    await act(async () => terminal.onDataHandler?.("\r"));
    expect(apiMocks.fetchJSON).not.toHaveBeenCalledWith(
      "/api/dashboard/transcript-autosave",
      expect.anything(),
    );
  });

  it("does not speak an unrelated turn after a voice transcript", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    voiceState.onTranscript?.("voice prompt", true);
    sidebarState.current.onMessageStart?.({ voice_turn: false });
    sidebarState.current.onMessageComplete?.({ text: "unrelated reply", voice_turn: false });
    await Promise.resolve();
    expect(apiMocks.fetchJSON).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/audio/speak"),
      expect.anything(),
    );
  });

  it("speaks a completion carrying the voice marker", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    voiceState.onTranscript?.("voice prompt", true);
    sidebarState.current.onMessageStart?.({ voice_turn: true });
    sidebarState.current.onMessageComplete?.({ text: "voice reply", voice_turn: true });
    await vi.waitFor(() => expect(apiMocks.fetchJSON).toHaveBeenCalledWith(
      expect.stringContaining("/api/audio/speak"),
      expect.anything(),
    ));
  });

  it("keeps a manual transcript editable until its later Enter submits the marker", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    const ws = FakeWebSocket.instances.at(-1)!;
    const terminal = FakeTerminal.instances.at(-1)!;
    await vi.waitFor(() => expect(terminal.onDataHandler).toBeTypeOf("function"));
    await act(async () => ws.onopen?.());

    voiceState.onTranscript?.("editable voice", false);
    expect(ws.sent.slice(-1)).toEqual(["editable voice"]);
    expect(ws.sent).not.toContain("\uE000");

    await act(async () => terminal.onDataHandler?.("\r"));
    expect(ws.sent.slice(-2)).toEqual(["\uE000", "\r"]);
  });

  it("does not carry a manual voice marker into a newer transcript", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    const ws = FakeWebSocket.instances.at(-1)!;
    const terminal = FakeTerminal.instances.at(-1)!;
    await vi.waitFor(() => expect(terminal.onDataHandler).toBeTypeOf("function"));
    await act(async () => ws.onopen?.());

    voiceState.onTranscript?.("old manual", false);
    vi.useFakeTimers();
    voiceState.onTranscript?.("new auto", true);
    await act(async () => terminal.onDataHandler?.("\r"));
    expect(ws.sent.slice(-2)).toEqual(["new auto\uE000", "\r"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(ws.sent.slice(-3)).toEqual(["new auto\uE000", "\r", "\r"]);
    vi.useRealTimers();
  });

  it("cancels manual voice draft on Ctrl-U, unrelated Enter has no marker", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    const ws = FakeWebSocket.instances.at(-1)!;
    const terminal = FakeTerminal.instances.at(-1)!;
    await vi.waitFor(() => expect(terminal.onDataHandler).toBeTypeOf("function"));
    await act(async () => ws.onopen?.());

    voiceState.onTranscript?.("manual transcript", false);
    expect(ws.sent.slice(-1)).toEqual(["manual transcript"]);

    // Ctrl-U cancels the line
    await act(async () => terminal.onDataHandler?.("\x15"));

    // Unrelated typed text
    await act(async () => terminal.onDataHandler?.("typed text"));

    // Enter submits \u2014 should have NO voice marker
    await act(async () => terminal.onDataHandler?.("\r"));
    expect(ws.sent).not.toContain("\uE000");
  });

  it("cancels manual voice draft on Ctrl-C, unrelated Enter has no marker", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    const ws = FakeWebSocket.instances.at(-1)!;
    const terminal = FakeTerminal.instances.at(-1)!;
    await vi.waitFor(() => expect(terminal.onDataHandler).toBeTypeOf("function"));
    await act(async () => ws.onopen?.());

    voiceState.onTranscript?.("manual transcript", false);
    expect(ws.sent.slice(-1)).toEqual(["manual transcript"]);

    // Ctrl-C cancels the line
    await act(async () => terminal.onDataHandler?.("\x03"));

    // Unrelated typed text
    await act(async () => terminal.onDataHandler?.("typed text"));

    // Enter submits \u2014 should have NO voice marker
    await act(async () => terminal.onDataHandler?.("\r"));
    expect(ws.sent).not.toContain("\uE000");
  });

  it("treats loopback 4401 closes as stale-token reload candidates", async () => {
    const { default: ChatPage } = await import("./ChatPage");

    await render(
      <MemoryRouter initialEntries={["/chat"]}>
        <ChatPage isActive />
      </MemoryRouter>,
    );

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    FakeWebSocket.instances[0].onclose?.({
      code: 4401,
      reason: "auth: token_mismatch",
      wasClean: true,
    });

    expect(maybeReloadForLoopbackWsAuthFailure).toHaveBeenCalledWith(4401);
  });
});
