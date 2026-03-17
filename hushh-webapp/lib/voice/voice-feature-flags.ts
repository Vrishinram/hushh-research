"use client";

function isTruthyEnvFlag(raw: string | undefined): boolean {
  return ["1", "true", "yes", "on", "enabled"].includes(
    String(raw || "").trim().toLowerCase()
  );
}

function isFalseyEnvFlag(raw: string | undefined): boolean {
  return ["0", "false", "no", "off", "disabled"].includes(
    String(raw || "").trim().toLowerCase()
  );
}

function resolveFlag(raw: string | undefined, defaultValue: boolean): boolean {
  if (isTruthyEnvFlag(raw)) return true;
  if (isFalseyEnvFlag(raw)) return false;
  return defaultValue;
}

export type VoiceV2Flags = {
  enabled: boolean;
  autoturnEnabled: boolean;
  submitDebugVisible: boolean;
  clientVadFallbackEnabled: boolean;
  ttsBackendFallbackEnabled: boolean;
};

export function getVoiceV2Flags(): VoiceV2Flags {
  const enabled = resolveFlag(process.env.NEXT_PUBLIC_VOICE_V2_ENABLED, true);
  return {
    enabled,
    autoturnEnabled: resolveFlag(process.env.NEXT_PUBLIC_VOICE_V2_AUTOTURN_ENABLED, enabled),
    submitDebugVisible: resolveFlag(process.env.NEXT_PUBLIC_VOICE_V2_SUBMIT_DEBUG_VISIBLE, false),
    clientVadFallbackEnabled: resolveFlag(
      process.env.NEXT_PUBLIC_VOICE_V2_CLIENT_VAD_FALLBACK_ENABLED,
      false
    ),
    ttsBackendFallbackEnabled: resolveFlag(
      process.env.NEXT_PUBLIC_VOICE_V2_TTS_BACKEND_FALLBACK_ENABLED,
      false
    ),
  };
}
