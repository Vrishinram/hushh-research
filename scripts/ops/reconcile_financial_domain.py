#!/usr/bin/env python3
"""Reconcile financial domain holdings quality for one BYOK user.

Requires user passphrase to decrypt/re-encrypt world_model_data locally.
Default mode is dry-run; use --apply to persist updates.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ACTION_TOKENS = {
    "BUY",
    "SELL",
    "REINVEST",
    "DIVIDEND",
    "INTEREST",
    "TRANSFER",
    "WITHDRAWAL",
    "DEPOSIT",
}
CASH_IDENTIFIERS = {"CASH", "MMF", "SWEEP", "QACDS"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reconcile financial holdings in world model blob")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--passphrase", required=True)
    parser.add_argument("--apply", action="store_true", help="Persist cleaned blob/index changes")
    parser.add_argument("--out", default=None)
    return parser.parse_args()


def decode_bytes_compat(raw: Any) -> bytes:
    text = str(raw or "").strip()
    if not text:
        return b""
    if re.fullmatch(r"[0-9a-fA-F]+", text or "") and len(text) % 2 == 0:
        try:
            return bytes.fromhex(text)
        except Exception:
            pass
    normalized = text.replace("-", "+").replace("_", "/")
    while len(normalized) % 4:
        normalized += "="
    return base64.b64decode(normalized)


def encode_b64(data: bytes) -> str:
    return base64.b64encode(data).decode("utf-8")


def normalize_symbol(raw_symbol: Any, *, name: str, asset_type: str) -> str:
    symbol = re.sub(r"[^A-Za-z0-9.\-]", "", str(raw_symbol or "").strip().upper())
    if not symbol:
        return ""
    if symbol in ACTION_TOKENS:
        return ""
    if symbol in CASH_IDENTIFIERS:
        return "CASH"

    name_l = name.strip().lower()
    asset_l = asset_type.strip().lower()
    if (
        "cash" in name_l
        or "sweep" in name_l
        or "cash" in asset_l
        or "sweep" in asset_l
        or "money market" in asset_l
    ):
        return "CASH"
    return symbol


def clean_holdings(holdings: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], Counter[str], dict[str, Any]]:
    dropped: Counter[str] = Counter()
    transformed_cash = 0
    seen_before: set[str] = set()
    seen_after: set[str] = set()
    cleaned: list[dict[str, Any]] = []

    for row in holdings:
        if not isinstance(row, dict):
            dropped["non_object_row"] += 1
            continue

        name = str(
            row.get("name")
            or row.get("description")
            or row.get("security_name")
            or row.get("holding_name")
            or ""
        ).strip()
        asset_type = str(
            row.get("asset_type")
            or row.get("asset_class")
            or row.get("security_type")
            or row.get("type")
            or ""
        ).strip()
        raw_symbol = (
            row.get("symbol")
            or row.get("ticker")
            or row.get("symbol_cusip")
            or row.get("cusip")
            or row.get("security_id")
            or row.get("security")
            or ""
        )
        before_symbol = re.sub(r"[^A-Za-z0-9.\-]", "", str(raw_symbol).strip().upper())
        if before_symbol:
            seen_before.add(before_symbol)

        if before_symbol in ACTION_TOKENS:
            dropped["trade_action_token"] += 1
            continue

        symbol = normalize_symbol(raw_symbol, name=name, asset_type=asset_type)
        if not symbol:
            dropped["missing_symbol"] += 1
            continue

        if symbol == "CASH" and before_symbol and before_symbol != "CASH":
            transformed_cash += 1

        next_row = dict(row)
        next_row["symbol"] = symbol
        if symbol == "CASH":
            next_row.setdefault("asset_type", "cash_equivalent")
            next_row["tradable"] = False
            next_row["symbol_trust_tier"] = "cash_equivalent"
            next_row["symbol_trust_reason"] = "cash_equivalent"
        else:
            next_row.setdefault("symbol_trust_tier", "tradable_ticker")

        cleaned.append(next_row)
        seen_after.add(symbol)

    diagnostics = {
        "symbols_before": sorted(seen_before),
        "symbols_after": sorted(seen_after),
        "transformed_to_cash": transformed_cash,
    }
    return cleaned, dropped, diagnostics


def summary_count(summary: dict[str, Any] | None) -> int:
    if not isinstance(summary, dict):
        return 0
    for key in ("attribute_count", "holdings_count", "item_count"):
        value = summary.get(key)
        if isinstance(value, bool) or value is None:
            continue
        try:
            return max(0, int(float(str(value).strip())))
        except Exception:
            continue
    return 0


def recalc_total_attributes(domain_summaries: dict[str, Any]) -> int:
    total = 0
    for summary in (domain_summaries or {}).values():
        if isinstance(summary, dict):
            total += summary_count(summary)
    return total


def domain_defaults(domain_key: str) -> tuple[str, str, str, str]:
    label = domain_key.replace("_", " ").strip().title() or domain_key
    description = f"Auto-registered domain: {label}"
    return label, description, "Database", "#3b82f6"


def main() -> int:
    args = parse_args()
    now = datetime.now(timezone.utc)

    db_host = os.getenv("DB_HOST")
    db_port = os.getenv("DB_PORT", "5432")
    db_user = os.getenv("DB_USER")
    db_password = os.getenv("DB_PASSWORD")
    db_name = os.getenv("DB_NAME")

    missing = [
        key
        for key, value in {
            "DB_HOST": db_host,
            "DB_USER": db_user,
            "DB_PASSWORD": db_password,
            "DB_NAME": db_name,
        }.items()
        if not value
    ]
    if missing:
        raise SystemExit(f"Missing DB env vars: {', '.join(missing)}")

    conn = psycopg2.connect(
        host=db_host,
        port=db_port,
        user=db_user,
        password=db_password,
        dbname=db_name,
    )

    with conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT vault_key_hash, primary_method
                FROM vault_keys
                WHERE user_id = %s
                LIMIT 1
                """,
                (args.user_id,),
            )
            vault_row = cur.fetchone()
            if not vault_row:
                raise RuntimeError(f"No vault_keys row for user {args.user_id}")

            cur.execute(
                """
                SELECT encrypted_vault_key, salt, iv
                FROM vault_key_wrappers
                WHERE user_id = %s AND LOWER(method) = 'passphrase'
                LIMIT 1
                """,
                (args.user_id,),
            )
            wrapper_row = cur.fetchone()
            if not wrapper_row:
                raise RuntimeError("No passphrase wrapper found for this user")

            cur.execute(
                """
                SELECT encrypted_data_ciphertext, encrypted_data_iv, encrypted_data_tag, algorithm, data_version
                FROM world_model_data
                WHERE user_id = %s
                LIMIT 1
                """,
                (args.user_id,),
            )
            blob_row = cur.fetchone()
            if not blob_row:
                raise RuntimeError(f"No world_model_data row for user {args.user_id}")

            cur.execute(
                """
                SELECT domain_summaries, available_domains, total_attributes
                FROM world_model_index_v2
                WHERE user_id = %s
                LIMIT 1
                """,
                (args.user_id,),
            )
            index_row = cur.fetchone()

    expected_hash = str(vault_row[0] or "").strip().lower()
    encrypted_vault_key = decode_bytes_compat(wrapper_row[0])
    wrapper_salt = decode_bytes_compat(wrapper_row[1])
    wrapper_iv = decode_bytes_compat(wrapper_row[2])

    derived_key = hashlib.pbkdf2_hmac("sha256", args.passphrase.encode("utf-8"), wrapper_salt, 100000, dklen=32)
    if len(encrypted_vault_key) < 17:
        raise RuntimeError("Encrypted vault key payload is too short")
    wrapper_cipher = encrypted_vault_key[:-16]
    wrapper_tag = encrypted_vault_key[-16:]
    vault_key_raw = AESGCM(derived_key).decrypt(wrapper_iv, wrapper_cipher + wrapper_tag, None)
    vault_key_hex = vault_key_raw.hex()

    computed_hash = hashlib.sha256(vault_key_hex.encode("utf-8")).hexdigest()
    hash_ok = bool(expected_hash) and expected_hash == computed_hash

    enc_ciphertext = decode_bytes_compat(blob_row[0])
    enc_iv = decode_bytes_compat(blob_row[1])
    enc_tag = decode_bytes_compat(blob_row[2])
    algorithm = str(blob_row[3] or "aes-256-gcm")
    data_version = int(blob_row[4] or 1)

    decrypted = AESGCM(bytes.fromhex(vault_key_hex)).decrypt(enc_iv, enc_ciphertext + enc_tag, None)
    blob = json.loads(decrypted.decode("utf-8"))

    financial = blob.get("financial") if isinstance(blob, dict) else None
    if not isinstance(financial, dict):
        raise RuntimeError("Financial domain missing in blob")

    holdings_key = "holdings" if isinstance(financial.get("holdings"), list) else "detailed_holdings"
    source_holdings = financial.get(holdings_key)
    if not isinstance(source_holdings, list):
        source_holdings = []

    cleaned_holdings, dropped, symbol_diag = clean_holdings(source_holdings)
    changed = cleaned_holdings != source_holdings

    financial_updated = dict(financial)
    financial_updated[holdings_key] = cleaned_holdings
    if isinstance(financial_updated.get("holdings"), list) and holdings_key != "holdings":
        financial_updated["holdings"] = cleaned_holdings
    if isinstance(financial_updated.get("detailed_holdings"), list) and holdings_key != "detailed_holdings":
        financial_updated["detailed_holdings"] = cleaned_holdings
    if isinstance(financial_updated.get("kpis"), dict):
        financial_updated["kpis"] = dict(financial_updated["kpis"])
        financial_updated["kpis"]["holdings_count"] = len(cleaned_holdings)

    if isinstance(financial_updated.get("quality_report"), dict):
        quality = dict(financial_updated["quality_report"])
        quality["raw"] = len(source_holdings)
        quality["validated"] = len(cleaned_holdings)
        quality["aggregated"] = len(cleaned_holdings)
        quality["dropped"] = max(0, len(source_holdings) - len(cleaned_holdings))
        existing_dropped = quality.get("dropped_reasons")
        merged_dropped = Counter(existing_dropped if isinstance(existing_dropped, dict) else {})
        merged_dropped.update(dropped)
        quality["dropped_reasons"] = dict(merged_dropped)
        financial_updated["quality_report"] = quality

    new_blob = dict(blob)
    new_blob["financial"] = financial_updated

    index_domain_summaries: dict[str, Any] = {}
    available_domains: list[str] = []
    index_before_total = 0
    if index_row:
        idx_summaries = index_row[0]
        idx_domains = index_row[1]
        index_before_total = int(index_row[2] or 0)
        if isinstance(idx_summaries, dict):
            index_domain_summaries = dict(idx_summaries)
        if isinstance(idx_domains, list):
            available_domains = [str(x).strip().lower() for x in idx_domains if str(x).strip()]

    financial_summary = index_domain_summaries.get("financial") if isinstance(index_domain_summaries.get("financial"), dict) else {}
    financial_summary = dict(financial_summary)
    canonical_count = len(cleaned_holdings)
    financial_summary["attribute_count"] = canonical_count
    financial_summary["item_count"] = canonical_count
    financial_summary["holdings_count"] = canonical_count
    financial_summary["reconciled_at"] = now.isoformat().replace("+00:00", "Z")
    financial_summary["reconciled_by"] = "scripts/ops/reconcile_financial_domain.py"
    index_domain_summaries["financial"] = financial_summary

    domain_keys = sorted({*available_domains, *index_domain_summaries.keys()})
    total_attributes = recalc_total_attributes(index_domain_summaries)

    report = {
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "user_id": args.user_id,
        "apply_mode": bool(args.apply),
        "vault_key_hash_matches": hash_ok,
        "algorithm": algorithm,
        "data_version_before": data_version,
        "index_total_attributes_before": index_before_total,
        "index_total_attributes_after": total_attributes,
        "holdings_before": len(source_holdings),
        "holdings_after": len(cleaned_holdings),
        "changed": changed,
        "dropped_reasons": dict(dropped),
        "symbol_diagnostics": symbol_diag,
        "domain_registry_upserted": domain_keys,
    }

    if args.apply and changed:
        plaintext = json.dumps(new_blob, separators=(",", ":")).encode("utf-8")
        new_iv = os.urandom(12)
        encrypted = AESGCM(bytes.fromhex(vault_key_hex)).encrypt(new_iv, plaintext, None)
        new_ciphertext = encrypted[:-16]
        new_tag = encrypted[-16:]

        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE world_model_data
                    SET encrypted_data_ciphertext = %s,
                        encrypted_data_iv = %s,
                        encrypted_data_tag = %s,
                        algorithm = %s,
                        data_version = %s,
                        updated_at = NOW()
                    WHERE user_id = %s
                    """,
                    (
                        encode_b64(new_ciphertext),
                        encode_b64(new_iv),
                        encode_b64(new_tag),
                        "aes-256-gcm",
                        data_version + 1,
                        args.user_id,
                    ),
                )

                cur.execute(
                    """
                    UPDATE world_model_index_v2
                    SET domain_summaries = %s::jsonb,
                        available_domains = %s::text[],
                        total_attributes = %s,
                        updated_at = NOW()
                    WHERE user_id = %s
                    """,
                    (
                        json.dumps(index_domain_summaries),
                        domain_keys,
                        total_attributes,
                        args.user_id,
                    ),
                )

                for domain in domain_keys:
                    display_name, description, icon_name, color_hex = domain_defaults(domain)
                    cur.execute(
                        """
                        INSERT INTO domain_registry (
                            domain_key, display_name, description, icon_name, color_hex,
                            attribute_count, user_count, first_seen_at, last_updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, COALESCE((SELECT user_count FROM domain_registry WHERE domain_key = %s), 0), NOW(), NOW())
                        ON CONFLICT (domain_key)
                        DO UPDATE SET
                            display_name = COALESCE(domain_registry.display_name, EXCLUDED.display_name),
                            description = COALESCE(domain_registry.description, EXCLUDED.description),
                            icon_name = COALESCE(domain_registry.icon_name, EXCLUDED.icon_name),
                            color_hex = COALESCE(domain_registry.color_hex, EXCLUDED.color_hex),
                            attribute_count = GREATEST(domain_registry.attribute_count, EXCLUDED.attribute_count),
                            last_updated_at = NOW()
                        """,
                        (
                            domain,
                            display_name,
                            description,
                            icon_name,
                            color_hex,
                            int(summary_count(index_domain_summaries.get(domain) if isinstance(index_domain_summaries.get(domain), dict) else {})),
                            domain,
                        ),
                    )

        report["applied"] = True
        report["data_version_after"] = data_version + 1
    else:
        report["applied"] = False
        report["data_version_after"] = data_version

    out_path = Path(args.out) if args.out else Path("temp") / f"reconcile-financial-{args.user_id}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    md_path = out_path.with_suffix(".md")
    md_lines = [
        f"# Financial Reconciliation ({args.user_id})",
        "",
        f"- Generated: {report['generated_at']}",
        f"- Mode: {'apply' if args.apply else 'dry-run'}",
        f"- Vault hash match: {'yes' if hash_ok else 'no'}",
        f"- Holdings before/after: {report['holdings_before']} -> {report['holdings_after']}",
        f"- Changed: {'yes' if report['changed'] else 'no'}",
        f"- Applied: {'yes' if report['applied'] else 'no'}",
        f"- Dropped reasons: {report['dropped_reasons']}",
    ]
    md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")

    print(f"Reconcile JSON: {out_path}")
    print(f"Reconcile Summary: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
