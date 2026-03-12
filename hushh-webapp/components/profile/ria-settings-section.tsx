"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

import { Button } from "@/lib/morphy-ux/morphy";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/lib/morphy-ux/ui";
import { BriefcaseBusiness, Loader2, ShieldCheck, Store, Building2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ROUTES } from "@/lib/navigation/routes";
import {
  isIAMSchemaNotReadyError,
  RiaService,
  type MarketplaceRia,
  type RiaFirmMembership,
  type RiaOnboardingStatus,
} from "@/lib/services/ria-service";
import { ContentSurface, SectionHeader } from "@/components/app-ui/page-sections";

interface RiaSettingsSectionProps {
  capability: "disabled" | "setup" | "switch";
  onboardingStatus: RiaOnboardingStatus | null;
}

function SettingsBlock({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="space-y-3">
      <SectionHeader title={title} description={description} />
      <ContentSurface>{children}</ContentSurface>
    </section>
  );
}

export function RiaSettingsSection({ capability, onboardingStatus }: RiaSettingsSectionProps) {
  const { user } = useAuth();
  const [status, setStatus] = useState<RiaOnboardingStatus | null>(onboardingStatus);
  const [firms, setFirms] = useState<RiaFirmMembership[]>([]);
  const [publicProfile, setPublicProfile] = useState<MarketplaceRia | null>(null);
  const [discoverable, setDiscoverable] = useState(false);
  const [headline, setHeadline] = useState("");
  const [strategySummary, setStrategySummary] = useState("");
  const [loading, setLoading] = useState(capability === "switch");
  const [saving, setSaving] = useState(false);
  const [iamUnavailable, setIamUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(onboardingStatus);
  }, [onboardingStatus]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!user || capability !== "switch") {
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
          setIamUnavailable(isIAMSchemaNotReadyError(loadError));
          setFirms([]);
          setPublicProfile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [capability, user]);

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
      setError(saveError instanceof Error ? saveError.message : "Failed to save RIA settings");
    } finally {
      setSaving(false);
    }
  }

  if (capability === "disabled") {
    return null;
  }

  if (capability === "setup") {
    return (
      <SettingsBlock
        id="ria-settings-section"
        title={
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Icon icon={BriefcaseBusiness} size="md" className="text-primary" />
            </div>
            <span>RIA workspace</span>
          </div>
        }
        description="Your account can add the advisor persona. Set up verification, firm identity, and marketplace discoverability here."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Link
              href={ROUTES.RIA_ONBOARDING}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background"
            >
              Set up RIA
            </Link>
          </div>
        </div>
      </SettingsBlock>
    );
  }

  return (
    <SettingsBlock
      id="ria-settings-section"
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Icon icon={ShieldCheck} size="md" className="text-primary" />
          </div>
          <span>RIA settings</span>
        </div>
      }
      description="Manage advisor verification posture, discoverability, and firm context from the shared account surface."
    >
      <div className="space-y-5">
        {iamUnavailable ? (
          <p className="text-sm text-muted-foreground">
            RIA settings are unavailable until IAM schema migrations are active in this
            environment.
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-[1fr_1.5fr]">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Verification</p>
              <Badge variant="secondary">
                {loading ? "Loading" : status?.verification_status || "draft"}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {status?.latest_verification_event
                ? `Latest check: ${status.latest_verification_event.outcome}`
                : "No verification event recorded yet."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={ROUTES.RIA_HOME}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground"
              >
                Open RIA home
              </Link>
              <Link
                href={ROUTES.RIA_ONBOARDING}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground"
              >
                Resume onboarding
              </Link>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon icon={Store} size="sm" className="text-primary" />
                <p className="text-sm font-medium">Marketplace discoverability</p>
              </div>
              <button
                type="button"
                onClick={() => setDiscoverable((value) => !value)}
                className={`inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-medium ${
                  discoverable
                    ? "bg-foreground text-background"
                    : "border border-border bg-background text-foreground"
                }`}
              >
                {discoverable ? "Discoverable" : "Hidden"}
              </button>
            </div>
            <input
              value={headline}
              onChange={(event) => setHeadline(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-border bg-background px-4 text-sm"
              placeholder="Public headline"
            />
            <textarea
              value={strategySummary}
              onChange={(event) => setStrategySummary(event.target.value)}
              className="min-h-24 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm"
              placeholder="Public strategy summary"
            />
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
            <Button disabled={saving} onClick={() => void onSave()}>
              {saving ? "Saving..." : "Save RIA settings"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center gap-2">
              <Icon icon={Building2} size="sm" className="text-primary" />
              <p className="text-sm font-medium">Firm memberships</p>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {firms.map((firm) => (
                <div
                  key={`${firm.id}-${firm.legal_name}`}
                  className="rounded-xl border border-border/50 bg-background/60 p-3"
                >
                  <p className="text-sm font-medium">{firm.legal_name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {firm.role_title || "No role title"} · {firm.membership_status || "active"}
                  </p>
                </div>
              ))}
              {!loading && firms.length === 0 ? (
                <p className="text-sm text-muted-foreground">No firm memberships found.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
            <p className="text-sm font-medium">Public profile preview</p>
            <p className="mt-3 text-lg font-semibold text-foreground">
              {publicProfile?.display_name || status?.display_name || "RIA profile"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {headline || publicProfile?.headline || "No public headline set yet."}
            </p>
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {(status?.verification_status || "draft").replace(/_/g, " ")} ·{" "}
              {discoverable ? "discoverable" : "hidden"}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon icon={Loader2} size="sm" className="animate-spin" />
            Loading RIA settings...
          </div>
        ) : null}
      </div>
    </SettingsBlock>
  );
}
