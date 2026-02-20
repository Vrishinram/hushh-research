#!/usr/bin/env bash
set -euo pipefail

REPO="${CONSENT_UPSTREAM_REPO:-hushh-labs/consent-protocol}"
WORKFLOW="${CONSENT_UPSTREAM_WORKFLOW:-Consent Protocol CI}"
BRANCH="${CONSENT_UPSTREAM_BRANCH:-main}"
TIMEOUT_SECONDS="${CONSENT_UPSTREAM_CI_TIMEOUT_SECONDS:-1200}"
POLL_SECONDS="${CONSENT_UPSTREAM_CI_POLL_SECONDS:-10}"
TARGET_SHA="${1:-}"

if [ -z "$TARGET_SHA" ]; then
  TARGET_SHA="$(git rev-parse consent-upstream/main 2>/dev/null || true)"
fi

if [ -z "$TARGET_SHA" ]; then
  echo "❌ Could not resolve target SHA for upstream CI verification."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "❌ GitHub CLI (gh) is required for upstream CI verification."
  exit 1
fi

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "❌ python3 (or python) is required to parse GitHub CLI JSON output."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "❌ GitHub CLI is not authenticated. Run: gh auth login"
  exit 1
fi

echo "Waiting for upstream workflow '$WORKFLOW' on $REPO (sha=$TARGET_SHA)..."

deadline=$((SECONDS + TIMEOUT_SECONDS))
run_id=""
run_url=""

find_run_for_sha() {
  gh run list \
    --repo "$REPO" \
    --workflow "$WORKFLOW" \
    --branch "$BRANCH" \
    --limit 40 \
    --json databaseId,headSha,url,createdAt \
    --jq ".[] | select(.headSha == \"$TARGET_SHA\") | [.databaseId, .url] | @tsv" \
    | head -n 1
}

while [ "$SECONDS" -lt "$deadline" ]; do
  candidate="$(find_run_for_sha || true)"
  if [ -n "$candidate" ]; then
    run_id="$(printf '%s' "$candidate" | awk '{print $1}')"
    run_url="$(printf '%s' "$candidate" | awk '{print $2}')"
    break
  fi
  sleep "$POLL_SECONDS"
done

if [ -z "$run_id" ]; then
  echo "❌ Timed out waiting for upstream workflow run to appear for sha=$TARGET_SHA"
  exit 1
fi

echo "Found upstream run: $run_id"
echo "Run URL: $run_url"

set +e
gh run watch "$run_id" --repo "$REPO" --interval "$POLL_SECONDS" --exit-status
watch_exit=$?
set -e

summary="$(gh run view "$run_id" --repo "$REPO" --json status,conclusion,jobs,url)"
status="$(printf '%s' "$summary" | "$PYTHON_BIN" -c 'import json,sys; print((json.load(sys.stdin).get("status") or "").strip())')"
conclusion="$(printf '%s' "$summary" | "$PYTHON_BIN" -c 'import json,sys; print((json.load(sys.stdin).get("conclusion") or "").strip())')"
url="$(printf '%s' "$summary" | "$PYTHON_BIN" -c 'import json,sys; print((json.load(sys.stdin).get("url") or "").strip())')"

if [ "$status" = "completed" ] && [ "$conclusion" = "success" ] && [ "$watch_exit" -eq 0 ]; then
  echo "✅ Upstream backend CI passed for $TARGET_SHA"
  exit 0
fi

echo "❌ Upstream backend CI failed for $TARGET_SHA (status=$status conclusion=$conclusion)"
echo "Run URL: $url"
echo "Failed jobs:"
printf '%s' "$summary" | "$PYTHON_BIN" -c '
import json,sys
jobs=(json.load(sys.stdin).get("jobs") or [])
for job in jobs:
    c=(job.get("conclusion") or "").strip()
    if c and c != "success":
        print("- {}: {}".format(job.get("name"), c))
'
exit 1
