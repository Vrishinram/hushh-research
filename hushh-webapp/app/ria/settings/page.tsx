"use client";

import { useEffect, useState } from "react";

import {
  RiaCompatibilityState,
  RiaPageShell,
  RiaSurface,
} from "@/components/ria/ria-page-shell";
import { useAuth } from "@/hooks/use-auth";
import {
  isIAMSchemaNotReadyError,
  RiaService,
  type MarketplaceRia,
  type RiaFirmMembership,
  type RiaOnboardingStatus,
} from "@/lib/services/ria-service";

export default function RiaSettingsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<RiaOnboardingStatus | null>(null);
  const [firms, setFirms] = useState<RiaFirmMembership[]>([]);
  const [publicProfile, setPublicProfile] = useState<MarketplaceRia | null>(null);
  const [discoverable, setDiscoverable] = useState(false);
  const [headline, setHeadline] = useState("");
  const [strategySummary, setStrategySummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [iamUnavailable, setIamUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setIamUnavailable(false);
        const idToken = await user.getIdToken();
        const nextStatus = await RiaService.getOnboardingStatus(idToken);
        const nextFirms = await RiaService.listFirms(idToken);
        let nextProfile: MarketplaceRia | null = null;
        if (nextStatus.ria_profile_id) {
          nextProfile = await RiaService.getRiaPublicProfile(nextStatus.ria_profile_id).catch(
            () => null
          );
        }
        if (cancelled) return;
        setStatus(nextStatus);
        setFirms(nextFirms);
        setPublicProfile(nextProfile);
        setDiscoverable(Boolean(nextProfile));
        setHeadline(nextProfile?.headline || "");
        setStrategySummary(nextProfile?.strategy_summary || "");
      } catch (loadError) {
        if (!cancelled) {
          setStatus(null);
          setFirms([]);
          setPublicProfile(null);
          setIamUnavailable(isIAMSchemaNotReadyError(loadError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function onSave() {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      await RiaService.setRiaMarketplaceDiscoverability(idToken, {
        enabled: discoverable,
        headline: headline || undefined,
        strategy_summary: strategySummary || undefined,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <RiaPageShell
      eyebrow="RIA Settings"
      title="Verification, discoverability, and firm context"
      description="Settings hold the trust configuration for the RIA persona: verification status, firm memberships, and the public profile surfaces investors use before they consent."
    >
      {iamUnavailable ? (
        <RiaCompatibilityState
          title="RIA settings are unavailable in this environment"
          description="The connected database is still running without IAM tables. This settings surface stays compatibility-safe until the IAM rollout completes."
        />
      ) : null}

      {!iamUnavailable ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[1.1fr_1.9fr]">
            <RiaSurface>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Verification
              </p>
              <p className="mt-3 text-2xl font-semibold text-foreground">
                {loading ? "Loading..." : status?.verification_status || "draft"}
              </p>
              {status?.latest_verification_event ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Latest event: {status.latest_verification_event.outcome} on{" "}
                  {new Date(status.latest_verification_event.checked_at).toLocaleString()}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No verification event recorded yet.
                </p>
              )}
            </RiaSurface>

            <RiaSurface>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Marketplace presence
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-[auto_1fr] md:items-start">
                <button
                  type="button"
                  onClick={() => setDiscoverable((value) => !value)}
                  className={`inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium ${
                    discoverable
                      ? "bg-foreground text-background"
                      : "border border-border bg-background text-foreground"
                  }`}
                >
                  {discoverable ? "Discoverable" : "Hidden"}
                </button>
                <p className="text-sm leading-6 text-muted-foreground">
                  Marketplace cards remain public-metadata only. Turning discoverability off hides
                  the public profile but does not remove existing approved relationships.
                </p>
              </div>
              <div className="mt-5 space-y-3">
                <input
                  value={headline}
                  onChange={(event) => setHeadline(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm"
                  placeholder="Public headline"
                />
                <textarea
                  value={strategySummary}
                  onChange={(event) => setStrategySummary(event.target.value)}
                  className="min-h-28 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm"
                  placeholder="Public strategy summary"
                />
                {error ? <p className="text-sm text-red-500">{error}</p> : null}
                <button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={saving}
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save marketplace settings"}
                </button>
              </div>
            </RiaSurface>
          </div>

          <RiaSurface>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Firm memberships
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {firms.map((firm) => (
                <div
                  key={`${firm.id}-${firm.legal_name}`}
                  className="rounded-2xl border border-border/50 bg-background/60 p-4"
                >
                  <p className="text-sm font-semibold text-foreground">{firm.legal_name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {firm.role_title || "No role title"} · {firm.membership_status || "active"}
                  </p>
                  {firm.finra_firm_crd ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      FINRA firm CRD: {firm.finra_firm_crd}
                    </p>
                  ) : null}
                </div>
              ))}
              {!loading && firms.length === 0 ? (
                <p className="text-sm text-muted-foreground">No firm memberships found.</p>
              ) : null}
            </div>
          </RiaSurface>

          <RiaSurface>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Public profile preview
            </p>
            <div className="mt-4 rounded-[26px] border border-border/50 bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.12),_transparent_35%),rgba(17,17,19,0.92)] p-5">
              <p className="text-xl font-semibold text-zinc-50">
                {publicProfile?.display_name || status?.display_name || "RIA profile"}
              </p>
              <p className="mt-2 text-sm text-zinc-300">
                {headline || publicProfile?.headline || "No public headline set yet."}
              </p>
              <p className="mt-3 text-xs uppercase tracking-[0.2em] text-zinc-400">
                {status?.verification_status || "draft"} · {discoverable ? "discoverable" : "hidden"}
              </p>
            </div>
          </RiaSurface>
        </>
      ) : null}
    </RiaPageShell>
  );
}
