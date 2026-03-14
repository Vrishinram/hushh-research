import { beforeEach, describe, expect, it, vi } from "vitest";

const synthesizeKaiVoiceMock = vi.fn();

vi.mock("@/lib/services/api-service", () => ({
  ApiService: {
    synthesizeKaiVoice: (...args: unknown[]) => synthesizeKaiVoiceMock(...args),
  },
}));

import { VoiceTtsPlaybackManager } from "@/lib/voice/voice-tts-playback";

class FakeAudio {
  static instances: FakeAudio[] = [];
  static autoEnd = true;

  src = "";
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplay: (() => void) | null = null;
  pause = vi.fn();

  constructor(url?: string) {
    this.src = url || "";
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.onplay?.();
    if (FakeAudio.autoEnd) {
      window.setTimeout(() => {
        this.onended?.();
      }, 0);
    }
    return Promise.resolve();
  }
}

describe("VoiceTtsPlaybackManager", () => {
  beforeEach(() => {
    synthesizeKaiVoiceMock.mockReset();
    FakeAudio.instances = [];
    FakeAudio.autoEnd = true;
    globalThis.Audio = FakeAudio as unknown as typeof Audio;
    URL.createObjectURL = vi.fn(() => "blob:voice-test");
    URL.revokeObjectURL = vi.fn();
  });

  it("plays backend TTS and transitions state", async () => {
    const states: string[] = [];
    const manager = new VoiceTtsPlaybackManager((state) => states.push(state));

    synthesizeKaiVoiceMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          audio_base64: "YWJj",
          mime_type: "audio/mpeg",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await manager.speak({
      userId: "user_1",
      vaultOwnerToken: "token_1",
      text: "Hello world",
      voiceTurnId: "vturn_test_1",
    });

    expect(synthesizeKaiVoiceMock).toHaveBeenCalledTimes(1);
    expect(synthesizeKaiVoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceTurnId: "vturn_test_1",
      })
    );
    expect(states).toEqual(["loading", "playing", "idle"]);
  });

  it("stop() interrupts active playback without hanging the speak promise", async () => {
    const states: string[] = [];
    const manager = new VoiceTtsPlaybackManager((state) => states.push(state));
    FakeAudio.autoEnd = false;

    synthesizeKaiVoiceMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          audio_base64: "YWJj",
          mime_type: "audio/mpeg",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const speakPromise = manager.speak({
      userId: "user_1",
      vaultOwnerToken: "token_1",
      text: "Long response",
    });

    await Promise.resolve();
    manager.stop();

    await expect(speakPromise).resolves.toBeUndefined();
    if (FakeAudio.instances.length > 0) {
      expect(FakeAudio.instances[0]!.pause).toHaveBeenCalledTimes(1);
    }
    expect(states[states.length - 1]).toBe("idle");
  });
});
