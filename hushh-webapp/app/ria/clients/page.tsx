"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  RiaCompatibilityState,
  RiaPageShell,
  RiaSurface,
} from "@/components/ria/ria-page-shell";
import { useAuth } from "@/hooks/use-auth";
import { ROUTES } from "@/lib/navigation/routes";
import {
  isIAMSchemaNotReadyError,
  RiaService,
  type RiaClientAccess,
} from "@/lib/services/ria-service";

const STATUS_ORDER = [
  "approved",
  "request_pending",
  "invited",
  "revoked",
  "expired",
  "blocked",
] as const;

export default function RiaClientsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<RiaClientAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingInvite, setSavingInvite] = useState(false);
  const [iamUnavailable, setIamUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [lastCreatedInviteToken, setLastCreatedInviteToken] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  function buildInviteLink(inviteToken: string) {
    const invitePath = `/kai/onboarding?invite=${encodeURIComponent(inviteToken)}`;
    if (typeof window === "undefined") return invitePath;
    return `${window.location.origin}${invitePath}`;
  }

  async function loadClients() {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setIamUnavailable(false);
      const idToken = await user.getIdToken();
      const next = await RiaService.listClients(idToken);
      setItems(next);
    } catch (error) {
      setItems([]);
      setIamUnavailable(isIAMSchemaNotReadyError(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function onCreateInvite() {
    if (!user) return;
    setSavingInvite(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const created = await RiaService.createInvites(idToken, {
        scope_template_id: "ria_financial_summary_v1",
        duration_mode: "preset",
        duration_hours: 168,
        targets: [
          {
            display_name: inviteName || undefined,
            email: inviteEmail || undefined,
            phone: invitePhone || undefined,
            source: "manual",
            delivery_channel: inviteEmail ? "email" : invitePhone ? "sms" : "share_link",
          },
        ],
      });
      const firstInvite = created.items[0];
      if (firstInvite?.invite_token) {
        setLastCreatedInviteToken(firstInvite.invite_token);
      }
      setInviteName("");
      setInviteEmail("");
      setInvitePhone("");
      await loadClients();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Failed to create invite");
    } finally {
      setSavingInvite(false);
    }
  }

  async function copyInviteLink(inviteToken: string, marker: string) {
    try {
      await navigator.clipboard.writeText(buildInviteLink(inviteToken));
      setCopiedInviteId(marker);
      window.setTimeout(() => {
        setCopiedInviteId((current) => (current === marker ? null : current));
      }, 1500);
    } catch {
      setError("Unable to copy the invite link from this browser session.");
    }
  }

  const filteredItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const aIndex = STATUS_ORDER.indexOf((a.status as (typeof STATUS_ORDER)[number]) || "blocked");
      const bIndex = STATUS_ORDER.indexOf((b.status as (typeof STATUS_ORDER)[number]) || "blocked");
      return (aIndex === -1 ? STATUS_ORDER.length : aIndex) - (bIndex === -1 ? STATUS_ORDER.length : bIndex);
    });
    if (filter === "all") return sorted;
    return sorted.filter((item) => item.status === filter);
  }, [filter, items]);

  return (
    <RiaPageShell
      eyebrow="Client Roster"
      title="Track every relationship from invite to workspace access"
      description="The roster is the single operational view for invited prospects, pending requests, approved workspaces, and relationships that need reactivation."
      actions={
        <Link
          href={ROUTES.MARKETPLACE}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background/60 px-4 text-sm font-medium text-foreground"
        >
          Find investors
        </Link>
      }
    >
      {iamUnavailable ? (
        <RiaCompatibilityState
          title="Client management is waiting on the IAM rollout"
          description="The live database is still missing the RIA IAM tables. The roster UI is ready, but real invites, requests, and workspaces will stay unavailable until the IAM schema is migrated."
        />
      ) : null}

      {!iamUnavailable ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[1.2fr_1.8fr]">
            <RiaSurface>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Invite a client
              </p>
              <h2 className="mt-2 text-xl font-semibold text-foreground">
                Start with a private link instead of a raw user ID
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Manual invite creation is available now. CRM and CSV entry points can plug into this
                same lifecycle later without changing the relationship model.
              </p>
              <div className="mt-5 space-y-3">
                <input
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm"
                  placeholder="Client name"
                />
                <input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm"
                  placeholder="Client email"
                />
                <input
                  value={invitePhone}
                  onChange={(event) => setInvitePhone(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm"
                  placeholder="Client phone"
                />
                {error ? <p className="text-sm text-red-500">{error}</p> : null}
                <button
                  type="button"
                  onClick={() => void onCreateInvite()}
                  disabled={savingInvite || (!inviteName && !inviteEmail && !invitePhone)}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
                >
                  {savingInvite ? "Creating invite..." : "Create invite link"}
                </button>
                {lastCreatedInviteToken ? (
                  <div className="rounded-[22px] border border-amber-500/20 bg-amber-500/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/80">
                      Latest invite link
                    </p>
                    <p className="mt-2 break-all text-sm text-foreground">
                      {buildInviteLink(lastCreatedInviteToken)}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copyInviteLink(lastCreatedInviteToken, "latest")}
                      className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground"
                    >
                      {copiedInviteId === "latest" ? "Copied" : "Copy link"}
                    </button>
                  </div>
                ) : null}
              </div>
            </RiaSurface>

            <RiaSurface>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Relationship states
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-foreground">
                    Approved, pending, invited, and recoverable
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["all", "approved", "request_pending", "invited", "revoked", "expired"].map(
                    (value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFilter(value)}
                        className={`min-h-11 rounded-full px-4 text-sm font-medium ${
                          filter === value
                            ? "bg-foreground text-background"
                            : "border border-border bg-background text-foreground"
                        }`}
                      >
                        {value.replace("_", " ")}
                      </button>
                    )
                  )}
                </div>
              </div>
            </RiaSurface>
          </div>

          <div className="space-y-3">
            {loading ? <p className="text-sm text-muted-foreground">Loading clients…</p> : null}
            {filteredItems.map((item) => (
              <RiaSurface key={item.id} className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold text-foreground">
                        {item.investor_display_name || item.investor_user_id || "Invited investor"}
                      </p>
                      <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {item.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.acquisition_source || "manual"} ·{" "}
                      {item.investor_headline || item.next_action || "request_access"}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Next action: {item.next_action || "request_access"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.investor_user_id ? (
                      <Link
                        href={`/ria/workspace/${encodeURIComponent(item.investor_user_id)}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background"
                      >
                        Workspace
                      </Link>
                    ) : null}
                    <Link
                      href={ROUTES.RIA_REQUESTS}
                      className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground"
                    >
                      Open activity
                    </Link>
                    {item.invite_token ? (
                      <button
                        type="button"
                        onClick={() => void copyInviteLink(item.invite_token || "", String(item.id))}
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-amber-500/25 bg-amber-500/5 px-4 text-sm font-medium text-amber-100"
                      >
                        {copiedInviteId === String(item.id) ? "Copied" : "Copy invite"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {(item.invite_token || item.invite_expires_at || item.consent_expires_at) ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {item.invite_token ? (
                      <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Invite path
                        </p>
                        <p className="mt-2 break-all text-sm text-foreground">
                          {buildInviteLink(item.invite_token)}
                        </p>
                      </div>
                    ) : null}
                    {item.invite_expires_at ? (
                      <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Invite expires
                        </p>
                        <p className="mt-2 text-sm text-foreground">
                          {new Date(item.invite_expires_at).toLocaleString()}
                        </p>
                      </div>
                    ) : null}
                    {item.consent_expires_at ? (
                      <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Consent expires
                        </p>
                        <p className="mt-2 text-sm text-foreground">
                          {new Date(item.consent_expires_at).toLocaleString()}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </RiaSurface>
            ))}
            {!loading && filteredItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No clients in this state yet.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </RiaPageShell>
  );
}
