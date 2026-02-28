#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const targetFiles = [
  "app/page.tsx",
  "app/login/page.tsx",
  "app/kai/analysis/page.tsx",
  "app/profile/page.tsx",
  "components/app-ui/top-app-bar.tsx",
  "components/onboarding/AuthStep.tsx",
  "components/vault/vault-flow.tsx",
  "components/kai/kai-flow.tsx",
  "components/kai/debate-stream-view.tsx",
  "components/kai/views/portfolio-import-view.tsx",
  "components/kai/views/portfolio-review-view.tsx",
  "components/kai/views/dashboard-master-view.tsx",
  "components/kai/views/kai-market-preview-view.tsx",
  "components/kai/views/analysis-summary-view.tsx",
  "components/kai/views/analysis-history-dashboard.tsx",
  "components/kai/views/decision-card.tsx",
  "components/kai/views/columns.tsx",
];

const bannedTerms = [
  /\bprf\b/i,
  /\bnative prf\b/i,
  /\bruntime\b/i,
  /\bfallback\b/i,
  /\btoken\b/i,
  /\bwrapper\b/i,
  /\bdecrypt(?:ed|ion)?\b/i,
  /\bencrypt(?:ed|ion|ing)?\b/i,
];

const ignoreLiteralPatterns = [
  /^https?:\/\//i,
  /^\//,
  /^\[.*\]$/,
  /^__.*__$/,
  /VAULT_OWNER/,
  /CACHE_KEYS/,
  /generated_default_/,
  /NEXT_PUBLIC_/,
];

const uiContextPattern =
  /toast\.|setError\(|label=|placeholder=|title=|description=|<p|<span|<h1|<h2|<h3|<h4|<h5|<h6|DialogTitle|DialogDescription|AlertDialogTitle|AlertDialogDescription|Button>|TabsTrigger|Badge|HushhLoader/i;

function getStringLiterals(source) {
  const results = [];
  const regex = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/gm;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const value = match[2];
    if (!value || value.trim().length < 3) continue;
    results.push({
      value,
      index: match.index,
    });
  }
  return results;
}

function getLineNumber(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

const findings = [];

for (const relPath of targetFiles) {
  const absPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(absPath)) {
    findings.push({
      file: relPath,
      line: 1,
      term: "missing file",
      snippet: "Target file does not exist",
    });
    continue;
  }
  const source = fs.readFileSync(absPath, "utf8");
  const literals = getStringLiterals(source);

  for (const literal of literals) {
    const normalized = literal.value.trim();
    if (!normalized) continue;
    const line = getLineNumber(source, literal.index);
    const lineText = source.split("\n")[line - 1] || "";
    if (!uiContextPattern.test(lineText)) continue;
    if (/^\s*import\s/.test(lineText)) continue;
    if (lineText.includes("console.") || lineText.includes("logger.")) continue;
    if (ignoreLiteralPatterns.some((pattern) => pattern.test(normalized))) continue;
    for (const banned of bannedTerms) {
      if (!banned.test(normalized)) continue;
      findings.push({
        file: relPath,
        line,
        term: banned.toString(),
        snippet: normalized.slice(0, 120).replace(/\s+/g, " "),
      });
      break;
    }
  }
}

if (findings.length > 0) {
  console.error("Investor-language check failed. Developer-facing wording detected:\n");
  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line} -> ${finding.term}\n  "${finding.snippet}"`
    );
  }
  process.exit(1);
}

console.log("Investor-language check passed.");
