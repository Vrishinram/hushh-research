#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
PROTOCOL_DIR="$REPO_ROOT/consent-protocol"

cd "$PROTOCOL_DIR"

python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install -r requirements-dev.txt

python -m ruff check .
python -m mypy --config-file pyproject.toml --ignore-missing-imports

if [ -d tests ] && [ -n "$(find tests -name 'test_*.py' -o -name '*_test.py' | head -1)" ]; then
  TESTING="true" \
  SECRET_KEY="${SECRET_KEY:-test_secret_key_for_ci_only_32chars_min}" \
  VAULT_ENCRYPTION_KEY="${VAULT_ENCRYPTION_KEY:-0000000000000000000000000000000000000000000000000000000000000000}" \
  python -m pytest tests/ -v --tb=short
else
  echo "⚠ No test files found, skipping"
fi

TESTING="true" \
SECRET_KEY="${SECRET_KEY:-test_secret_key_for_ci_only_32chars_min}" \
VAULT_ENCRYPTION_KEY="${VAULT_ENCRYPTION_KEY:-0000000000000000000000000000000000000000000000000000000000000000}" \
python scripts/run_kai_accuracy_suite.py --benchmark-limit 2 --no-fail-benchmark
