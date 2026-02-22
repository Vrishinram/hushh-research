# Env/Secrets Cutover Audit - 2026-02-22

## Scope
- Backend: `consent-protocol`
- Frontend: `hushh-webapp`
- Project: `hushh-pda`
- Region: `us-central1`

## Trigger
Hard-cutover reconciliation to remove env/secret drift between:
- local env templates (`.env.example`),
- deployment manifests (`deploy/*.cloudbuild.yaml`),
- Secret Manager inventory,
- live Cloud Run revision env refs.

## Pre-cutover snapshots
Saved locally (not committed) for rollback preparation:
- `/tmp/hushh-cutover-snapshots/consent-protocol-before.json`
- `/tmp/hushh-cutover-snapshots/hushh-webapp-before.json`
- `/tmp/hushh-cutover-snapshots/secrets-before.json`
- `/tmp/hushh-cutover-snapshots/parity-before.json`

## Drift confirmed before cutover
- Live backend revision referenced legacy/non-existent secret refs:
  - `APP_REVIEW_MODE` (missing in Secret Manager at that moment)
  - `REVIEWER_EMAIL` (legacy)
  - `REVIEWER_PASSWORD` (legacy)

## Cutover actions
1. Created/seeded missing secret:
   - `APP_REVIEW_MODE` version `1` with value `false`.
2. Updated backend deployment contract:
   - moved `APP_REVIEW_MODE` to `--set-secrets`.
   - removed `APP_REVIEW_MODE` from `--set-env-vars`.
3. Redeployed backend from canonical manifest:
   - Cloud Build: `9365932c-eca0-4561-9a30-27d47b3e9851`
   - Result: `SUCCESS`
   - Active backend revision: `consent-protocol-00049-k2p`
4. Redeployed frontend from canonical manifest:
   - Cloud Build: `9ef8e713-67f5-463c-a5b3-8b3529e76945`
   - Result: `SUCCESS`
   - Active frontend revision: `hushh-webapp-00044-h95`

## Legacy secret deletion log
Deletion candidates reviewed:
- `REVIEWER_EMAIL`
- `REVIEWER_PASSWORD`

Decision:
- No deletion command executed because neither secret currently exists in Secret Manager (`NOT_FOUND`).
- Live references were removed by redeploying with corrected manifests.

## Post-cutover verification
- Parity audit command:

```bash
python3 scripts/ops/verify-env-secrets-parity.py \
  --project hushh-pda \
  --region us-central1 \
  --backend-service consent-protocol \
  --frontend-service hushh-webapp
```

- Result: `PASS`
- Post-cutover report:
  - `/tmp/hushh-cutover-snapshots/parity-after.json`

## Notes
- `NEXT_PUBLIC_API_URL` was removed from local `hushh-webapp/.env.local` as legacy drift cleanup.
- `api/app-config/review-mode` returns `{"enabled": false}` after cutover.
