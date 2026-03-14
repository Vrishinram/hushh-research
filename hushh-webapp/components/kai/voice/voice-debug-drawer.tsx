"use client";

import { Bug, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useVoiceSession } from "@/lib/voice/voice-session-store";
import type { VoiceUiState } from "@/lib/voice/voice-ui-state-machine";
import { cn } from "@/lib/utils";

type VoiceDebugDrawerProps = {
  enabled: boolean;
  currentState: VoiceUiState;
  sessionId: string;
  route: string;
  screen: string;
  authStatus: string;
  vaultStatus: string;
  voiceAvailabilityReason: string;
};

export function VoiceDebugDrawer({
  enabled,
  currentState,
  sessionId,
  route,
  screen,
  authStatus,
  vaultStatus,
  voiceAvailabilityReason,
}: VoiceDebugDrawerProps) {
  const [open, setOpen] = useState(false);
  const debugEvents = useVoiceSession((s) => s.debugEvents);
  const clearDebugEvents = useVoiceSession((s) => s.clearDebugEvents);
  const lastTurnId = useVoiceSession((s) => s.lastTurnId);

  const recentEvents = useMemo(() => {
    const slice = [...debugEvents].slice(-80).reverse();
    return slice;
  }, [debugEvents]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-auto fixed bottom-5 right-4 z-[180] w-[min(92vw,420px)]">
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-border/70 bg-background/95 px-3 text-xs font-semibold text-foreground shadow-md backdrop-blur hover:bg-muted"
          onClick={() => setOpen((v) => !v)}
        >
          <Bug className="h-3.5 w-3.5" />
          Voice Debug
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-2xl backdrop-blur transition-all duration-200",
          open ? "max-h-[65vh] opacity-100" : "pointer-events-none max-h-0 opacity-0"
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2">
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">State:</span> {currentState}
            </p>
            <p>
              <span className="font-semibold text-foreground">Session:</span> {sessionId}
            </p>
            <p>
              <span className="font-semibold text-foreground">Turn:</span> {lastTurnId ?? "n/a"}
            </p>
            <p>
              <span className="font-semibold text-foreground">Route:</span> {route} ({screen})
            </p>
            <p>
              <span className="font-semibold text-foreground">Auth:</span> {authStatus}
            </p>
            <p>
              <span className="font-semibold text-foreground">Vault:</span> {vaultStatus}
            </p>
            <p>
              <span className="font-semibold text-foreground">Voice:</span> {voiceAvailabilityReason}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={clearDebugEvents}
            aria-label="Clear debug events"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-[45vh] overflow-auto px-3 py-2">
          {recentEvents.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No voice events captured yet.</p>
          ) : (
            <div className="space-y-1.5">
              {recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-border/50 bg-background/70 px-2.5 py-1.5 text-[10px]"
                >
                  <p className="font-semibold text-foreground">
                    {event.stage}:{event.event}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {event.timestamp} | turn={event.turnId}
                  </p>
                  {event.payload ? (
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
