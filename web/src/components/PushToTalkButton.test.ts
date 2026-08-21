import { describe, expect, it } from "vitest";

import { encodeVoiceSubmission, shouldHandleGlobalVoiceShortcut, voiceShortcutForKey } from "./PushToTalkButton";

describe("push-to-talk keyboard routing", () => {
  it("keeps PageUp and PageDown on distinct actions", () => {
    expect(voiceShortcutForKey("PageUp")).toBe("send");
    expect(voiceShortcutForKey("PageDown")).toBe("save");
    expect(voiceShortcutForKey("Enter")).toBeNull();
    expect(shouldHandleGlobalVoiceShortcut("PageDown", true, true)).toBe(false);
    expect(shouldHandleGlobalVoiceShortcut("PageDown", false, true)).toBe(true);
    expect(shouldHandleGlobalVoiceShortcut("PageDown", false, false)).toBe(false);
  });

  it("encodes a voice turn with real control characters", () => {
    expect(encodeVoiceSubmission("hello", true)).toEqual({
      text: "hello\uE000",
      submit: "\r",
    });
  });
});
