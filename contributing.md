# Contributing to Hussh Research

The public contributor model is intentionally small. If you can run the flow below and understand the trust model, you have enough context to contribute:

```bash
./bin/hushh bootstrap
./bin/hushh terminal backend --mode local --reload
./bin/hushh web
```

Choose your lane: **app contributor** (use `./bin/hushh web`), **backend contributor** (use `./bin/hushh terminal backend`), or see [consent-protocol/README.md](./consent-protocol/README.md) for standalone backend work.

## The Product Contract

Hussh is built on four invariants: (1) Consent + scoped access, (2) BYOK (user holds the key), (3) Zero-knowledge (server stores ciphertext only), (4) Tri-flow (web, iOS, Android stay contract-aligned). See [docs/reference/architecture/architecture.md](./docs/reference/architecture/architecture.md).

## Contributor Contract

- Apache-2.0 licensed code only
- Every commit must be signed: `git commit -s`
- Python: use `uv` for `consent-protocol`
- Migrations: authoritative from `consent-protocol/db/migrations/` and `release_migration_manifest.json`

## Workflow & Verification

All work targets `main`. UAT deploys automatically from green SHA. Before pushing, run:

```bash
./bin/hushh codex pre-pr
./bin/hushh docs verify
```

## Commit & Signoff

```bash
git commit -s
```

If DCO check fails, amend:

```bash
git commit --amend --signoff --no-edit
git push --force-with-lease
```

Use `--force-with-lease` on your branch only.

## Reference & Operations

Start with [getting-started.md](./docs/guides/getting-started.md). For branch governance, naming, or maintainer workflows, see [docs/reference/operations/](./docs/reference/operations/).

Use **Hussh** in public product/docs language.
