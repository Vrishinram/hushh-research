// hushh-webapp/app/api/_utils/backend.ts
//
// Single source of truth for where Next.js API routes proxy to.
//
// Requirements:
// - Local dev should hit local FastAPI by default (http://localhost:8000)
// - Production should default to Cloud Run unless explicitly overridden

const PROD_DEFAULT = "https://consent-protocol-rpphvsc3tq-uc.a.run.app";
const DEV_DEFAULT = "http://localhost:8000";

function normalizeUrl(value: string | undefined): string | null {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  return text.replace(/\/+$/, "");
}

function defaultBackendUrl() {
  return process.env.NODE_ENV === "production" ? PROD_DEFAULT : DEV_DEFAULT;
}

export function getPythonApiUrl(): string {
  return (
    normalizeUrl(process.env.PYTHON_API_URL) ||
    normalizeUrl(process.env.BACKEND_URL) ||
    normalizeUrl(process.env.NEXT_PUBLIC_BACKEND_URL) ||
    defaultBackendUrl()
  );
}

export function getDeveloperApiUrl(): string {
  return (
    normalizeUrl(process.env.DEVELOPER_API_URL) ||
    normalizeUrl(process.env.NEXT_PUBLIC_DEVELOPER_API_URL) ||
    (process.env.NODE_ENV === "production" ? getPythonApiUrl() : DEV_DEFAULT)
  );
}
