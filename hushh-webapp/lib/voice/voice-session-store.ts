import { create } from "zustand";

export interface VoiceSessionState {
  lastTranscript: string | null;
  lastToolName: string | null;
  lastTicker: string | null;
  pendingConfirmation:
    | {
        kind: "cancel_active_analysis";
      }
    | null;
  setLastVoiceTurn: (payload: {
    transcript: string;
    toolName: string;
    ticker?: string | null;
  }) => void;
  setPendingConfirmation: (payload: VoiceSessionState["pendingConfirmation"]) => void;
  clearVoiceSession: () => void;
}

export const useVoiceSession = create<VoiceSessionState>((set) => ({
  lastTranscript: null,
  lastToolName: null,
  lastTicker: null,
  pendingConfirmation: null,
  setLastVoiceTurn: ({ transcript, toolName, ticker }) =>
    set({
      lastTranscript: transcript,
      lastToolName: toolName,
      lastTicker: ticker ?? null,
    }),
  setPendingConfirmation: (payload) =>
    set({
      pendingConfirmation: payload,
    }),
  clearVoiceSession: () =>
    set({
      lastTranscript: null,
      lastToolName: null,
      lastTicker: null,
      pendingConfirmation: null,
    }),
}));
