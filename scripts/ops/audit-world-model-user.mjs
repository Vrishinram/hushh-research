#!/usr/bin/env node

import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
  console.error(
    "Usage: node scripts/ops/audit-world-model-user.mjs --userId <uid> --passphrase <passphrase> [--out <path>]"
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;
    out[key.slice(2)] = value;
    i += 1;
  }
  return out;
}

function normalizeBase64(input) {
  let normalized = String(input || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) normalized += "=";
  return normalized;
}

function isHexLike(value) {
  const text = String(value || "").trim();
  return text.length > 0 && text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text);
}

function decodeBytesCompat(value) {
  const raw = String(value || "").trim();
  if (!raw) return Buffer.alloc(0);
  if (isHexLike(raw) && !/[+/=_-]/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return Buffer.from(normalizeBase64(raw), "base64");
}

function decryptAesGcmCombined(encryptedCombined, key, iv) {
  if (encryptedCombined.length < 16) {
    throw new Error("Encrypted payload too short");
  }
  const ciphertext = encryptedCombined.subarray(0, encryptedCombined.length - 16);
  const tag = encryptedCombined.subarray(encryptedCombined.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function decryptAesGcmParts(ciphertext, key, iv, tag) {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function canonicalSummaryCount(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return 0;
  for (const key of ["attribute_count", "holdings_count", "item_count"]) {
    const value = summary[key];
    if (value === null || value === undefined || typeof value === "boolean") continue;
    const num = Number(value);
    if (Number.isFinite(num)) return Math.max(0, Math.trunc(num));
  }
  return 0;
}

function holdingsCountFromBlob(financialDomain) {
  if (!financialDomain || typeof financialDomain !== "object" || Array.isArray(financialDomain)) {
    return 0;
  }
  const holdings = Array.isArray(financialDomain.holdings)
    ? financialDomain.holdings
    : Array.isArray(financialDomain.detailed_holdings)
    ? financialDomain.detailed_holdings
    : [];
  return holdings.length;
}

const TRADE_ACTION_SYMBOLS = new Set([
  "BUY",
  "SELL",
  "REINVEST",
  "DIVIDEND",
  "INTEREST",
  "TRANSFER",
  "WITHDRAWAL",
  "DEPOSIT",
]);

function financialSymbolDiagnostics(financialDomain) {
  if (!financialDomain || typeof financialDomain !== "object" || Array.isArray(financialDomain)) {
    return {
      holdings_count: 0,
      unique_symbols: [],
      action_tokens: [],
      cash_sweep_identifiers: [],
      placeholder_symbols: [],
    };
  }

  const holdings = Array.isArray(financialDomain.holdings)
    ? financialDomain.holdings
    : Array.isArray(financialDomain.detailed_holdings)
    ? financialDomain.detailed_holdings
    : [];

  const symbols = [];
  for (const row of holdings) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const raw = row.symbol ?? row.ticker ?? row.symbol_cusip ?? row.cusip ?? row.security_id ?? row.security;
    const normalized = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.\-]/g, "");
    if (normalized) symbols.push(normalized);
  }

  const uniqueSymbols = Array.from(new Set(symbols)).sort();
  const actionTokens = uniqueSymbols.filter((symbol) => TRADE_ACTION_SYMBOLS.has(symbol));
  const cashSweepIdentifiers = uniqueSymbols.filter((symbol) => symbol === "QACDS");
  const placeholderSymbols = uniqueSymbols.filter((symbol) => symbol.startsWith("HOLDING_"));

  return {
    holdings_count: holdings.length,
    unique_symbols: uniqueSymbols.slice(0, 80),
    action_tokens: actionTokens,
    cash_sweep_identifiers: cashSweepIdentifiers,
    placeholder_symbols: placeholderSymbols,
  };
}

async function supabaseGetRows({ baseUrl, serviceKey, table, query }) {
  const url = `${baseUrl.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase query failed for ${table}: ${response.status} ${text.slice(0, 220)}`);
  }

  const json = await response.json();
  return Array.isArray(json) ? json : [];
}

