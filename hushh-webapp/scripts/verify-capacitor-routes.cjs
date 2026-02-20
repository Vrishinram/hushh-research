#!/usr/bin/env node
/*
 * verify-capacitor-routes.cjs
 *
 * Hard-fail checks for Capacitor/export-safe routing.
 * We do not rely on Next.js redirects alone for mobile static export.
 */

const fs = require("node:fs");
const path = require("node:path");

const webappRoot = path.resolve(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(webappRoot, relPath), "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(webappRoot, relPath));
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK: ${message}`);
}

const CANONICAL_ROUTE_FILES = [
  "app/page.tsx",
  "app/login/page.tsx",
  "app/kai/page.tsx",
  "app/kai/onboarding/page.tsx",
  "app/kai/import/page.tsx",
  "app/kai/dashboard/page.tsx",
];

const LEGACY_ALIAS_FILES = [
  "app/onboarding/preferences/page.tsx",
  "app/dashboard/page.tsx",
  "app/dashboard/kai/page.tsx",
  "app/dashboard/kai/[...path]/page.tsx",
  "app/dashboard/domain/[...path]/page.tsx",
  "app/dashboard/agent-nav/page.tsx",
];

function assertFilesExist() {
  for (const rel of CANONICAL_ROUTE_FILES) {
    if (!exists(rel)) {
      fail(`Missing required route file: ${rel}`);
    }
  }
  ok("Canonical route files exist");
}

function assertLegacyAliasesRemoved() {
  for (const rel of LEGACY_ALIAS_FILES) {
    if (exists(rel)) {
      fail(`Legacy alias route file must be removed: ${rel}`);
    }
  }
  ok("Legacy alias route files are removed");
}

function assertNextConfigHasNoLegacyRedirects() {
  const src = read("next.config.ts");
  const disallowedRedirectSources = [
    "/dashboard",
    "/onboarding/preferences",
    "/dashboard/kai",
    "/dashboard/kai/:path*",
    "/dashboard/domain/:path*",
    "/dashboard/agent-nav",
  ];

  for (const source of disallowedRedirectSources) {
    if (src.includes(`source: \"${source}\"`) || src.includes(`source: '${source}'`)) {
      fail(`next.config.ts must not include legacy redirect source ${source}`);
    }
  }

  ok("next.config.ts does not define legacy alias redirects");
}

function main() {
  assertFilesExist();
  assertLegacyAliasesRemoved();
  assertNextConfigHasNoLegacyRedirects();

  if (process.exitCode) {
    console.error("\nCapacitor route verification FAILED");
    process.exit(1);
  }

  console.log("\nCapacitor route verification PASSED");
}

main();
