"use client";

export type VoiceRealtimeSessionInfo = {
  clientSecret: string;
  model: string;
  voice: string;
  sessionId?: string | null;
};

type VoiceRealtimeEventPayload = Record<string, unknown>;

type VoiceRealtimeTranscriptEvent = {
  kind: "partial" | "final";
  text: string;
  itemId?: string | null;
};

type VoiceRealtimeConnectInput = {
  session: VoiceRealtimeSessionInfo;
  localStream?: MediaStream;
  turnId?: string;
  onTranscript?: (event: VoiceRealtimeTranscriptEvent) => void;
  onDebug?: (event: string, payload?: VoiceRealtimeEventPayload) => void;
};

type VoiceRealtimeSpeechInput = {
  text: string;
  voice?: string;
  timeoutMs?: number;
  onFirstAudio?: () => void;
  onPlaybackStarted?: () => void;
  onPlaybackEnded?: () => void;
};

type PendingSpeechState = {
  timeoutHandle: number;
  started: boolean;
  firstAudio: boolean;
  onFirstAudio?: () => void;
  onPlaybackStarted?: () => void;
  onPlaybackEnded?: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
};

const DEFAULT_SPEECH_TIMEOUT_MS = 30000;
const DEFAULT_FINAL_TRANSCRIPT_TIMEOUT_MS = 25000;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTranscriptEvent(payload: Record<string, unknown>): VoiceRealtimeTranscriptEvent | null {
  const eventType = String(payload.type || "").trim();
  if (!eventType) return null;

  const itemId = typeof payload.item_id === "string" ? payload.item_id : null;
  if (eventType === "conversation.item.input_audio_transcription.delta") {
    const delta = typeof payload.delta === "string" ? payload.delta : "";
    if (!delta.trim()) return null;
    return {
      kind: "partial",
      text: delta,
      itemId,
    };
  }
  if (eventType === "conversation.item.input_audio_transcription.completed") {
    const transcript = typeof payload.transcript === "string" ? payload.transcript : "";
    if (!transcript.trim()) return null;
    return {
      kind: "final",
      text: transcript,
      itemId,
    };
  }
  return null;
}

