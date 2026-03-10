"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import {
  RiaCompatibilityState,
  RiaPageShell,
  RiaSurface,
} from "@/components/ria/ria-page-shell";
import { useAuth } from "@/hooks/use-auth";
import { ROUTES } from "@/lib/navigation/routes";
import { isIAMSchemaNotReadyError, RiaService } from "@/lib/services/ria-service";

interface WorkspacePayload {
  investor_user_id: string;
  investor_display_name?: string | null;
  investor_headline?: string | null;
  workspace_ready: boolean;
  available_domains: string[];
  domain_summaries: Record<string, unknown>;
  total_attributes: number;
  relationship_status: string;
  scope: string;
  consent_expires_at?: number | string | null;
  updated_at?: string;
}

export default function RiaWorkspacePage() {
  const params = useParams<{ clientId: string }>();
  const clientId = String(params.clientId || "");
  const { user } = useAuth();
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [iamUnavailable, setIamUnavailable] = useState(false);

  useEffect(() => {
    if (!user || !clientId) {
      setLoading(false);
      return;
    }

    const currentUser = user;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setIamUnavailable(false);
      try {
        const idToken = await currentUser.getIdToken();
        const payload = await RiaService.getWorkspace(idToken, clientId);
        if (!cancelled) setData(payload as WorkspacePayload);
      } catch (loadError) {
        if (!cancelled) {
          setData(null);
          setIamUnavailable(isIAMSchemaNotReadyError(loadError));
          setError(loadError instanceof Error ? loadError.message : "Failed to load workspace");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [clientId, user]);

  const domainEntries = useMemo(
    () =>
      Object.entries(data?.domain_summaries || {}).slice(0, 6).map(([key, value]) => ({
        key,
        summary: typeof value === "object" ? JSON.stringify(value) : String(value),
      })),
    [data?.domain_summaries]
  );

  return (
    <RiaPageShell
      eyebrow="Client Workspace"
      title={data?.investor_display_name || `Client ${clientId}`}
      description={
        data?.investor_headline ||
        "Consent-gated workspace access. If the relationship is no longer active, the surface stays locked and the next valid action is to re-request access."
      }
      actions={
        <Link
          href={ROUTES.RIA_REQUESTS}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background/60 px-4 text-sm font-medium text-foreground"
        >
          Open activity
        </Link>
      }
    >
      {iamUnavailable ? (
        <RiaCompatibilityState
          title="Workspace access is unavailable in this environment"
          description="This environment still returns IAM compatibility mode. Once the IAM tables are present, the same workspace route becomes live without a navigation change."
        />
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading workspace…</p> : null}

      {error && !iamUnavailable ? (
        <RiaSurface className="border-red-500/30 bg-red-500/5">
          <p className="text-sm text-red-400">{error}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={ROUTES.RIA_REQUESTS}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background"
            >
              Re-open request center
            </Link>
            <Link
              href={ROUTES.RIA_CLIENTS}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground"
            >
              Back to clients
            </Link>
          </div>
        </RiaSurface>
      ) : null}

      {data && !error ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <RiaSurface className="p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">State</p>
              <p className="mt-2 text-xl font-semibold text-foreground">{data.relationship_status}</p>
            </RiaSurface>
            <RiaSurface className="p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scope</p>
              <p className="mt-2 text-sm font-medium text-foreground">{data.scope}</p>
            </RiaSurface>
            <RiaSurface className="p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Domains</p>
              <p className="mt-2 text-xl font-semibold text-foreground">{data.available_domains.length}</p>
            </RiaSurface>
            <RiaSurface className="p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Attributes</p>
              <p className="mt-2 text-xl font-semibold text-foreground">{data.total_attributes}</p>
            </RiaSurface>
          </div>

          {!data.workspace_ready ? (
            <RiaSurface className="border-amber-500/30 bg-amber-500/5">
              <p className="text-sm text-amber-100">
                Consent is active but the workspace is not populated yet. Client data will appear
                after the world-model index is available for this investor.
              </p>
            </RiaSurface>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1.2fr_1.8fr]">
              <RiaSurface>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Access freshness
                </p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Consent expires
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                      {data.consent_expires_at
                        ? new Date(data.consent_expires_at).toLocaleString()
                        : "No active expiry returned"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Workspace updated
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                      {data.updated_at ? new Date(data.updated_at).toLocaleString() : "Pending"}
                    </p>
                  </div>
                </div>
              </RiaSurface>

              <RiaSurface>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Domain summaries
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {domainEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className="rounded-2xl border border-border/50 bg-background/60 p-4"
                    >
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        {entry.key}
                      </p>
                      <p className="mt-2 line-clamp-5 text-sm text-foreground">
                        {entry.summary}
                      </p>
                    </div>
                  ))}
                  {domainEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No domain summaries available yet.</p>
                  ) : null}
                </div>
              </RiaSurface>
            </div>
          )}
        </>
      ) : null}
    </RiaPageShell>
  );
}
