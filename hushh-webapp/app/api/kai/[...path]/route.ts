import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getPythonApiUrl } from "@/app/api/_utils/backend";

type VoiceProxyTimingState = {
  turnStartMs: number;
  lastStageMs: number;
};

const voiceProxyTimingByTurn = new Map<string, VoiceProxyTimingState>();

function emitProxyVoiceStage(
  turnId: string,
  stage: string,
  metadata: Record<string, unknown> = {},
  options?: { finalize?: boolean }
) {
  if (!turnId) return;
  const nowMs = Date.now();
  const existing = voiceProxyTimingByTurn.get(turnId);
  if (!existing) {
    voiceProxyTimingByTurn.set(turnId, {
      turnStartMs: nowMs,
      lastStageMs: nowMs,
    });
  }
  const current = voiceProxyTimingByTurn.get(turnId)!;
  const sincePrevMs = existing ? Math.max(0, nowMs - existing.lastStageMs) : 0;
  const sinceTurnStartMs = Math.max(0, nowMs - current.turnStartMs);
  voiceProxyTimingByTurn.set(turnId, {
    turnStartMs: current.turnStartMs,
    lastStageMs: nowMs,
  });

  const payload = {
    turn_id: turnId,
    event: stage,
    stage,
    timestamp_iso: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    layer: "proxy",
    source:
      typeof metadata.source === "string" && metadata.source.trim()
        ? metadata.source
        : "nextjs_kai_proxy",
    route: typeof metadata.route === "string" ? metadata.route : null,
    since_prev_ms: sincePrevMs,
    since_turn_start_ms: sinceTurnStartMs,
    ...metadata,
  };
  console.info("[KAI_VOICE_TRACE_PROXY]", payload);

  if (options?.finalize) {
    voiceProxyTimingByTurn.delete(turnId);
  }
}

