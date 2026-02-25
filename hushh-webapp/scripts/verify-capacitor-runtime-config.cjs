#!/usr/bin/env node
/*
 * verify-capacitor-runtime-config.cjs
 *
 * Ensures generated Capacitor runtime config is valid and safe:
 * - plugin backend URLs are present for all networked native plugins
 * - hosted WebView URL is never paired with localhost backend target
 */

const fs = require("node:fs");
const path = require("node:path");

const webRoot = path.resolve(__dirname, "..");

const CONFIG_FILES = [
  {
    label: "iOS",
    relPath: "ios/App/App/capacitor.config.json",
  },
  {
    label: "Android",
    relPath: "android/app/src/main/assets/capacitor.config.json",
  },
];

const REQUIRED_BACKEND_PLUGINS = [
  "HushhVault",
  "HushhConsent",
  "Kai",
  "HushhNotifications",
  "WorldModel",
  "HushhAccount",
  "HushhSync",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function readJson(relPath) {
  const full = path.join(webRoot, relPath);
  if (!fs.existsSync(full)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(full, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    fail(`Invalid JSON in ${relPath}: ${error.message}`);
    return null;
  }
}

function hostFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    return new URL(rawUrl).hostname.trim().toLowerCase();
  } catch {
    return null;
  }
}

function validateConfig(label, relPath, json) {
  if (!json || typeof json !== "object") return;

  const plugins = json.plugins || {};
  const serverUrl = json.server?.url || null;
  const webHost = hostFromUrl(serverUrl);
  const hostedWebView = Boolean(webHost && !LOCAL_HOSTS.has(webHost));

  const backendUrls = [];
  for (const pluginName of REQUIRED_BACKEND_PLUGINS) {
    const backendUrl = plugins?.[pluginName]?.backendUrl;
    if (typeof backendUrl !== "string" || backendUrl.trim() === "") {
      fail(
        `${label} config (${relPath}) missing plugins.${pluginName}.backendUrl`
      );
      continue;
    }
    backendUrls.push({ pluginName, backendUrl: backendUrl.trim() });
  }

  for (const entry of backendUrls) {
    const backendHost = hostFromUrl(entry.backendUrl);
    if (!backendHost) {
      fail(
        `${label} config (${relPath}) has invalid backendUrl for ${entry.pluginName}: ${entry.backendUrl}`
      );
      continue;
    }
    if (hostedWebView && LOCAL_HOSTS.has(backendHost)) {
      fail(
        `${label} config (${relPath}) pairs hosted server.url (${serverUrl}) with local backendUrl (${entry.backendUrl}) for ${entry.pluginName}`
      );
    }
  }

  if (backendUrls.length > 0) {
    ok(`${label} generated runtime config has backendUrl for required plugins`);
  }
}

function main() {
  let validatedCount = 0;
  const missing = [];

  for (const file of CONFIG_FILES) {
    const json = readJson(file.relPath);
    if (!json) {
      missing.push(file.relPath);
      continue;
    }
    validatedCount += 1;
    validateConfig(file.label, file.relPath, json);
  }

  if (missing.length > 0) {
    console.warn(
      `WARN: Skipping missing generated Capacitor config file(s): ${missing.join(", ")}`
    );
  }
  if (validatedCount === 0) {
    console.warn(
      "WARN: No generated Capacitor configs found. Run `npx cap sync ios` / `npx cap sync android` in mobile build pipelines."
    );
    return;
  }

  if (process.exitCode) {
    console.error("\nCapacitor runtime config verification FAILED");
    process.exit(1);
  }

  console.log("\nCapacitor runtime config verification PASSED");
}

main();