function quoteSql(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function postgresGetRows({
  host,
  port,
  user,
  password,
  database,
  sql,
}) {
  const output = execFileSync(
    "psql",
    [
      "-h",
      host,
      "-p",
      String(port || "5432"),
      "-U",
      user,
      "-d",
      database,
      "-At",
      "-c",
      sql,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PGPASSWORD: password,
      },
    }
  )
    .trim()
    .replace(/\r?\n/g, "");
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [];
}

async function main() {
  const args = parseArgs(process.argv);

  const userId = args.userId || process.env.AUDIT_USER_ID;
  const passphrase = args.passphrase || process.env.AUDIT_PASSPHRASE;
  const outputPath = args.out || `temp/world-model-audit-${userId || "unknown"}.json`;

  if (!userId || !passphrase) {
    usage();
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const dbHost = process.env.DB_HOST;
  const dbPort = process.env.DB_PORT || "5432";
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME;

  let vaultHeaders = [];
  let vaultWrappers = [];
  let worldModelRows = [];
  let indexRows = [];
  let registryRows = [];
  let dataSource = "unknown";

  if (supabaseUrl && serviceKey) {
    const encodedUserId = encodeURIComponent(userId);
    [vaultHeaders, vaultWrappers, worldModelRows, indexRows, registryRows] = await Promise.all([
      supabaseGetRows({
        baseUrl: supabaseUrl,
        serviceKey,
        table: "vault_keys",
        query: `select=vault_key_hash,primary_method,recovery_encrypted_vault_key,recovery_salt,recovery_iv&user_id=eq.${encodedUserId}&limit=1`,
      }),
      supabaseGetRows({
        baseUrl: supabaseUrl,
        serviceKey,
        table: "vault_key_wrappers",
        query: `select=method,encrypted_vault_key,salt,iv&user_id=eq.${encodedUserId}`,
      }),
      supabaseGetRows({
        baseUrl: supabaseUrl,
        serviceKey,
        table: "world_model_data",
        query: `select=encrypted_data_ciphertext,encrypted_data_iv,encrypted_data_tag,algorithm,data_version,updated_at&user_id=eq.${encodedUserId}&limit=1`,
      }),
      supabaseGetRows({
        baseUrl: supabaseUrl,
        serviceKey,
        table: "world_model_index_v2",
        query: `select=available_domains,domain_summaries,total_attributes,updated_at&user_id=eq.${encodedUserId}&limit=1`,
      }),
      supabaseGetRows({
        baseUrl: supabaseUrl,
        serviceKey,
        table: "domain_registry",
        query: "select=domain_key",
      }),
    ]);
    dataSource = "supabase_rest";
  } else if (dbHost && dbUser && dbPassword && dbName) {
    const userSql = quoteSql(userId);
    vaultHeaders = postgresGetRows({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      sql: `select coalesce(json_agg(t), '[]'::json)::text from (
        select vault_key_hash, primary_method, recovery_encrypted_vault_key, recovery_salt, recovery_iv
        from vault_keys where user_id = ${userSql}
        limit 1
      ) t;`,
    });
    vaultWrappers = postgresGetRows({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      sql: `select coalesce(json_agg(t), '[]'::json)::text from (
        select method, encrypted_vault_key, salt, iv
        from vault_key_wrappers where user_id = ${userSql}
      ) t;`,
    });
    worldModelRows = postgresGetRows({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      sql: `select coalesce(json_agg(t), '[]'::json)::text from (
        select encrypted_data_ciphertext, encrypted_data_iv, encrypted_data_tag, algorithm, data_version, updated_at
        from world_model_data where user_id = ${userSql}
        limit 1
      ) t;`,
    });
    indexRows = postgresGetRows({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      sql: `select coalesce(json_agg(t), '[]'::json)::text from (
        select available_domains, domain_summaries, total_attributes, updated_at
        from world_model_index_v2 where user_id = ${userSql}
        limit 1
      ) t;`,
    });
    registryRows = postgresGetRows({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      sql: `select coalesce(json_agg(t), '[]'::json)::text from (
        select domain_key from domain_registry
      ) t;`,
    });
    dataSource = "postgres_direct";
  } else {
    console.error(
      "Missing credentials. Provide SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME."
    );
    process.exit(1);
  }

  if (vaultHeaders.length === 0 || vaultWrappers.length === 0) {
    throw new Error(`No vault wrapper state found for user ${userId}`);
  }
  if (worldModelRows.length === 0) {
    throw new Error(`No world_model_data row found for user ${userId}`);
  }

  const passphraseWrapper = vaultWrappers.find(
    (row) => String(row.method || "").trim().toLowerCase() === "passphrase"
  );

  if (!passphraseWrapper) {
    throw new Error("Passphrase wrapper not found for user; cannot derive vault key with passphrase");
  }

  const derivedKey = pbkdf2Sync(
    passphrase,
    decodeBytesCompat(passphraseWrapper.salt),
    100000,
    32,
    "sha256"
  );

  const vaultKeyRaw = decryptAesGcmCombined(
    decodeBytesCompat(passphraseWrapper.encrypted_vault_key),
    derivedKey,
    decodeBytesCompat(passphraseWrapper.iv)
  );
  const vaultKeyHex = Buffer.from(vaultKeyRaw).toString("hex");

  const expectedVaultHash = String(vaultHeaders[0].vault_key_hash || "").trim().toLowerCase();
  const computedVaultHash = createHash("sha256").update(vaultKeyHex, "utf8").digest("hex");

  const wm = worldModelRows[0];
  const blobJsonRaw = decryptAesGcmParts(
    decodeBytesCompat(wm.encrypted_data_ciphertext),
    decodeBytesCompat(vaultKeyHex),
    decodeBytesCompat(wm.encrypted_data_iv),
    decodeBytesCompat(wm.encrypted_data_tag)
  ).toString("utf8");

  const decryptedBlob = JSON.parse(blobJsonRaw);
  const blobDomains = Object.keys(
    decryptedBlob && typeof decryptedBlob === "object" && !Array.isArray(decryptedBlob)
      ? decryptedBlob
      : {}
  ).sort();

  const index = indexRows[0] || {};
  const availableDomains = Array.isArray(index.available_domains)
    ? index.available_domains.map((d) => String(d || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const domainSummaries = index.domain_summaries && typeof index.domain_summaries === "object"
    ? index.domain_summaries
    : {};
  const summaryDomains = Object.keys(domainSummaries).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const registryDomainSet = new Set(
    registryRows.map((row) => String(row.domain_key || "").trim().toLowerCase()).filter(Boolean)
  );

  const domainUnion = Array.from(
    new Set([...blobDomains, ...availableDomains, ...summaryDomains])
  ).sort();

  const domainMatrix = domainUnion.map((domain) => ({
    domain,
    in_blob: blobDomains.includes(domain),
    in_index_available_domains: availableDomains.includes(domain),
    in_index_domain_summaries: summaryDomains.includes(domain),
    in_domain_registry: registryDomainSet.has(domain),
  }));

  const financialSummary =
    domainSummaries && typeof domainSummaries.financial === "object" ? domainSummaries.financial : {};
  const financialBlob =
    decryptedBlob && typeof decryptedBlob.financial === "object" ? decryptedBlob.financial : {};
  const kaiProfileBlob =
    decryptedBlob && typeof decryptedBlob.kai_profile === "object" ? decryptedBlob.kai_profile : {};

  const summaryHoldingsCount = canonicalSummaryCount(financialSummary);
  const blobHoldingsCount = holdingsCountFromBlob(financialBlob);
  const symbolDiagnostics = financialSymbolDiagnostics(financialBlob);

  const mismatches = [];
  for (const row of domainMatrix) {
    if (row.in_blob && !row.in_index_available_domains) {
      mismatches.push({ severity: "high", type: "domain_missing_in_available_domains", domain: row.domain });
    }
    if (row.in_blob && !row.in_index_domain_summaries) {
      mismatches.push({ severity: "medium", type: "domain_missing_in_summaries", domain: row.domain });
    }
    if ((row.in_index_available_domains || row.in_index_domain_summaries) && !row.in_domain_registry) {
      mismatches.push({ severity: "high", type: "domain_missing_in_registry", domain: row.domain });
    }
  }

  if (summaryHoldingsCount <= 0 && blobHoldingsCount > 0) {
    mismatches.push({
      severity: "high",
      type: "financial_summary_counter_zero_with_blob_holdings",
      details: { summaryHoldingsCount, blobHoldingsCount },
    });
  }

  if (summaryHoldingsCount > 0 && blobHoldingsCount > 0 && summaryHoldingsCount !== blobHoldingsCount) {
    mismatches.push({
      severity: "medium",
      type: "financial_summary_counter_differs_from_blob",
      details: { summaryHoldingsCount, blobHoldingsCount },
    });
  }

  if ((symbolDiagnostics.action_tokens || []).length > 0) {
    mismatches.push({
      severity: "high",
      type: "financial_holdings_include_trade_action_tokens",
      details: { action_tokens: symbolDiagnostics.action_tokens },
    });
  }

  if ((symbolDiagnostics.cash_sweep_identifiers || []).includes("QACDS")) {
    mismatches.push({
      severity: "medium",
      type: "financial_holdings_include_cash_sweep_identifier",
      details: { symbol: "QACDS" },
    });
  }

  const riskProfileFromKaiProfile =
    kaiProfileBlob && kaiProfileBlob.preferences && typeof kaiProfileBlob.preferences === "object"
      ? kaiProfileBlob.preferences.risk_profile || null
      : null;

  const report = {
    generated_at: new Date().toISOString(),
    user_id: userId,
    data_source: dataSource,
    vault: {
      primary_method: String(vaultHeaders[0].primary_method || ""),
      wrappers_count: vaultWrappers.length,
      passphrase_wrapper_found: Boolean(passphraseWrapper),
      vault_key_hash_matches: Boolean(expectedVaultHash) && computedVaultHash === expectedVaultHash,
    },
    world_model_blob: {
      updated_at: wm.updated_at || null,
      data_version: wm.data_version || null,
      domains: blobDomains,
      financial_holdings_count: blobHoldingsCount,
      financial_symbol_diagnostics: symbolDiagnostics,
      kai_profile_risk_profile: riskProfileFromKaiProfile,
    },
    world_model_index: {
      updated_at: index.updated_at || null,
      available_domains: availableDomains,
      domain_summary_keys: summaryDomains,
      total_attributes: Number(index.total_attributes || 0),
      financial_summary_count: summaryHoldingsCount,
      financial_risk_bucket:
        financialSummary && typeof financialSummary === "object" ? financialSummary.risk_bucket || null : null,
    },
    domain_presence_matrix: domainMatrix,
    debate_context_readiness: {
      holdings_count_from_summary: summaryHoldingsCount,
      holdings_count_from_blob: blobHoldingsCount,
      risk_profile_from_summary:
        financialSummary && typeof financialSummary === "object" ? financialSummary.risk_bucket || null : null,
      risk_profile_from_kai_profile: riskProfileFromKaiProfile,
      ready: summaryHoldingsCount > 0,
    },
    mismatches,
  };

  const markdown = [
    `# World Model Audit (${userId})`,
    "",
    `- Generated: ${report.generated_at}`,
    `- Domains in blob: ${blobDomains.join(", ") || "none"}`,
    `- Index available domains: ${availableDomains.join(", ") || "none"}`,
    `- Financial summary count: ${summaryHoldingsCount}`,
    `- Financial blob holdings count: ${blobHoldingsCount}`,
    `- Trade-action tokens in holdings: ${(symbolDiagnostics.action_tokens || []).join(", ") || "none"}`,
    `- Cash sweep identifiers in holdings: ${(symbolDiagnostics.cash_sweep_identifiers || []).join(", ") || "none"}`,
    `- Debate context ready: ${report.debate_context_readiness.ready ? "yes" : "no"}`,
    `- Mismatches: ${mismatches.length}`,
  ].join("\n");

  const jsonOutPath = resolve(outputPath);
  const mdOutPath = jsonOutPath.replace(/\.json$/i, ".md");

  mkdirSync(resolve("temp"), { recursive: true });
  writeFileSync(jsonOutPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(mdOutPath, `${markdown}\n`, "utf8");

  console.log(`Audit complete: ${jsonOutPath}`);
  console.log(`Summary: ${mdOutPath}`);
}

main().catch((error) => {
  console.error("Audit failed:", error?.message || error);
  process.exit(1);
});
