# Kai Voice Performance Review (Level-3 Voice)

## Scope
This report summarizes the current voice pipeline, root-cause latency analysis, optimizations implemented, and recommended next steps for senior engineering review.

## System Path (Current)
1. `KaiSearchBar` captures audio (`MediaRecorder`) and uploads to backend STT.
2. Backend `/api/kai/voice/stt` calls OpenAI transcription model.
3. Frontend sends transcript to backend `/api/kai/voice/plan`.
4. Backend planner uses OpenAI tool-calling and returns strict `tool_call`.
5. Frontend dispatches through existing command executor (`executeKaiCommand`) and existing services.

No parallel command system was introduced; voice remains an input modality over existing command/run flows.

## Key Files
- Frontend mic + timing logs:
  - `hushh-webapp/components/kai/kai-search-bar.tsx`
- Frontend shared executor/dispatch usage:
  - `hushh-webapp/components/kai/kai-command-bar-global.tsx`
  - `hushh-webapp/lib/voice/voice-action-dispatcher.ts`
- Frontend transport:
  - `hushh-webapp/lib/services/api-service.ts`
- Backend voice routes:
  - `consent-protocol/api/routes/kai/voice.py`
- Backend planner/STT service:
  - `consent-protocol/hushh_mcp/services/voice_intent_service.py`
- Raw OpenAI benchmark script:
  - `consent-protocol/scripts/voice_latency_probe.py`

## Observed Production-Like Behavior (from logs)
- Dispatch/navigation is fast (`~1-55 ms`).
- Latency is dominated by STT + planning and backend contention.
- Example run:
  - `VOICE_STT_TIMING request_ms=24276` (large)
  - `VOICE_PLAN_TIMING request_ms=6385`
  - `VOICE_E2E_TIMING total_pipeline_ms=30724`
- Concurrent app requests also showed long durations (`market/insights`, `world-model`, consent endpoints), indicating backend load/queueing affects voice path.

## Root Causes
1. Planner model was configured to `gpt-4.1-mini` in local `.env` (not nano).
2. Voice pipeline does two sequential AI calls (STT then plan), so both latencies add.
3. High backend contention from unrelated long-running endpoints increased queue/network-overhead time.
4. Planner payload/context could become noisier than needed.

## Optimizations Implemented

### 1) Fast model defaults + fallback chain
- Updated backend model selection to use model candidate lists with retry on model-access errors.
- Intent model priority:
  - `gpt-4.1-nano` -> `gpt-4o-mini` -> `gpt-4.1-mini`
- STT model priority:
  - `gpt-4o-mini-transcribe` -> `whisper-1`

Implemented in:
- `consent-protocol/hushh_mcp/services/voice_intent_service.py`
- `consent-protocol/.env`
- `consent-protocol/.env.example`

### 2) Stronger typo/homophone navigation mapping
- Planner system prompt now explicitly handles imperfect STT for navigation phrases:
  - `go to / take me to / open / navigate to`
  - consent-like misspellings/homophones
- Added alias normalization for common STT mistakes:
  - `consesns`, `concent`, `profiel`, `dashbord`, etc.

Implemented in:
- `consent-protocol/hushh_mcp/services/voice_intent_service.py`

### 3) Planner context compaction
- Backend now compacts context to a strict small whitelist and trims string length.
- Reduced planner `max_tokens` from `120` to `80`.

Implemented in:
- `consent-protocol/hushh_mcp/services/voice_intent_service.py`
- `hushh-webapp/components/kai/kai-command-bar-global.tsx` (leaner context)

### 4) Granular timing and model telemetry
- Backend responses now include:
  - `elapsed_ms`, `openai_http_ms`, and `model`
- Frontend logs now include stage-level timing and model used:
  - `VOICE_AUDIO_TIMING`
  - `VOICE_STT_TIMING model=...`
  - `VOICE_PLAN_TIMING model=...`
  - `VOICE_E2E_TIMING`

Implemented in:
- `consent-protocol/api/routes/kai/voice.py`
- `hushh-webapp/components/kai/kai-search-bar.tsx`

### 5) Optional direct backend voice transport (web)
- Added optional bypass of Next.js proxy for voice endpoints to reduce proxy overhead:
  - `NEXT_PUBLIC_VOICE_DIRECT_BACKEND=true`
- Uses `NEXT_PUBLIC_BACKEND_URL` directly for voice routes only.

Implemented in:
- `hushh-webapp/lib/services/api-service.ts`
- `hushh-webapp/.env.example`

## Benchmark Evidence (raw OpenAI, local run)
Command:
```bash
cd consent-protocol
python scripts/voice_latency_probe.py --transcript "take me to profile" --runs 2
```

Result sample:
- `gpt-4.1-nano`: `1111ms`, `690ms`
- `gpt-4o-mini`: `1239ms`, `1971ms`
- `gpt-4.1-mini`: `2251ms`, `716ms`

Interpretation:
- `gpt-4.1-nano` is generally fastest in this sample.
- Large variance exists across runs; backend contention remains a major factor.

## Current Recommended Runtime Config

### `consent-protocol/.env`
```env
OPENAI_VOICE_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_VOICE_STT_MODELS=gpt-4o-mini-transcribe,whisper-1
OPENAI_VOICE_INTENT_MODEL=gpt-4.1-nano
OPENAI_VOICE_INTENT_MODELS=gpt-4.1-nano,gpt-4o-mini,gpt-4.1-mini
```

### `hushh-webapp/.env.local` (optional)
```env
NEXT_PUBLIC_VOICE_DIRECT_BACKEND=true
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

## Remaining Bottleneck Risk
- Voice still requires two sequential AI calls.
- If backend is saturated by heavy analytics/market requests, voice latency will spike.
- World-model/market-related timeouts are orthogonal to voice correctness but can degrade overall responsiveness.

## Suggested Next Improvements (not yet implemented)
1. Add single backend endpoint `voice/understand` that performs STT + plan server-side and returns one payload.
2. Add QoS/priority lane for voice routes in backend worker pool.
3. Reduce/deferr heavy dashboard/profile data fetches while voice processing is active.
4. Add rolling percentile telemetry dashboard:
   - STT p50/p95
   - Plan p50/p95
   - E2E p50/p95
5. Add cache warm-up and tighter timeout budgets for non-voice endpoints to reduce contention.

## Validation Checklist for Reviewer
1. Confirm `VOICE_PLAN_TIMING model=gpt-4.1-nano` appears in browser logs.
2. Confirm voice commands still route via existing executor (`execute_kai_command` log path).
3. Confirm typo navigation works:
   - "take me to consesns"
   - "go to analysis bar"
4. Confirm no regression in analyze flow (`analyze <symbol>`).
5. Compare latency with and without `NEXT_PUBLIC_VOICE_DIRECT_BACKEND=true`.
