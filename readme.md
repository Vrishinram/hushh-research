<p align="center">
  <img src="https://img.shields.io/badge/🤫_Hushh-Consent_First-blueviolet?style=for-the-badge" alt="Hushh"/>
</p>

<h1 align="center">Hushh Research</h1>

<p align="center">
  <strong>Consent-first personal data infrastructure</strong><br/>
  <em>Kai, IAM/RIA workflows, and the encrypted world-model data plane.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Protocol-v2.0-success?style=flat-square" alt="Protocol"/>
  <img src="https://img.shields.io/badge/Zero_Knowledge-Yes-green?style=flat-square" alt="Zero Knowledge"/>
  <img src="https://img.shields.io/badge/Consent_First-Enforced-orange?style=flat-square" alt="Consent First"/>
  <img src="https://img.shields.io/badge/Tri--Flow-Web%20%2B%20iOS%20%2B%20Android-1f6feb?style=flat-square" alt="Tri-Flow"/>
  <br/>
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js&logoColor=white" alt="Next.js"/>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React"/>
  <img src="https://img.shields.io/badge/Capacitor-8-1199EE?style=flat-square&logo=capacitor&logoColor=white" alt="Capacitor"/>
  <img src="https://img.shields.io/badge/FastAPI-Python-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI"/>
  <img src="https://img.shields.io/badge/PostgreSQL-Operational-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL"/>
  <a href="https://discord.gg/fd38enfsH5"><img src="https://img.shields.io/badge/Discord-Join%20Us-7289da?style=flat-square&logo=discord&logoColor=white" alt="Discord"/></a>
</p>

<p align="center">
  <a href="./docs/README.md">Docs</a> ·
  <a href="./docs/guides/getting-started.md">Getting Started</a> ·
  <a href="./consent-protocol/docs/README.md">Backend Docs</a> ·
  <a href="./hushh-webapp/docs/README.md">Frontend Docs</a> ·
  <a href="https://discord.gg/fd38enfsH5">Community</a>
</p>

Consent-first personal data infrastructure for Kai, IAM/RIA workflows, and the encrypted world-model data plane.

## What Is Hushh?

Hushh is a consent-first system where user-owned data stays encrypted and every meaningful access path is gated by explicit runtime consent.

```text
Traditional AI:  user -> platform -> platform-owned data
Hushh:           user -> encrypt -> vault/world-model -> token-gated access
```

Current repo scope centers on:

- Kai investor workflows
- IAM and RIA onboarding, marketplace, and relationship management
- consent issuance, approval, revocation, and audit
- encrypted world-model storage and retrieval across web, iOS, and Android

## Quick Overview

| Layer | Current Stack | Role |
| --- | --- | --- |
| Frontend | Next.js 16, React 19, Tailwind, Capacitor 8 | web and native client surfaces |
| Backend | FastAPI, Python 3.13 | consent, Kai, IAM/RIA, world-model APIs |
| Data Plane | PostgreSQL + encrypted blobs | operational state plus private user data boundary |
| Delivery Model | web + iOS + Android tri-flow | contract-aligned runtime paths |

## Quick Start

```bash
git clone https://github.com/hushh-labs/hushh-research.git
cd hushh-research
make setup
cd hushh-webapp && npm install
cd ../consent-protocol
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
bash scripts/env/bootstrap_profiles.sh
make local
```

## Canonical Documentation

This repository now follows a single-canonical-doc model:

- Repo-wide references live in [`docs/`](./docs/README.md)
- Backend and protocol references live in [`consent-protocol/docs/`](./consent-protocol/docs/README.md)
- Frontend and native-client references live in [`hushh-webapp/docs/`](./hushh-webapp/docs/README.md)

Root markdown files are entrypoints only. Detailed runtime, architecture, env, route, and test truth lives in those documentation homes.

## Start Here

If you are:

- setting up the repo: [`docs/guides/getting-started.md`](./docs/guides/getting-started.md)
- learning the system shape: [`docs/reference/architecture/architecture.md`](./docs/reference/architecture/architecture.md)
- checking API and route governance: [`docs/reference/architecture/api-contracts.md`](./docs/reference/architecture/api-contracts.md) and [`docs/reference/architecture/route-contracts.md`](./docs/reference/architecture/route-contracts.md)
- working on consent and world-model behavior: [`consent-protocol/docs/reference/consent-protocol.md`](./consent-protocol/docs/reference/consent-protocol.md) and [`consent-protocol/docs/reference/world-model.md`](./consent-protocol/docs/reference/world-model.md)
- working on frontend/native parity: [`hushh-webapp/docs/README.md`](./hushh-webapp/docs/README.md)

## Repository Scope

Active product/runtime surfaces in this repo:

- Kai investor workflows
- IAM and RIA onboarding, marketplace, and relationship management
- Consent token issuance, approval, revocation, and audit
- Encrypted world-model storage and context retrieval
- Web, iOS, and Android tri-flow delivery

Historical or speculative product framing should live under [`docs/vision/`](./docs/vision/README.md), not in operational entrypoints.

## Quick Orientation

```text
hushh-research/
  docs/                # Cross-cutting architecture, ops, quality, vision
  consent-protocol/    # FastAPI backend, consent protocol, MCP modules
  hushh-webapp/        # Next.js web app and Capacitor native clients
  scripts/             # Verification, CI, env/bootstrap, runtime helpers
```

## Local Workflow

Use the maintained setup guide instead of duplicating instructions here:

- repo setup and runtime profiles: [`docs/guides/getting-started.md`](./docs/guides/getting-started.md)
- env and secret contract: [`docs/reference/operations/env-and-secrets.md`](./docs/reference/operations/env-and-secrets.md)
- contribution workflow: [`contributing.md`](./contributing.md)
- testing and CI entrypoints: [`TESTING.md`](./TESTING.md)

## Community

- Discord: [discord.gg/fd38enfsH5](https://discord.gg/fd38enfsH5)
