#!/usr/bin/env python3
"""Dump SEC companyfacts payloads for one or more tickers.

Usage:
  python scripts/dump_sec_payloads.py
  python scripts/dump_sec_payloads.py --tickers AAPL,MSFT,NVDA
  python scripts/dump_sec_payloads.py --ticker AAPL --ticker NVDA
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

import httpx

DEFAULT_TICKERS = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOGL",
    "META",
    "TSLA",
    "JPM",
    "V",
    "XOM",
]

HEADERS = {
    "User-Agent": "Hushh-Research/1.0 (eng@hush1one.com)",
    "Accept": "application/json",
}


def _parse_tickers(args: argparse.Namespace) -> list[str]:
    from_csv: list[str] = []
    if args.tickers:
        for token in str(args.tickers).split(","):
            cleaned = token.strip().upper()
            if cleaned:
                from_csv.append(cleaned)
    from_multi = [str(t).strip().upper() for t in (args.ticker or []) if str(t).strip()]
    merged = from_csv + from_multi
    if not merged:
        merged = DEFAULT_TICKERS
    deduped: list[str] = []
    seen: set[str] = set()
    for ticker in merged:
        if ticker in seen:
            continue
        seen.add(ticker)
        deduped.append(ticker)
    return deduped


async def _fetch_ticker_mapping(client: httpx.AsyncClient) -> dict[str, str]:
    response = await client.get("https://www.sec.gov/files/company_tickers.json")
    response.raise_for_status()
    data = response.json() or {}
    mapping: dict[str, str] = {}
    for row in data.values():
        ticker = str(row.get("ticker") or "").upper().strip()
        cik = str(row.get("cik_str") or "").strip()
        if not ticker or not cik:
            continue
        mapping[ticker] = cik.zfill(10)
    return mapping


async def _dump_one_ticker(
    client: httpx.AsyncClient,
    ticker: str,
    cik_map: dict[str, str],
    out_dir: Path,
) -> dict[str, Any]:
    cik = cik_map.get(ticker)
    if not cik:
        return {"ticker": ticker, "ok": False, "error": "cik_not_found"}

    facts_url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    try:
        response = await client.get(facts_url, timeout=25.0)
        response.raise_for_status()
        payload = response.json() or {}
    except Exception as exc:
        return {"ticker": ticker, "ok": False, "error": str(exc), "cik": cik}

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"sec_payload_{ticker.lower()}.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    return {
        "ticker": ticker,
        "ok": True,
        "cik": cik,
        "path": str(out_path),
        "entity_name": payload.get("entityName"),
    }


async def _run(tickers: list[str], out_dir: Path, concurrency: int) -> dict[str, Any]:
    timeout = httpx.Timeout(connect=6.0, read=30.0, write=15.0, pool=6.0)
    async with httpx.AsyncClient(headers=HEADERS, timeout=timeout) as client:
        cik_map = await _fetch_ticker_mapping(client)
        semaphore = asyncio.Semaphore(max(1, concurrency))

        async def _bounded(ticker: str) -> dict[str, Any]:
            async with semaphore:
                return await _dump_one_ticker(client, ticker, cik_map, out_dir)

        results = await asyncio.gather(*(_bounded(ticker) for ticker in tickers))

    ok = [row for row in results if row.get("ok")]
    failed = [row for row in results if not row.get("ok")]

    manifest = {
        "tickers_requested": tickers,
        "tickers_successful": [row["ticker"] for row in ok],
        "success_count": len(ok),
        "failure_count": len(failed),
        "results": results,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch SEC companyfacts payloads for tickers")
    parser.add_argument("--tickers", help="Comma-separated tickers")
    parser.add_argument("--ticker", action="append", help="Repeatable ticker value")
    parser.add_argument(
        "--out-dir",
        default="data/sec_payloads",
        help="Output directory for SEC payload JSON files",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Concurrent SEC requests (default: 4)",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    out_dir = (repo_root / args.out_dir).resolve()
    tickers = _parse_tickers(args)
    manifest = asyncio.run(_run(tickers, out_dir, args.concurrency))
    print(json.dumps(manifest, indent=2))
    return 0 if manifest.get("failure_count", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