export class VoiceRealtimeClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private onTranscript?: (event: VoiceRealtimeTranscriptEvent) => void;
  private onDebug?: (event: string, payload?: VoiceRealtimeEventPayload) => void;
  private latestFinalTranscript = "";
  private finalTranscriptWaiters: Array<{
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timeoutHandle: number;
  }> = [];
  private pendingSpeech: PendingSpeechState | null = null;
  private isConnected = false;

  async connect(input: VoiceRealtimeConnectInput): Promise<MediaStream> {
    await this.close();
    this.onTranscript = input.onTranscript;
    this.onDebug = input.onDebug;

    const stream =
      input.localStream || (await navigator.mediaDevices.getUserMedia({ audio: true }));
    this.localStream = stream;

    const pc = new RTCPeerConnection();
    this.peerConnection = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    this.remoteAudio.onplay = () => {
      const pending = this.pendingSpeech;
      if (!pending || pending.started) return;
      pending.started = true;
      pending.onPlaybackStarted?.();
    };

    pc.ontrack = (event: RTCTrackEvent) => {
      if (!this.remoteAudio) return;
      this.remoteAudio.srcObject = event.streams[0] || new MediaStream([event.track]);
      void this.remoteAudio.play().catch(() => {
        // Browser autoplay policy can block play until interaction.
      });
    };

    const channel = pc.createDataChannel("oai-events");
    this.dataChannel = channel;
    channel.onmessage = (event: MessageEvent<string>) => this.handleDataMessage(event.data);
    channel.onerror = () => {
      this.onDebug?.("data_channel_error");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (!offer.sdp) {
      throw new Error("Realtime SDP offer missing");
    }

    const realtimeUrl = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(input.session.model)}`;
    const response = await fetch(realtimeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.session.clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `Realtime SDP exchange failed (${response.status})`);
    }

    const answerSdp = await response.text();
    await pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    await this.waitForDataChannelOpen(channel, 10000);
    this.isConnected = true;
    this.onDebug?.("stream_session_start", {
      turn_id: input.turnId || null,
      model: input.session.model,
      voice: input.session.voice,
      session_id: input.session.sessionId || null,
    });
    return stream;
  }

  getStream(): MediaStream | null {
    return this.localStream;
  }

  connected(): boolean {
    return this.isConnected;
  }

  commitInputAudio(): void {
    this.sendEvent({
      type: "input_audio_buffer.commit",
    });
  }

  waitForFinalTranscript(timeoutMs: number = DEFAULT_FINAL_TRANSCRIPT_TIMEOUT_MS): Promise<string> {
    if (this.latestFinalTranscript.trim()) {
      const text = this.latestFinalTranscript.trim();
      this.latestFinalTranscript = "";
      return Promise.resolve(text);
    }
    return new Promise<string>((resolve, reject) => {
      const timeoutHandle = window.setTimeout(() => {
        this.finalTranscriptWaiters = this.finalTranscriptWaiters.filter((entry) => entry.reject !== reject);
        reject(new Error("VOICE_STREAM_FINAL_TRANSCRIPT_TIMEOUT"));
      }, timeoutMs);
      this.finalTranscriptWaiters.push({ resolve, reject, timeoutHandle });
    });
  }

  async requestSpeech(input: VoiceRealtimeSpeechInput): Promise<void> {
    if (!this.connected()) {
      throw new Error("Realtime session is not connected");
    }

    const cleanText = String(input.text || "").trim();
    if (!cleanText) return;

    if (this.pendingSpeech) {
      this.cancelSpeech("VOICE_STREAM_TTS_INTERRUPTED");
    }

    await new Promise<void>((resolve, reject) => {
      const timeoutMs =
        typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
          ? Math.round(input.timeoutMs)
          : DEFAULT_SPEECH_TIMEOUT_MS;
      const timeoutHandle = window.setTimeout(() => {
        this.pendingSpeech = null;
        reject(new Error("VOICE_STREAM_TTS_TIMEOUT"));
      }, timeoutMs);
      this.pendingSpeech = {
        timeoutHandle,
        started: false,
        firstAudio: false,
        onFirstAudio: input.onFirstAudio,
        onPlaybackStarted: input.onPlaybackStarted,
        onPlaybackEnded: input.onPlaybackEnded,
        resolve: () => {
          window.clearTimeout(timeoutHandle);
          this.pendingSpeech = null;
          resolve();
        },
        reject: (error: Error) => {
          window.clearTimeout(timeoutHandle);
          this.pendingSpeech = null;
          reject(error);
        },
      };

      this.sendEvent({
        type: "response.create",
        response: {
          modalities: ["audio"],
          instructions: `Speak this response naturally and clearly: ${cleanText}`,
          audio: {
            voice: input.voice || "alloy",
          },
        },
      });
    });
  }

  cancelSpeech(reason: string = "VOICE_STREAM_TTS_CANCELLED"): void {
    this.sendEvent({ type: "response.cancel" });
    if (!this.pendingSpeech) return;
    const pending = this.pendingSpeech;
    this.pendingSpeech = null;
    window.clearTimeout(pending.timeoutHandle);
    pending.reject(new Error(reason));
  }

  async close(options?: { stopLocalStream?: boolean }): Promise<void> {
    this.isConnected = false;
    this.cancelSpeech("VOICE_STREAM_SESSION_CLOSED");

    this.finalTranscriptWaiters.forEach((waiter) => {
      window.clearTimeout(waiter.timeoutHandle);
      waiter.reject(new Error("VOICE_STREAM_SESSION_CLOSED"));
    });
    this.finalTranscriptWaiters = [];
    this.latestFinalTranscript = "";

    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {
        // noop
      }
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {
        // noop
      }
      this.peerConnection = null;
    }
    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      this.remoteAudio.onplay = null;
      this.remoteAudio = null;
    }
    if (this.localStream && options?.stopLocalStream !== false) {
      this.localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // noop
        }
      });
    }
    if (this.localStream) {
      this.localStream = null;
    }
  }

  private waitForDataChannelOpen(channel: RTCDataChannel, timeoutMs: number): Promise<void> {
    if (channel.readyState === "open") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timeoutHandle = window.setTimeout(() => {
        cleanup();
        reject(new Error("VOICE_STREAM_DATA_CHANNEL_TIMEOUT"));
      }, timeoutMs);
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        window.clearTimeout(timeoutHandle);
        channel.removeEventListener("open", handleOpen);
      };
      channel.addEventListener("open", handleOpen);
    });
  }

  private sendEvent(payload: Record<string, unknown>): void {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      throw new Error("Realtime data channel is not open");
    }
    this.dataChannel.send(JSON.stringify(payload));
  }

  private handleDataMessage(raw: string): void {
    let payload: Record<string, unknown> | null = null;
    try {
      payload = asObject(JSON.parse(raw));
    } catch {
      payload = null;
    }
    if (!payload) return;

    const transcriptEvent = normalizeTranscriptEvent(payload);
    if (transcriptEvent) {
      if (transcriptEvent.kind === "final") {
        this.latestFinalTranscript = transcriptEvent.text;
        this.finalTranscriptWaiters.forEach((waiter) => {
          window.clearTimeout(waiter.timeoutHandle);
          waiter.resolve(transcriptEvent.text);
        });
        this.finalTranscriptWaiters = [];
      }
      this.onTranscript?.(transcriptEvent);
      return;
    }

    const eventType = String(payload.type || "").trim();
    if (!eventType) return;

    if (eventType === "response.audio.delta") {
      const pending = this.pendingSpeech;
      if (!pending) return;
      if (!pending.firstAudio) {
        pending.firstAudio = true;
        pending.onFirstAudio?.();
      }
      if (!pending.started) {
        pending.started = true;
        pending.onPlaybackStarted?.();
      }
      return;
    }

    if (eventType === "response.done") {
      const pending = this.pendingSpeech;
      if (!pending) return;
      pending.onPlaybackEnded?.();
      pending.resolve();
      return;
    }

    if (eventType === "error") {
      const errorObject = asObject(payload.error);
      const message =
        (errorObject && typeof errorObject.message === "string" && errorObject.message) ||
        "Realtime API error";
      const pending = this.pendingSpeech;
      if (pending) {
        pending.reject(new Error(message));
      }
      this.onDebug?.("stream_error", {
        message,
      });
    }
  }
}
