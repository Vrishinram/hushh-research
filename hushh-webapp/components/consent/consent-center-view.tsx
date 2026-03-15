"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BadgeCheck,
  BriefcaseBusiness,
  ClipboardList,
  History,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePersonaState } from "@/lib/persona/persona-context";
import { useVault } from "@/lib/vault/vault-context";
import { useConsentActions } from "@/lib/consent";
import {
  ConsentCenterService,
  type ConsentCenterActor,
  type ConsentCenterEntry,
  type ConsentCenterResponse,
  type ConsentCenterView,
} from "@/lib/services/consent-center-service";
import { ROUTES } from "@/lib/navigation/routes";
import { Button } from "@/lib/morphy-ux/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, SectionHeader, ContentSurface } from "@/components/app-ui/page-sections";
import { Icon } from "@/lib/morphy-ux/ui";
import { SegmentedPill, type SegmentedPillOption } from "@/lib/morphy-ux/ui";
import { cn } from "@/lib/utils";

const SURFACE_VIEW_LABELS = {
  pending: "Pending",
  active: "Active",
  previous: "Previous",
} as const;

type ConsentSurfaceView = keyof typeof SURFACE_VIEW_LABELS;

function normalizeSurfaceView(view: string | null): ConsentSurfaceView {
  if (view === "active") return "active";
  if (view === "history" || view === "previous") return "previous";
  return "pending";
}

function resolveRequestView(
  actor: ConsentCenterActor,
  surfaceView: ConsentSurfaceView
): ConsentCenterView {
  if (surfaceView === "active") return "active";
  if (surfaceView === "previous") return "history";
  return actor === "ria" ? "outgoing" : "incoming";
}

