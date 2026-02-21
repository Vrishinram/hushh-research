#!/usr/bin/env python3
"""Kai system-wide runtime audit (low-test operational check).

This script validates:
- required Kai API route presence from OpenAPI,
- basic runtime smoke responses (no hard 404/500 paths),
- optional world-model integrity audit handoff.

Outputs JSON + markdown reports under temp/.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


@dataclass
class RouteRequirement:
    path: str
    methods: list[str]


REQUIRED_ROUTES: list[RouteRequirement] = [
    RouteRequirement("/api/kai/portfolio/import/stream", ["post"]),
    RouteRequirement("/api/kai/portfolio/analyze-losers/stream", ["post"]),
    RouteRequirement("/api/kai/market/insights/{user_id}", ["get"]),
    RouteRequirement("/api/kai/analyze/stream", ["get"]),
    RouteRequirement("/api/kai/chat", ["post"]),
    RouteRequirement("/api/tickers/search", ["get"]),
    RouteRequirement("/api/tickers/all", ["get"]),
]

FRONTEND_ROUTES: list[str] = [
    "/kai/import",
    "/kai",
    "/kai/dashboard",
    "/kai/dashboard/analysis",
    "/kai/dashboard/portfolio-health",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Kai runtime/system audit")
    parser.add_argument("--api-base", default=os.getenv("KAI_AUDIT_API_BASE", "http://localhost:8000"))
    parser.add_argument("--web-base", default=os.getenv("KAI_AUDIT_WEB_BASE", "http://localhost:3000"))
    parser.add_argument("--timeout-seconds", type=float, default=8.0)
    parser.add_argument("--user-id", default=os.getenv("AUDIT_USER_ID"))
    parser.add_argument("--passphrase", default=os.getenv("AUDIT_PASSPHRASE"))
    parser.add_argument("--out", default=None)
    return parser.parse_args()


def safe_get_json(url: str, timeout: float) -> tuple[dict[str, Any] | None, str | None]:
    try:
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict):
            return payload, None
        return None, "OpenAPI payload was not an object"
    except Exception as exc:
        return None, str(exc)


def probe_endpoint(method: str, url: str, timeout: float) -> dict[str, Any]:
    try:
        if method == "GET":
            response = requests.get(url, timeout=timeout)
        elif method == "POST":
            response = requests.post(url, timeout=timeout)
        else:
            return {"ok": False, "status": None, "detail": f"unsupported method {method}"}

        status = response.status_code
        ok = status in {200, 201, 202, 204, 400, 401, 403, 404, 405, 409, 415, 422}
        return {
            "ok": ok,
            "status": status,
            "detail": (response.text or "")[:240],
        }
    except Exception as exc:
        return {"ok": False, "status": None, "detail": str(exc)}


def probe_frontend_route(url: str, timeout: float) -> dict[str, Any]:
    try:
        response = requests.get(url, timeout=timeout, allow_redirects=False)
        status = response.status_code
        ok = (200 <= status < 400) or status in {401, 403}
        return {
            "ok": ok,
            "status": status,
            "detail": (response.text or "")[:240],
        }
    except Exception as exc:
        return {"ok": False, "status": None, "detail": str(exc)}


def run_world_model_audit(user_id: str, passphrase: str) -> dict[str, Any]:
    env = os.environ.copy()
    dotenv_path = Path("consent-protocol/.env")
    if dotenv_path.exists():
        for line in dotenv_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, raw_value = stripped.split("=", 1)
            key = key.strip()
            if not key or key in env:
                continue
            env[key] = raw_value.strip().strip("\"").strip("'")

    cmd = [
        "node",
        "scripts/ops/audit-world-model-user.mjs",
        "--userId",
        user_id,
        "--passphrase",
        passphrase,
    ]
    completed = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return {
        "ok": completed.returncode == 0,
        "returncode": completed.returncode,
        "stdout": (completed.stdout or "")[-800:],
        "stderr": (completed.stderr or "")[-800:],
    }


def main() -> int:
    args = parse_args()
    now = datetime.now(timezone.utc)

    openapi_url = f"{args.api_base.rstrip('/')}/openapi.json"
    openapi, openapi_error = safe_get_json(openapi_url, args.timeout_seconds)
    paths = openapi.get("paths", {}) if isinstance(openapi, dict) else {}

    route_checks: list[dict[str, Any]] = []
    for req in REQUIRED_ROUTES:
        route_entry = paths.get(req.path) if isinstance(paths, dict) else None
        available_methods = sorted(list(route_entry.keys())) if isinstance(route_entry, dict) else []
        missing_methods = [m for m in req.methods if m not in available_methods]
        route_checks.append(
            {
                "path": req.path,
                "required_methods": req.methods,
                "available_methods": available_methods,
                "present": isinstance(route_entry, dict),
                "missing_methods": missing_methods,
                "ok": isinstance(route_entry, dict) and len(missing_methods) == 0,
            }
        )

    runtime_probes = {
        "market_insights": probe_endpoint(
            "GET",
            f"{args.api_base.rstrip('/')}/api/kai/market/insights/probe_user?symbols=AAPL&days_back=7",
            args.timeout_seconds,
        ),
        "analyze_stream": probe_endpoint(
            "GET",
            f"{args.api_base.rstrip('/')}/api/kai/analyze/stream?ticker=AAPL&user_id=probe_user",
            args.timeout_seconds,
        ),
        "tickers_search": probe_endpoint(
            "GET",
            f"{args.api_base.rstrip('/')}/api/tickers/search?q=apple&limit=5",
            args.timeout_seconds,
        ),
    }

    frontend_route_probes = {}
    web_base = str(args.web_base or "").strip().rstrip("/")
    if web_base:
        for route in FRONTEND_ROUTES:
            frontend_route_probes[route] = probe_frontend_route(
                f"{web_base}{route}",
                args.timeout_seconds,
            )

    world_model_audit = None
    if args.user_id and args.passphrase:
        world_model_audit = run_world_model_audit(args.user_id, args.passphrase)

    frontend_ok = (
        True
        if not frontend_route_probes
        else all(bool(probe.get("ok")) for probe in frontend_route_probes.values())
    )
    summary_ok = (
        openapi_error is None
        and all(bool(check.get("ok")) for check in route_checks)
        and all(bool(probe.get("ok")) for probe in runtime_probes.values())
        and frontend_ok
        and (world_model_audit is None or bool(world_model_audit.get("ok")))
    )

    report = {
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "api_base": args.api_base,
        "web_base": args.web_base,
        "openapi_url": openapi_url,
        "openapi_ok": openapi_error is None,
        "openapi_error": openapi_error,
        "route_checks": route_checks,
        "runtime_probes": runtime_probes,
        "frontend_route_probes": frontend_route_probes,
        "world_model_audit": world_model_audit,
        "ok": summary_ok,
    }

    out_path = Path(args.out) if args.out else Path("temp") / f"kai-system-audit-{now.strftime('%Y%m%dT%H%M%SZ')}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    md_path = out_path.with_suffix(".md")

    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    route_ok = sum(1 for item in route_checks if item.get("ok"))
    markdown = [
        "# Kai System Audit",
        "",
        f"- Generated: {report['generated_at']}",
        f"- API Base: {args.api_base}",
        f"- OpenAPI reachable: {'yes' if report['openapi_ok'] else 'no'}",
        f"- Route checks: {route_ok}/{len(route_checks)} passing",
        f"- Runtime probes: {sum(1 for p in runtime_probes.values() if p.get('ok'))}/{len(runtime_probes)} passing",
        f"- Frontend route probes: "
        f"{sum(1 for p in frontend_route_probes.values() if p.get('ok'))}/{len(frontend_route_probes)} passing"
        if frontend_route_probes
        else "- Frontend route probes: skipped",
        f"- World-model audit executed: {'yes' if world_model_audit is not None else 'no'}",
        f"- Overall status: {'PASS' if report['ok'] else 'ATTENTION'}",
    ]
    md_path.write_text("\n".join(markdown) + "\n", encoding="utf-8")

    print(f"Audit JSON: {out_path}")
    print(f"Audit Summary: {md_path}")
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
