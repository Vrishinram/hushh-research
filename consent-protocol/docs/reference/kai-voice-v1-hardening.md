# Kai Voice V1 Hardening + Rollout Guide

## Scope
V1 is a deterministic chained pipeline:

`STT (OpenAI, English only) -> planner/tool orchestration -> VoiceResponse -> TTS`

No destructive actions are exposed in voice for V1.

## Runtime Contract
`AppRuntimeState` is required for execution-quality planning and contention checks.

- `auth.signed_in` and `auth.user_id` gate voice usage.
- `vault.unlocked`, `vault.token_available`, `vault.token_valid` must all be `true`.
- `runtime.analysis_*` and `runtime.import_*` drive already-running behavior.
- `voice.available` must be `true`; planner fails closed when runtime fields are incomplete for execution-sensitive flows.

If auth/vault gates fail, backend returns `kind=blocked` and never executes tools.

## Response Contract
Allowed response kinds:

- `blocked`
- `clarify`
- `already_running`
- `execute`
- `background_started`
- `speak_only`

Every response includes `message` and `speak=true` so TTS can start.

## Tool Taxonomy and Safety
Tool whitelist:

- `execute_kai_command`
- `navigate_back`
- `resume_active_analysis`
- `cancel_active_analysis`
- `clarify`

Allowed `execute_kai_command.command`:

- `analyze`, `optimize`, `consent`, `profile`, `history`, `dashboard`, `home`

Non-goals for V1:

- delete-account
- delete-imported-data
- irreversible bulk mutations

`cancel_active_analysis` is explicitly allowed as non-destructive task control.

## Error Copy Catalog
Required unclear STT sentence:

- `I couldn’t understand what you said, please repeat.`

Other fixed V1 copy:

- blocked auth: `Sign in to use voice.`
- blocked vault: `Unlock your vault to use voice.`
- rollout disabled: `Voice is not enabled for this account yet.`
- kill switch speak-only fallback: `Voice actions are temporarily unavailable. I can still respond and guide you.`
- timeout fallback (frontend): `I couldn’t complete that request, please try again.`

## Memory Write Policy
Durable memory hint by response kind:

- `blocked` -> `allow_durable_write=false`
- `clarify` with `stt_unusable|ticker_ambiguous|ticker_unknown` -> `allow_durable_write=false`
- `already_running` -> `allow_durable_write=true`
- `execute` -> `allow_durable_write=true`
- `background_started` -> `allow_durable_write=true`
- `speak_only` -> `allow_durable_write=true` (except rollout/kill-switch paths where backend forces false)

Frontend short-term memory:

- write on `execute`, `already_running`, `background_started`, and non-`stt_unusable` clarifies
- do not write on `blocked` or `stt_unusable`
- stop-speaking does not mutate memory

## UI Availability Rules
- Voice only usable when signed-in + vault unlocked + token valid.
- Vault screens:
  - mic visible
  - disabled with reason when unavailable
- Non-vault screens:
  - mic hidden when unavailable
- Push-to-talk is the only input mode in V1.
- Stop-speaking button appears only while AI audio is playing.
- Stop-speaking stops playback only; no backend task cancellation and no memory reset.

## Observability Contract
Correlation:

- `X-Voice-Turn-Id` generated client-side and propagated through proxy/backend.
- backend echoes `X-Voice-Turn-Id` response header.

Structured telemetry events (no transcript content):

- `stt_latency_ms`
- `planner_latency_ms`
- `response_kind_count`
- `unclear_stt_rate`
- `ambiguous_ticker_rate`
- `already_running_rate`
- `tts_latency_ms` (backend)
- `tts_start_success_rate` (frontend)
- `tts_stop_button_usage` (frontend)

Audit log:

- decision kind, reason, task, tool name, ticker/run metadata, rollout metadata, kill-switch status.

Sensitive data policy:

- no raw transcript in logs
- log `transcript_chars` only
- user identifiers logged as hashed `user_ref`

## Rollout Guardrails
Environment flags:

- `KAI_VOICE_V1_ENABLED`
- `KAI_VOICE_V1_ALLOWED_USERS`
- `KAI_VOICE_V1_CANARY_PERCENT`
- `KAI_VOICE_V1_DISABLE_TOOL_EXECUTION`

Rollout strategy:

1. Enable in staging with allowlist only.
2. Production canary at small percentage.
3. Increase canary only if telemetry remains within thresholds.
4. Remove canary constraints for full rollout.

Kill switch behavior:

- if `KAI_VOICE_V1_DISABLE_TOOL_EXECUTION=true`, backend downgrades `execute` to `speak_only`.
- user still receives spoken response; no tool execution occurs.

## Suggested Canary Thresholds
Use rolling 30-minute and 24-hour windows:

- `unclear_stt_rate <= 0.20`
- `ambiguous_ticker_rate <= 0.15`
- `tts_start_success_rate >= 0.97`
- p95 `stt_latency_ms <= 3000`
- p95 `planner_latency_ms <= 2500`
- unexpected `blocked` spikes investigated before increasing cohort

## Go / No-Go Checklist
Go:

- all voice contract and guardrail tests pass
- no destructive mappings in tool whitelist tests
- kill switch test passes (execute downgraded)
- correlation id present across STT/plan/TTS
- telemetry pipeline receiving required metrics

No-go:

- any test allows destructive mapping
- unclear sentence contract regresses
- stop-speaking cancels backend tasks
- missing telemetry/correlation in production logs