function statusTone(status: string) {
  switch (status) {
    case "approved":
    case "active":
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
    case "request_pending":
    case "pending":
      return "bg-amber-500/10 text-amber-600 border-amber-500/20";
    case "revoked":
    case "denied":
    case "cancelled":
      return "bg-red-500/10 text-red-600 border-red-500/20";
    case "expired":
      return "bg-zinc-500/10 text-zinc-600 border-zinc-500/20";
    case "sent":
      return "bg-sky-500/10 text-sky-600 border-sky-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function formatDate(value: number | string | null | undefined) {
  if (!value) return null;
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function entryHeadline(entry: ConsentCenterEntry) {
  if (entry.counterpart_label) return entry.counterpart_label;
  if (entry.kind === "invite") return "Invite";
  return entry.scope || "Consent request";
}

function entrySupportingCopy(entry: ConsentCenterEntry) {
  if (entry.scope_description) return entry.scope_description;
  if (entry.kind === "invite") return "Pre-consent handshake before the investor reviews access.";
  if (entry.kind === "outgoing_request") return "Request created from your advisor relationship flow.";
  if (entry.kind === "incoming_request") return "Approval is required before any protected data can be accessed.";
  return entry.scope || "Consent workflow event";
}

function getEntriesForSurfaceView(
  center: ConsentCenterResponse | null,
  actor: ConsentCenterActor,
  surfaceView: ConsentSurfaceView
) {
  if (!center) return [];

  if (surfaceView === "active") return center.active_grants;
  if (surfaceView === "previous") return center.history;

  const pendingEntries =
    actor === "ria"
      ? [...center.outgoing_requests, ...center.invites]
      : [...center.incoming_requests, ...center.developer_requests];

  return pendingEntries.sort((left, right) => {
    const leftTime = left.issued_at ? new Date(String(left.issued_at)).getTime() : 0;
    const rightTime = right.issued_at ? new Date(String(right.issued_at)).getTime() : 0;
    return rightTime - leftTime;
  });
}

function getViewCount(
  center: ConsentCenterResponse | null,
  actor: ConsentCenterActor,
  surfaceView: ConsentSurfaceView
) {
  if (!center) return 0;
  if (surfaceView === "active") return center.summary.active_grants;
  if (surfaceView === "previous") return center.summary.history;
  return actor === "ria"
    ? center.summary.outgoing_requests + center.summary.invites
    : center.summary.incoming_requests + center.summary.developer_requests;
}

function emptyStateCopy(actor: ConsentCenterActor, surfaceView: ConsentSurfaceView) {
  if (surfaceView === "active") {
    return "No active access grants yet.";
  }
  if (surfaceView === "previous") {
    return "No previous consent activity yet.";
  }
  return actor === "ria"
    ? "No pending RIA requests or invites yet."
    : "No pending investor approvals or developer requests yet.";
}

export function ConsentCenterView({
  embedded = false,
  className,
}: {
  embedded?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { isVaultUnlocked } = useVault();
  const { activePersona, riaCapability } = usePersonaState();
  const actor: ConsentCenterActor = activePersona === "ria" ? "ria" : "investor";
  const [embeddedView, setEmbeddedView] = useState<ConsentSurfaceView>("pending");
  const surfaceView = embedded
    ? embeddedView
    : normalizeSurfaceView(searchParams.get("view"));
  const requestView = resolveRequestView(actor, surfaceView);

  const [center, setCenter] = useState<ConsentCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { handleApprove, handleDeny, handleRevoke } = useConsentActions({
    userId: user?.uid,
    onActionComplete: () => {
      if (user) {
        void loadCenter({ force: true, silent: true });
      }
    },
  });

  const loadCenter = useCallback(
    async (options?: { force?: boolean; silent?: boolean }) => {
      if (!user) {
        setCenter(null);
        setLoading(false);
        return;
      }

      if (!options?.silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const idToken = await user.getIdToken();
        const nextCenter = await ConsentCenterService.getCenter({
          idToken,
          userId: user.uid,
          actor,
          view: requestView,
          force: Boolean(options?.force),
        });
        setCenter(nextCenter);
      } catch (loadError) {
        setCenter(null);
        setError(loadError instanceof Error ? loadError.message : "Failed to load consent center");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [actor, requestView, user]
  );

  useEffect(() => {
    if (!embedded && authLoading && !user) return;
    if (authLoading || user) return;
    router.replace(`${ROUTES.LOGIN}?redirect=${encodeURIComponent(ROUTES.CONSENTS)}`);
  }, [authLoading, embedded, router, user]);

  useEffect(() => {
    if (authLoading) return;
    void loadCenter();
  }, [authLoading, loadCenter]);

  useEffect(() => {
    const handler = () => {
      void loadCenter({ force: true, silent: true });
    };
    window.addEventListener("consent-action-complete", handler);
    return () => window.removeEventListener("consent-action-complete", handler);
  }, [loadCenter]);

  const visibleEntries = useMemo(
    () => getEntriesForSurfaceView(center, actor, surfaceView),
    [actor, center, surfaceView]
  );

  const viewOptions = useMemo<SegmentedPillOption[]>(
    () => [
      {
        value: "pending",
        label: `${SURFACE_VIEW_LABELS.pending} ${getViewCount(center, actor, "pending")}`,
        icon: Shield,
      },
      {
        value: "active",
        label: `${SURFACE_VIEW_LABELS.active} ${getViewCount(center, actor, "active")}`,
        icon: BadgeCheck,
      },
      {
        value: "previous",
        label: `${SURFACE_VIEW_LABELS.previous} ${getViewCount(center, actor, "previous")}`,
        icon: History,
      },
    ],
    [actor, center]
  );

  const updateView = (nextView: ConsentSurfaceView) => {
    if (embedded) {
      setEmbeddedView(nextView);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("actor");
    params.set("view", resolveRequestView(actor, nextView));
    router.replace(`${ROUTES.CONSENTS}?${params.toString()}`);
  };

  if (authLoading || !user) return null;

  const content = (
    <>
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          View
        </p>
        <SegmentedPill
          size="default"
          value={surfaceView}
          options={viewOptions}
          onValueChange={(next) => updateView(next as ConsentSurfaceView)}
          ariaLabel="Consent center view"
          className="w-full"
        />
      </div>

      {actor === "investor" && !isVaultUnlocked ? (
        <ContentSurface className="space-y-3">
          <SectionHeader
            eyebrow="Vault"
            title="Unlock is required for investor decisions"
            description="You can review requests here, but approving, denying, or revoking access requires an unlocked vault."
            icon={Shield}
            actions={
              <Link
                href={ROUTES.PROFILE}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground"
              >
                Open profile
              </Link>
            }
          />
        </ContentSurface>
      ) : null}

      {riaCapability === "setup" ? (
        <ContentSurface className="space-y-3">
          <SectionHeader
            eyebrow="RIA setup"
            title="The same account can activate RIA mode"
            description="Complete onboarding to send investor requests and manage advisor workflows from this same login."
            icon={BriefcaseBusiness}
            actions={
              <Link
                href={ROUTES.RIA_ONBOARDING}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background"
              >
                Open RIA onboarding
              </Link>
            }
          />
        </ContentSurface>
      ) : null}

      <div className="space-y-3">
        <SectionHeader
          eyebrow={actor === "ria" ? "RIA" : "Investor"}
          title={`${SURFACE_VIEW_LABELS[surfaceView]} log`}
          icon={
            surfaceView === "pending"
              ? Shield
              : surfaceView === "active"
                ? BadgeCheck
                : History
          }
          description={
            surfaceView === "pending"
              ? actor === "ria"
                ? "Outgoing requests and invite handshakes that still need investor action."
                : "Requests that still need an investor decision before data access can proceed."
              : surfaceView === "active"
                ? "Access that is currently live under the consent ledger."
                : "Historical approvals, denials, revokes, and expired access records."
          }
        />

        <ContentSurface className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
              <Icon icon={Loader2} size="sm" className="animate-spin" />
              Loading consent log...
            </div>
          ) : null}

          {error ? <p className="px-5 py-6 text-sm text-red-500">{error}</p> : null}

          {!loading && !error && visibleEntries.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">
              {emptyStateCopy(actor, surfaceView)}
            </div>
          ) : null}

          {!loading && !error && visibleEntries.length > 0 ? (
            <div className="divide-y divide-border/60">
              {visibleEntries.map((entry) => {
                const canOpenWorkspace =
                  actor === "ria" &&
                  entry.counterpart_type === "investor" &&
                  entry.allowed_next_action === "open_workspace" &&
                  entry.counterpart_id;

                return (
                  <div key={`${entry.kind}-${entry.id}`} className="space-y-4 px-5 py-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{entryHeadline(entry)}</p>
                          <Badge className={statusTone(entry.status)}>
                            {entry.status.replace(/_/g, " ")}
                          </Badge>
                          {entry.kind === "invite" ? (
                            <Badge variant="secondary">pre-consent</Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {entrySupportingCopy(entry)}
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Action: {entry.action}</span>
                          {formatDate(entry.issued_at) ? (
                            <span>Issued: {formatDate(entry.issued_at)}</span>
                          ) : null}
                          {formatDate(entry.expires_at) ? (
                            <span>Expires: {formatDate(entry.expires_at)}</span>
                          ) : null}
                          {entry.relationship_status ? (
                            <span>Relationship: {entry.relationship_status}</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {entry.kind === "incoming_request" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                void handleApprove({
                                  id: entry.request_id || entry.id,
                                  developer: entry.counterpart_label || "requester",
                                  scope: entry.scope || "",
                                  scopeDescription: entry.scope_description || undefined,
                                  requestedAt:
                                    typeof entry.issued_at === "number"
                                      ? entry.issued_at
                                      : Date.now(),
                                })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              variant="none"
                              effect="fade"
                              size="sm"
                              onClick={() => void handleDeny(entry.request_id || entry.id)}
                            >
                              Deny
                            </Button>
                          </>
                        ) : null}

                        {entry.kind === "active_grant" && entry.scope ? (
                          <Button
                            variant="none"
                            effect="fade"
                            size="sm"
                            onClick={() => void handleRevoke(entry.scope || "")}
                          >
                            Revoke
                          </Button>
                        ) : null}

                        {canOpenWorkspace ? (
                          <Link
                            href={`${ROUTES.RIA_HOME}/workspace/${encodeURIComponent(
                              String(entry.counterpart_id)
                            )}`}
                            className="inline-flex min-h-10 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground"
                          >
                            Open workspace
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </ContentSurface>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className={cn("space-y-5", className)}>
        <div className="flex justify-end">
            <Button
              variant="none"
              effect="fade"
              size="sm"
              onClick={() => void loadCenter({ force: true, silent: true })}
              disabled={refreshing}
            >
              <Icon icon={RefreshCw} size="sm" className={refreshing ? "mr-2 animate-spin" : "mr-2"} />
              Refresh
            </Button>
        </div>
        {content}
      </div>
    );
  }

  return (
    <div className={cn("mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 md:py-8", className)}>
      <PageHeader
        eyebrow="Consent Center"
        title="Pending, active, and previous Kai access"
        description="One place to review pending approvals, active grants, and the full consent log for the current persona."
        icon={ClipboardList}
        actions={
          <Button
            variant="none"
            effect="fade"
            size="default"
            onClick={() => void loadCenter({ force: true, silent: true })}
            disabled={refreshing}
          >
            <Icon icon={RefreshCw} size="sm" className={refreshing ? "mr-2 animate-spin" : "mr-2"} />
            Refresh
          </Button>
        }
      />
      {content}
    </div>
  );
}