/**
 * Kai Catch-All Proxy
 *
 * Forwards all requests from /api/kai/* to the Python backend.
 * Supports:
 * - JSON requests (chat, analyze, etc.)
 * - Multipart form data (portfolio import)
 * - SSE streaming (analysis stream)
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return proxyRequest(request, params);
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return proxyRequest(request, params);
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return proxyRequest(request, params);
}

async function proxyRequest(request: NextRequest, params: { path: string[] }) {
  const path = params.path.join("/");
  // Forward query string to backend
  const queryString = request.nextUrl.search;
  const url = `${getPythonApiUrl()}/api/kai/${path}${queryString}`;

  // Debug: Check if Authorization header is present
  const authHeader = request.headers.get("authorization");
  const acceptHeader = request.headers.get("accept");
  const voiceTurnIdHeader = request.headers.get("x-voice-turn-id");
  const contentType = request.headers.get("content-type") || "";
  const isVoiceRoute = path.startsWith("voice/");
  const voiceTraceTurnId = isVoiceRoute
    ? (voiceTurnIdHeader || `vturn_proxy_${Date.now().toString(16)}`).slice(0, 128)
    : null;

  if (voiceTraceTurnId) {
    emitProxyVoiceStage(voiceTraceTurnId, "proxy_request_received", {
      method: request.method,
      route: `/api/kai/${path}`,
      content_type: contentType || null,
      has_auth_header: Boolean(authHeader),
      source: "nextjs_kai_proxy",
    });
    // Compatibility alias retained.
    emitProxyVoiceStage(voiceTraceTurnId, "proxy_received", {
      method: request.method,
      route: `/api/kai/${path}`,
      content_type: contentType || null,
      has_auth_header: Boolean(authHeader),
      source: "nextjs_kai_proxy",
    });
  }

  console.log(`[Kai API] Proxying ${request.method} ${path}`);
  console.log(`[Kai API] Authorization header present: ${!!authHeader}`);
  console.log(`[Kai API] Content-Type: ${contentType}`);

  try {
    const headers = new Headers();
    
    // Copy authorization header
    if (authHeader) {
      headers.set("Authorization", authHeader);
    }
    if (acceptHeader) {
      headers.set("Accept", acceptHeader);
    }
    if (voiceTurnIdHeader) {
      headers.set("X-Voice-Turn-Id", voiceTurnIdHeader.slice(0, 128));
    }

    let body: BodyInit | undefined;
    
    // Handle different content types
    if (request.method === "GET" || request.method === "DELETE") {
      body = undefined;
    } else if (contentType.includes("multipart/form-data")) {
      // For file uploads, pass through the FormData
      // Don't set Content-Type - let fetch set it with boundary
      const formData = await request.formData();
      body = formData;
      console.log(`[Kai API] Forwarding multipart form data`);
    } else {
      // For JSON requests
      headers.set("Content-Type", "application/json");
      body = await request.text();
    }

    if (voiceTraceTurnId) {
      emitProxyVoiceStage(voiceTraceTurnId, "proxy_forward_started", {
        method: request.method,
        route: `/api/kai/${path}`,
        target_url: url,
        source: "nextjs_kai_proxy",
      });
      // Compatibility alias retained.
      emitProxyVoiceStage(voiceTraceTurnId, "proxy_forwarded", {
        method: request.method,
        route: `/api/kai/${path}`,
        target_url: url,
        body_mode:
          request.method === "GET" || request.method === "DELETE"
            ? "none"
            : contentType.includes("multipart/form-data")
              ? "multipart_form_data"
              : "json_text",
        source: "nextjs_kai_proxy",
      });
    }

    const response = await fetch(url, {
      method: request.method,
      headers: headers,
      body: body,
    });

    // Check for SSE stream response
    const responseContentType = response.headers.get("content-type");
    if (voiceTraceTurnId) {
      const shouldFinalize = path === "voice/tts" || response.status >= 400;
      emitProxyVoiceStage(
        voiceTraceTurnId,
        "proxy_response_headers_received",
        {
          method: request.method,
          route: `/api/kai/${path}`,
          status_code: response.status,
          response_content_type: responseContentType || null,
          source: "nextjs_kai_proxy",
        },
        { finalize: false }
      );
      // Compatibility alias retained.
      emitProxyVoiceStage(
        voiceTraceTurnId,
        "proxy_response_received",
        {
          method: request.method,
          route: `/api/kai/${path}`,
          status: response.status,
          response_content_type: responseContentType || null,
          source: "nextjs_kai_proxy",
        },
        { finalize: shouldFinalize }
      );
    }

    if (responseContentType?.includes("text/event-stream")) {
      console.log(`[Kai API] SSE stream detected, passing through`);
      // Return SSE stream directly without parsing
      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Content-Encoding": "none",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const data = await response.json().catch(() => ({}));
    if (voiceTraceTurnId) {
      emitProxyVoiceStage(
        voiceTraceTurnId,
        "proxy_response_body_received",
        {
          method: request.method,
          route: `/api/kai/${path}`,
          status_code: response.status,
          source: "nextjs_kai_proxy",
        },
        { finalize: false }
      );
      emitProxyVoiceStage(
        voiceTraceTurnId,
        "proxy_payload_parsed",
        {
          method: request.method,
          route: `/api/kai/${path}`,
          status_code: response.status,
          payload_type: typeof data,
          source: "nextjs_kai_proxy",
        },
        { finalize: !response.ok || path === "voice/tts" }
      );
    }

    if (!response.ok) {
      const expectedAnalyzeRunMiss =
        path === "analyze/run/active" &&
        response.status === 404 &&
        typeof data === "object" &&
        data !== null &&
        typeof (data as { detail?: { code?: unknown } }).detail?.code === "string" &&
        (data as { detail: { code: string } }).detail.code === "ANALYZE_RUN_NOT_FOUND";
      if (expectedAnalyzeRunMiss) {
        console.info(
          `[Kai API] No active analyze run for current session (${response.status}).`
        );
      } else {
        console.error(`[Kai API] Error calling ${url}: ${response.status}`, data);
      }
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    if (voiceTraceTurnId) {
      emitProxyVoiceStage(
        voiceTraceTurnId,
        "proxy_response_received",
        {
          method: request.method,
          route: `/api/kai/${path}`,
          status: 500,
          error: String(error),
        },
        { finalize: true }
      );
    }
    console.error(`[Kai API] Internal Error proxying to ${url}:`, error);
    return NextResponse.json(
      { error: "Internal Proxy Error", details: String(error) },
      { status: 500 }
    );
  }
}
