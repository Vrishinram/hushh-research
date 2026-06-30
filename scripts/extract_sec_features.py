#!/usr/bin/env python3
"""Normalize SEC companyfacts payloads into compact feature artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _load_payload(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _latest_10k_value(
    us_gaap: dict[str, Any],
    metric_names: list[str],
    *,
    units: tuple[str, ...] = ("USD",),
) -> float | None:
    for metric_name in metric_names:
        metric = us_gaap.get(metric_name)
        if not isinstance(metric, dict):
            continue
        units_block = metric.get("units")
        if not isinstance(units_block, dict):
            continue
        for unit in units:
            series = units_block.get(unit)
            if not isinstance(series, list):
                continue
            annual = [row for row in series if str(row.get("form") or "") == "10-K"]
            if not annual:
                continue
            latest = sorted(annual, key=lambda row: str(row.get("end") or ""), reverse=True)[0]
            value = latest.get("val")
            try:
                parsed = float(value)
            except Exception:
                continue
            return parsed
    return None


def _latest_10k_year(
    us_gaap: dict[str, Any],
    metric_names: list[str],
    *,
    units: tuple[str, ...] = ("USD",),
) -> int | None:
    for metric_name in metric_names:
        metric = us_gaap.get(metric_name)
        if not isinstance(metric, dict):
            continue
        units_block = metric.get("units")
        if not isinstance(units_block, dict):
            continue
        for unit in units:
            series = units_block.get(unit)
            if not isinstance(series, list):
                continue
            annual = [row for row in series if str(row.get("form") or "") == "10-K"]
            if not annual:
                continue
            latest = sorted(annual, key=lambda row: str(row.get("end") or ""), reverse=True)[0]
            fy = latest.get("fy")
            if fy is not None:
                try:
                    return int(fy)
                except Exception:
                    pass
            end = str(latest.get("end") or "")
            if len(end) >= 4 and end[:4].isdigit():
                return int(end[:4])
    return None


def _annual_trend(
    us_gaap: dict[str, Any],
    metric_names: list[str],
    *,
    units: tuple[str, ...] = ("USD",),
    years: int = 4,
) -> list[dict[str, Any]]:
    for metric_name in metric_names:
        metric = us_gaap.get(metric_name)
        if not isinstance(metric, dict):
            continue
        units_block = metric.get("units")
        if not isinstance(units_block, dict):
            continue
        for unit in units:
            series = units_block.get(unit)
            if not isinstance(series, list):
                continue
            annual = [row for row in series if str(row.get("form") or "") == "10-K"]
            if not annual:
                continue
            ordered = sorted(annual, key=lambda row: str(row.get("end") or ""), reverse=True)
            out: list[dict[str, Any]] = []
            seen_years: set[int] = set()
            for row in ordered:
                fy_raw = row.get("fy")
                year: int | None = None
                if fy_raw is not None:
                    try:
                        year = int(fy_raw)
                    except Exception:
                        year = None
                if year is None:
                    end = str(row.get("end") or "")
                    if len(end) >= 4 and end[:4].isdigit():
                        year = int(end[:4])
                if year is None or year in seen_years:
                    continue
                try:
                    value = float(row.get("val"))
                except Exception:
                    continue
                out.append({"year": year, "value": value})
                seen_years.add(year)
                if len(out) >= years:
                    break
            return list(reversed(out))
    return []


def _normalize_payload(path: Path) -> dict[str, Any]:
    payload = _load_payload(path)
    us_gaap = payload.get("facts", {}).get("us-gaap", {})
    if not isinstance(us_gaap, dict):
        us_gaap = {}

    revenue = _latest_10k_value(
        us_gaap,
        [
            "Revenues",
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "SalesRevenueNet",
        ],
    )
    net_income = _latest_10k_value(
        us_gaap,
        ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
    )
    assets = _latest_10k_value(us_gaap, ["Assets"])
    liabilities = _latest_10k_value(us_gaap, ["Liabilities"])
    operating_cash_flow = _latest_10k_value(us_gaap, ["NetCashProvidedByUsedInOperatingActivities"])
    capex = _latest_10k_value(
        us_gaap,
        ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    )
    equity = _latest_10k_value(
        us_gaap,
        [
            "StockholdersEquity",
            "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
        ],
    )
    shares_outstanding = _latest_10k_value(
        us_gaap,
        ["CommonStockSharesOutstanding"],
        units=("shares",),
    )

    free_cash_flow = None
    if operating_cash_flow is not None:
        free_cash_flow = operating_cash_flow - (capex or 0.0)

    debt_to_equity = None
    if liabilities is not None and equity not in (None, 0):
        debt_to_equity = liabilities / equity

    profit_margin = None
    if revenue not in (None, 0) and net_income is not None:
        profit_margin = net_income / revenue

    ticker = payload.get("tickers")
    if isinstance(ticker, list) and ticker:
        ticker_value = str(ticker[0]).upper()
    else:
        ticker_value = path.stem.replace("sec_payload_", "").upper()

    return {
        "ticker": ticker_value,
        "entity_name": payload.get("entityName"),
        "cik": str(payload.get("cik") or "").zfill(10) if payload.get("cik") else None,
        "latest_10k_year": _latest_10k_year(
            us_gaap,
            ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "Assets"],
        ),
        "fundamentals": {
            "revenue": revenue,
            "net_income": net_income,
            "assets": assets,
            "liabilities": liabilities,
            "equity": equity,
            "operating_cash_flow": operating_cash_flow,
            "capex": capex,
            "free_cash_flow": free_cash_flow,
            "shares_outstanding": shares_outstanding,
        },
        "ratios": {
            "debt_to_equity": debt_to_equity,
            "profit_margin": profit_margin,
        },
        "trends": {
            "revenue": _annual_trend(
                us_gaap,
                [
                    "Revenues",
                    "RevenueFromContractWithCustomerExcludingAssessedTax",
                    "SalesRevenueNet",
                ],
            ),
            "net_income": _annual_trend(
                us_gaap,
                ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
            ),
            "operating_cash_flow": _annual_trend(
                us_gaap, ["NetCashProvidedByUsedInOperatingActivities"]
            ),
        },
        "source": "SEC EDGAR companyfacts",
        "source_file": str(path),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize SEC payload files into compact features")
    parser.add_argument(
        "--in-dir",
        default="data/sec_payloads",
        help="Directory containing sec_payload_*.json files",
    )
    parser.add_argument(
        "--out-dir",
        default="data/sec_features",
        help="Directory to write sec_features_*.json files",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional max files to process",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    in_dir = (repo_root / args.in_dir).resolve()
    out_dir = (repo_root / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(in_dir.glob("sec_payload_*.json"))
    if args.limit and args.limit > 0:
        files = files[: args.limit]

    results: list[dict[str, Any]] = []
    for payload_path in files:
        try:
            normalized = _normalize_payload(payload_path)
            ticker = normalized.get("ticker") or payload_path.stem.replace("sec_payload_", "").upper()
            out_path = out_dir / f"sec_features_{str(ticker).lower()}.json"
            out_path.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
            results.append({"ticker": ticker, "ok": True, "path": str(out_path)})
        except Exception as exc:
            results.append({"ticker": payload_path.stem, "ok": False, "error": str(exc)})

    summary = {
        "processed": len(results),
        "success": sum(1 for row in results if row.get("ok")),
        "failed": sum(1 for row in results if not row.get("ok")),
        "results": results,
    }
    (out_dir / "manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
