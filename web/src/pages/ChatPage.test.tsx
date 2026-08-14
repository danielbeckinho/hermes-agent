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
  options: Record<string, unknown>;
  rows = 24;
  cols = 80;
  parser = {
    registerOscHandler: vi.fn(),
  };
  unicode = { activeVersion: "" };

  constructor(options: Record<string, unknown>) {
    this.options = options;
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

  onData() {
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
const { voiceState } = vi.hoisted(() => ({ voiceState: { onTranscript: null as ((text: string) => void) | null } }));
vi.mock("@/components/PushToTalkButton", () => ({
  PushToTalkButton: (props: { onTranscript: (text: string) => void }) => {
    voiceState.onTranscript = props.onTranscript;
    return null;
  },
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
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe("ChatPage", () => {
  it("does not speak an unrelated turn after a voice transcript", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(<MemoryRouter initialEntries={["/chat"]}><ChatPage isActive /></MemoryRouter>);
    await vi.waitFor(() => expect(voiceState.onTranscript).toBeTypeOf("function"));
    voiceState.onTranscript?.("voice prompt");
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
    voiceState.onTranscript?.("voice prompt");
    sidebarState.current.onMessageStart?.({ voice_turn: true });
    sidebarState.current.onMessageComplete?.({ text: "voice reply", voice_turn: true });
    await vi.waitFor(() => expect(apiMocks.fetchJSON).toHaveBeenCalledWith(
      expect.stringContaining("/api/audio/speak"),
      expect.anything(),
    ));
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
